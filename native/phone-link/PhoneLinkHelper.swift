import AppKit
import CoreBluetooth
import CoreImage

/// The Mac app's only gesture source: Runes on a paired iPhone. The Mac is the BLE peripheral and
/// publishes one GATT service per paired phone (plus a pairing service while the code is showing).
/// A paired phone that is plugged in is reached over the cable instead (`CableLink`), with the same packets.
///
/// Protocol with the Python bridge, one JSON object per line.
/// stdout: {"kind":"link","state":…,"phone":…,"phones":[{id,name}]} · {"kind":"pairing","text":…,"image":…,"expires":…}
///         {"kind":"event","type":"Gesture"|"Gyroscope"|"Orientation",…} · {"kind":"release","reason":…}
///         {"kind":"bluetooth","state":"on"|"off"|"unauthorized"|"unsupported"} · {"kind":"log","message":…}
/// stdin:  {"cmd":"demand","active":…,"gyro":…,"orientation":…} · {"cmd":"holding","value":…}
///         {"cmd":"pairing","show":…} · {"cmd":"forget","id":…?} · {"cmd":"bindings","entries":[{trigger,profile,action}]} · {"cmd":"quit"}
/// stdout also: {"kind":"bindings","phone":…,"entries":[…]}
final class PhoneLinkHelper: NSObject, CBPeripheralManagerDelegate {
    private struct Hosted {
        let service: CBMutableService
        let control: CBMutableCharacteristic
        let inboundID: CBUUID
    }

    private var core: PhoneLinkCore
    private var manager: CBPeripheralManager!
    private var hosted: [UUID: Hosted] = [:]
    private var inboundToService: [CBUUID: UUID] = [:]
    private var centrals: [UUID: CBCentral] = [:]
    private var outbox: [(CBMutableCharacteristic, CBCentral, Data)] = []
    private var pendingAccepts: [UUID: (accept: Data, peer: UUID, pairService: UUID)] = [:]
    private var showPairingRequested = false
    private var pairingService: UUID?
    private var pairingTimer: Timer?
    private var ticker: Timer?
    private var memory: [UUID: PhoneLinkCore.PhoneMemory]
    private let memoryURL: URL?
    private var lastBluetooth = ""
    private let macName = Host.current().localizedName ?? "Mac"
    private var activity: NSObjectProtocol?
    private let cable = CableLink()

    private static var now: TimeInterval { ProcessInfo.processInfo.systemUptime }

    init(memoryURL: URL?) {
        self.memoryURL = memoryURL
        memory = memoryURL.flatMap { try? JSONDecoder().decode([UUID: PhoneLinkCore.PhoneMemory].self, from: Data(contentsOf: $0)) } ?? [:]
        var records: [RelayKeyStore.Record] = []
        do { records = try RelayKeyStore.all() } catch { Self.trace("Keychain: \(error.localizedDescription)") }
        core = PhoneLinkCore(records: records, memory: memory, now: Self.now)
        super.init()
    }

    func start() {
        // Gestures are input: App Nap must not delay them.
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep, .latencyCritical], reason: "Receiving gestures from iPhone")
        manager = CBPeripheralManager(delegate: self, queue: nil)
        ticker = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.apply(self.core.tick(now: Self.now))
        }
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.apply(self.core.sleep(now: Self.now))
        }
        center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.apply(self.core.wake(now: Self.now))
            self.advertise(restart: true)
        }
        cable.onPacket = { [weak self] peer, service, packet in
            // Pairing stays on Bluetooth, where the code on screen proves who is asking.
            guard let self, service != self.pairingService else { return }
            self.apply(self.core.receive(packet, from: peer, service: service, now: Self.now))
        }
        cable.onClosed = { [weak self] peer in
            guard let self else { return }
            for service in self.core.linkServices { self.apply(self.core.unsubscribed(peer, service: service, now: Self.now)) }
        }
        cable.onLog = { Self.trace($0) }
        cable.start()
        publishState()
        readCommands()
    }

    // MARK: Commands from Python

    private func readCommands() {
        Thread.detachNewThread { [weak self] in
            while let line = readLine(strippingNewline: true) {
                guard let data = line.data(using: .utf8),
                      let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                DispatchQueue.main.async { self?.handle(command) }
            }
            // The bridge went away: release the radio and exit.
            DispatchQueue.main.async { self?.quit() }
        }
    }

    private func handle(_ command: [String: Any]) {
        switch command["cmd"] as? String {
        case "demand":
            let demand = RelayWire.Demand(active: command["active"] as? Bool ?? true, gyro: command["gyro"] as? Bool ?? false,
                                          orientation: command["orientation"] as? Bool ?? false)
            apply(core.setDemand(demand, now: Self.now))
        case "holding":
            apply(core.setHolding(command["value"] as? Bool ?? false, now: Self.now))
        case "pairing":
            showPairingRequested = command["show"] as? Bool ?? false
            updatePairing()
        case "forget":
            let id = (command["id"] as? String).flatMap(UUID.init(uuidString:))
            apply(core.forget(id, now: Self.now))
        case "bindings":
            let rows = command["entries"] as? [[String: Any]] ?? []
            let list = rows.compactMap { row -> RelayWire.Binding? in
                guard let trigger = row["trigger"] as? String, let profile = row["profile"] as? String,
                      let action = row["action"] as? String else { return nil }
                return RelayWire.Binding(trigger: trigger, profile: profile, action: action)
            }
            apply(core.setBindings(list, now: Self.now))
        case "status":
            publishState(force: true)
            if let offer = core.offer { emitPairing(offer.invitation) }
        case "quit":
            quit()
        default:
            break
        }
    }

    private func quit() {
        manager?.stopAdvertising()
        exit(0)
    }

    // MARK: Pairing code

    private var wantsPairing: Bool { !core.isPaired || showPairingRequested }

    private func updatePairing() {
        guard manager?.state == .poweredOn else { return }
        if wantsPairing {
            if core.offer == nil || core.offer!.used || core.offer!.invitation.expires.timeIntervalSinceNow < 5 { newOffer() }
        } else if core.offer != nil, pendingAccepts.isEmpty {
            core.stopPairing()
            pairingTimer?.invalidate()
            removeService(pairingService)
            pairingService = nil
            Self.write(["kind": "pairing", "text": NSNull()])
            advertise(restart: true)
        }
    }

    private func newOffer() {
        let invitation = core.startPairing(macName: macName)
        Self.trace("new pairing code; pairing service \(invitation.service.uuidString.prefix(8))")
        removeService(pairingService)
        pairingService = invitation.service
        host(invitation.service)
        emitPairing(invitation)
        pairingTimer?.invalidate()
        // Codes are short-lived; show a new one before this one expires.
        pairingTimer = Timer.scheduledTimer(withTimeInterval: RelayWire.invitationLifetime - 10, repeats: false) { [weak self] _ in
            self?.updatePairingAfterExpiry()
        }
    }

    private func updatePairingAfterExpiry() {
        guard wantsPairing else { return }
        newOffer()
    }

    private func emitPairing(_ invitation: RelayWire.Invitation) {
        Self.write(["kind": "pairing", "text": invitation.text, "image": Self.qrImage(invitation.text) ?? NSNull(),
                    "expires": invitation.expires.timeIntervalSince1970, "mac": macName])
    }

    private static func qrImage(_ text: String) -> String? {
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(Data(text.utf8), forKey: "inputMessage")
        // High correction leaves room for the logo drawn over the center.
        filter.setValue("H", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let png = bitmap.representation(using: .png, properties: [:]) else { return nil }
        return "data:image/png;base64," + png.base64EncodedString()
    }

    // MARK: Applying core outputs

    private func apply(_ outputs: [PhoneLinkCore.Output]) {
        for output in outputs {
            switch output {
            case .send(let peer, let service, let packet):
                send(packet, to: peer, service: service)
            case .event(let event, let phone):
                emit(event, phone: phone)
            case .release(let reason):
                Self.write(["kind": "release", "reason": reason])
            case .state:
                publishState()
            case .paired(let record, let accept, let peer, let pairService):
                do {
                    try RelayKeyStore.save(record)
                } catch {
                    Self.trace("Could not save the pairing: \(error.localizedDescription)")
                    continue
                }
                Self.trace("pairing request verified from \(record.name); publishing its service")
                memory[record.id] = PhoneLinkCore.PhoneMemory()
                saveMemory()
                // Keep the pairing service until the accept is out: register the accept before anything
                // (such as the state change below) can decide pairing is over.
                pendingAccepts[record.pairing.service] = (accept, peer, pairService)
                showPairingRequested = false
                apply(core.commit(record, now: Self.now))
                // Publish the link service first; the accept goes out once it exists.
                host(record.pairing.service)
            case .removed(let id):
                let services = Set(core.linkServices)
                for (service, _) in hosted where service != pairingService && !services.contains(service) { removeService(service) }
                try? RelayKeyStore.delete(id)
                memory.removeValue(forKey: id)
                saveMemory()
                updatePairing()
                advertise(restart: true)
                publishState(force: true)
            case .remember(let id, let value):
                memory[id] = value
                saveMemory()
            case .log(let message):
                Self.trace(message)
            case .bindings(let list, let phone):
                Self.write(["kind": "bindings", "phone": phone,
                            "entries": list.map { ["trigger": $0.trigger, "profile": $0.profile, "action": $0.action] }])
            }
        }
    }

    private func emit(_ event: RelayWire.Event, phone: String) {
        var json: [String: Any] = ["kind": "event", "sequence": event.sequence, "timestamp": event.timestamp,
                                   "age_ms": Int((event.age * 1000).rounded())]
        switch event.kind {
        case .gesture:
            let g = event.gesture ?? [0, 0, 0, 0]
            json["type"] = "Gesture"
            json["finger_code"] = g[0]; json["action_code"] = g[1]; json["derived_action_code"] = g[2]; json["synthetic"] = g[3] != 0
        case .gyro:
            json["type"] = "Gyroscope"; json["values"] = event.values ?? []
        case .orientation:
            json["type"] = "Orientation"; json["values"] = event.values ?? []
        }
        Self.write(json)
    }

    private var lastPublished = ""

    private func publishState(force: Bool = false) {
        let (state, phone) = core.state(now: Self.now)
        let phones = core.records.map { ["id": $0.id.uuidString, "name": $0.name] }
        let key = "\(state.rawValue)|\(phone ?? "")|\(phones.count)"
        guard force || key != lastPublished else { return }
        lastPublished = key
        Self.write(["kind": "link", "state": state.rawValue, "phone": phone ?? NSNull(), "phones": phones])
        updatePairing()
    }

    private func saveMemory() {
        guard let memoryURL, let data = try? JSONEncoder().encode(memory) else { return }
        try? data.write(to: memoryURL, options: .atomic)
    }

    // MARK: GATT

    private func host(_ service: UUID) {
        guard hosted[service] == nil, manager?.state == .poweredOn else { return }
        let control = CBMutableCharacteristic(type: CBUUID(nsuuid: RelayWire.characteristic(.control, of: service)), properties: [.notify], value: nil, permissions: [])
        let inboundID = CBUUID(nsuuid: RelayWire.characteristic(.inbound, of: service))
        let inbound = CBMutableCharacteristic(type: inboundID, properties: [.writeWithoutResponse], value: nil, permissions: [.writeable])
        // No OS-level bond: the relay authenticates and encrypts every packet itself. macOS can lose a
        // bond its peripheral role made (for example across a restart) while iOS keeps it, and iOS then
        // fails every connect with "Failed to encrypt the connection" until the user forgets the Mac.
        let gatt = CBMutableService(type: CBUUID(nsuuid: service), primary: true)
        gatt.characteristics = [control, inbound]
        hosted[service] = Hosted(service: gatt, control: control, inboundID: inboundID)
        inboundToService[inboundID] = service
        manager.add(gatt)
    }

    private func removeService(_ service: UUID?) {
        guard let service, let entry = hosted.removeValue(forKey: service) else { return }
        inboundToService.removeValue(forKey: entry.inboundID)
        manager?.remove(entry.service)
    }

    private func advertise(restart: Bool = false) {
        guard let manager, manager.state == .poweredOn else { return }
        let services = hosted.keys.map { CBUUID(nsuuid: $0) }
        if restart || manager.isAdvertising { manager.stopAdvertising() }
        guard !services.isEmpty else { return }
        manager.startAdvertising([CBAdvertisementDataServiceUUIDsKey: services])
    }

    private func send(_ packet: Data, to peer: UUID, service: UUID) {
        if cable.send(packet, to: peer, service: service) { return }
        guard let central = centrals[peer], let entry = hosted[service] else { return }
        guard packet.count <= central.maximumUpdateValueLength else {
            Self.trace("Bluetooth link too small for a \(packet.count)-byte message")
            return
        }
        if !outbox.isEmpty || !manager.updateValue(packet, for: entry.control, onSubscribedCentrals: [central]) {
            outbox.append((entry.control, central, packet))
            if outbox.count > 128 { outbox.removeFirst(outbox.count - 128) }
        }
    }

    func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        while let (control, central, packet) = outbox.first {
            guard peripheral.updateValue(packet, for: control, onSubscribedCentrals: [central]) else { return }
            outbox.removeFirst()
        }
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        let state: String
        switch peripheral.state {
        case .poweredOn: state = "on"
        case .unauthorized: state = "unauthorized"
        case .unsupported: state = "unsupported"
        default: state = "off"
        }
        if state != lastBluetooth {
            lastBluetooth = state
            Self.trace("bluetooth \(state)")
            Self.write(["kind": "bluetooth", "state": state])
        }
        guard peripheral.state == .poweredOn else {
            hosted.removeAll()
            inboundToService.removeAll()
            centrals.removeAll()
            outbox.removeAll()
            apply(core.endAll("Bluetooth is off", keeping: cable.peers, now: Self.now))
            return
        }
        peripheral.removeAllServices()
        hosted.removeAll()
        inboundToService.removeAll()
        pairingService = nil
        for service in core.linkServices { host(service) }
        if wantsPairing { newOffer() }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error {
            Self.trace("Could not publish a Bluetooth service: \(error.localizedDescription)")
            return
        }
        guard let id = UUID(uuidString: service.uuid.uuidString) else { return }
        Self.trace("published \(label(id))")
        advertise(restart: true)
        if let pending = pendingAccepts.removeValue(forKey: id), let entry = hosted[pending.pairService], let central = centrals[pending.peer] {
            Self.trace("sending pairing accept")
            if !peripheral.updateValue(pending.accept, for: entry.control, onSubscribedCentrals: [central]) {
                outbox.append((entry.control, central, pending.accept))
            }
            core.stopPairing()
            // Keep the pairing service a little longer, so the phone can read the accept before it disappears.
            Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
                guard let self, self.core.offer == nil else { return }
                self.removeService(pending.pairService)
                if self.pairingService == pending.pairService { self.pairingService = nil }
                Self.write(["kind": "pairing", "text": NSNull()])
                self.advertise(restart: true)
            }
            publishState(force: true)
        }
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error { Self.trace("Bluetooth advertising failed: \(error.localizedDescription)") }
        else { Self.trace("advertising \(hosted.count) service(s)") }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        centrals[central.identifier] = central
        peripheral.setDesiredConnectionLatency(.low, for: central)
        if let service = hosted.first(where: { $0.value.control.uuid == characteristic.uuid })?.key {
            Self.trace("central \(central.identifier.uuidString.prefix(8)) subscribed to \(label(service)) (max \(central.maximumUpdateValueLength) bytes)")
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        guard let service = hosted.first(where: { $0.value.control.uuid == characteristic.uuid })?.key else { return }
        Self.trace("central \(central.identifier.uuidString.prefix(8)) unsubscribed from \(label(service))")
        apply(core.unsubscribed(central.identifier, service: service, now: Self.now))
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        guard hosted.values.contains(where: { $0.service.characteristics?.contains { $0.uuid == request.characteristic.uuid && $0.properties.contains(.read) } ?? false }) else {
            peripheral.respond(to: request, withResult: .attributeNotFound)
            return
        }
        request.value = Data([1])
        peripheral.respond(to: request, withResult: .success)
        Self.trace("bond read by \(request.central.identifier.uuidString.prefix(8)) (link encrypted)")
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            guard let service = inboundToService[request.characteristic.uuid], let packet = request.value else { continue }
            centrals[request.central.identifier] = request.central
            if packet.count >= 2, packet[packet.startIndex + 1] < 0x10 {
                Self.trace("received \(["", "pair request", "pair accept", "pair reject", "hello", "mac hello", "reset"][min(Int(packet[packet.startIndex + 1]), 6)]) on \(label(service))")
            }
            apply(core.receive(packet, from: request.central.identifier, service: service, now: Self.now))
        }
    }

    // MARK: Output

    /// Connection diagnostics, never keys or codes: ~/Library/Logs/Runes/phone-link.log
    private static let logHandle: FileHandle? = {
        let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Runes", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("phone-link.log")
        if let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int, size > 2_000_000 { try? FileManager.default.removeItem(at: url) }
        if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
        let handle = try? FileHandle(forWritingTo: url)
        _ = try? handle?.seekToEnd()
        return handle
    }()

    static func trace(_ message: String) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        logHandle?.write(Data("\(stamp) \(message)\n".utf8))
        write(["kind": "log", "message": message])
    }

    private func label(_ service: UUID) -> String {
        service == pairingService ? "pairing service" : "link service \(service.uuidString.prefix(8))"
    }

    private static let output = FileHandle.standardOutput
    static func write(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        output.write(data + Data([10]))
    }
}

@main
struct PhoneLinkMain {
    static func main() {
        signal(SIGPIPE, SIG_IGN)
        var memory: URL?
        let arguments = CommandLine.arguments
        if let index = arguments.firstIndex(of: "--state"), index + 1 < arguments.count { memory = URL(fileURLWithPath: arguments[index + 1]) }
        let helper = PhoneLinkHelper(memoryURL: memory)
        helper.start()
        withExtendedLifetime(helper) { RunLoop.main.run() }
    }
}
