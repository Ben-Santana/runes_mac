import Foundation

/// The Mac's side of the iPhone link, without Bluetooth: pairing, sessions, leases, the hold watchdog,
/// and which events are fresh enough to act on. `PhoneLinkHelper` moves its packets over GATT,
/// or over the cable while the phone is plugged in (`CableLink`).
final class PhoneLinkCore {
    typealias Demand = RelayWire.Demand
    typealias Peer = UUID

    enum LinkState: String {
        /// No iPhone is paired. The pairing code is showing.
        case unpaired
        /// Just started; the phone usually reconnects within about 10 seconds.
        case searching
        case connected
        /// Paired, but the phone is out of range or Bluetooth is off.
        case away
        /// The phone app is not running (it quit, or the phone restarted). Opening it once fixes this.
        case openApp = "open_app"
        case sleeping
    }

    enum Output: Equatable {
        case send(peer: Peer, service: UUID, packet: Data)
        case event(RelayWire.Event, phone: String)
        /// Release every held key, button and adjustment now.
        case release(String)
        case state(LinkState, phone: String?)
        /// A phone completed pairing. Save the record, publish its service, then send `accept`.
        case paired(RelayKeyStore.Record, accept: Data, peer: Peer, pairService: UUID)
        /// The phone removed this Mac. Delete the record and stop publishing its service.
        case removed(UUID)
        case remember(UUID, PhoneMemory)
        case log(String)
        /// The phone's gesture assignments, received whole.
        case bindings([RelayWire.Binding], phone: String)
    }

    /// What the Mac remembers about a phone between launches. Not secret.
    struct PhoneMemory: Codable, Equatable {
        var everConnected = false
        /// The phone said goodbye because its app was closing; iOS will not relaunch it for Bluetooth.
        var appClosed = false
    }

    private struct Phone {
        var record: RelayKeyStore.Record
        var memory: PhoneMemory
        var peer: Peer?
        var session: RelayWire.Session?
        var applied = false
        var lastInbound: TimeInterval = 0
        var lease: TimeInterval = RelayWire.leaseDuration
        var lastPing: TimeInterval = 0
        var pingID: UInt16 = 0
        var holdReleased = false
        var lastReset: TimeInterval = -.infinity
        var assembler = RelayWire.BindingsAssembler()
        var service: UUID { record.pairing.service }
    }

    private var phones: [UUID: Phone] = [:]
    private(set) var offer: RelayWire.MacPairing?
    private(set) var demand = Demand.gestures
    private(set) var holding = false
    private(set) var sleeping = false
    private var startedAt: TimeInterval
    private var lastState: (LinkState, String?)?
    private(set) var bindings: [RelayWire.Binding] = []
    private var bindingsGeneration: UInt16 = 0
    static let searchGrace: TimeInterval = 20

    init(records: [RelayKeyStore.Record], memory: [UUID: PhoneMemory] = [:], now: TimeInterval) {
        startedAt = now
        for record in records { phones[record.id] = Phone(record: record, memory: memory[record.id] ?? PhoneMemory()) }
    }

    var records: [RelayKeyStore.Record] { phones.values.map(\.record).sorted { $0.created < $1.created } }
    var linkServices: [UUID] { records.map { $0.pairing.service } }
    var isPaired: Bool { !phones.isEmpty }

    // MARK: State

    func state(now: TimeInterval) -> (LinkState, String?) {
        if phones.isEmpty { return (.unpaired, nil) }
        if let live = phones.values.first(where: { $0.session != nil }) { return (.connected, live.record.name) }
        let first = records.first.flatMap { phones[$0.id] }
        let name = first?.record.name
        if sleeping { return (.sleeping, name) }
        if now - startedAt < Self.searchGrace { return (.searching, name) }
        if phones.values.allSatisfy({ !$0.memory.everConnected || $0.memory.appClosed }) { return (.openApp, name) }
        return (.away, name)
    }

    private func stateChange(_ now: TimeInterval) -> [Output] {
        let current = state(now: now)
        if let lastState, lastState.0 == current.0, lastState.1 == current.1 { return [] }
        lastState = current
        return [.state(current.0, phone: current.1)]
    }

    // MARK: Inputs

    /// This Mac's assignments, sent to every connected phone now and to each phone that connects later.
    func setBindings(_ next: [RelayWire.Binding], now: TimeInterval) -> [Output] {
        guard next != bindings else { return [] }
        bindings = next
        bindingsGeneration &+= 1
        return phones.keys.filter { phones[$0]?.session != nil }.flatMap { sendBindings($0, now: now) }
    }

    private func sendBindings(_ id: UUID, now: TimeInterval) -> [Output] {
        RelayWire.bindingChunks(bindings, generation: bindingsGeneration).flatMap { seal(id, $0, now: now) }
    }

    func setDemand(_ next: Demand, now: TimeInterval) -> [Output] {
        guard next != demand else { return [] }
        demand = next
        var out: [Output] = []
        for id in phones.keys where phones[id]?.session != nil {
            phones[id]?.applied = false
            out += seal(id, .demand(effectiveDemand), now: now)
        }
        return out
    }

    private var effectiveDemand: Demand { sleeping ? .idle : demand }

    func setHolding(_ value: Bool, now: TimeInterval) -> [Output] {
        guard value != holding else { return [] }
        holding = value
        var out: [Output] = []
        for id in phones.keys {
            phones[id]?.holdReleased = false
            // Ping right away so the watchdog starts from a fresh reply.
            if value, phones[id]?.session != nil { out += ping(id, now: now) }
        }
        return out
    }

    func sleep(now: TimeInterval) -> [Output] {
        var out: [Output] = []
        for id in phones.keys where phones[id]?.session != nil {
            out += seal(id, .bye(.sleeping), now: now)
            phones[id]?.session = nil
            phones[id]?.applied = false
        }
        sleeping = true
        return out + [.release("Mac is going to sleep")] + stateChange(now)
    }

    func wake(now: TimeInterval) -> [Output] {
        sleeping = false
        // The phone needs a moment to notice; treat it like a fresh start.
        startedAt = now
        return stateChange(now)
    }

    func startPairing(macName: String, now: Date = Date()) -> RelayWire.Invitation {
        let fresh = RelayWire.MacPairing(macName: macName, now: now)
        offer = fresh
        return fresh.invitation
    }

    func stopPairing() { offer = nil }

    /// Called by the helper once the record is saved and its service is published.
    func commit(_ record: RelayKeyStore.Record, now: TimeInterval) -> [Output] {
        phones[record.id] = Phone(record: record, memory: PhoneMemory())
        startedAt = now
        return stateChange(now)
    }

    func forget(_ id: UUID?, now: TimeInterval) -> [Output] {
        let ids = id.map { [$0] } ?? Array(phones.keys)
        var out: [Output] = []
        for id in ids {
            guard phones[id] != nil else { continue }
            if phones[id]?.session != nil { out += seal(id, .bye(.removed), now: now) }
            phones.removeValue(forKey: id)
            out.append(.removed(id))
        }
        return out + [.release("iPhone removed")] + stateChange(now)
    }

    /// Bluetooth turned off or reset: every session it carried is gone. Sessions with `keeping` peers (the cable) stay.
    func endAll(_ reason: String, keeping: Set<Peer> = [], now: TimeInterval) -> [Output] {
        let ending = phones.filter { !($0.value.peer.map(keeping.contains) ?? false) }
        let had = ending.values.contains { $0.session != nil }
        for id in ending.keys {
            phones[id]?.session = nil
            phones[id]?.peer = nil
            phones[id]?.applied = false
        }
        return (had ? [.release(reason)] : []) + stateChange(now)
    }

    func unsubscribed(_ peer: Peer, service: UUID, now: TimeInterval) -> [Output] {
        guard let id = phones.first(where: { $0.value.peer == peer && $0.value.service == service })?.key else { return [] }
        let hadSession = phones[id]?.session != nil
        phones[id]?.session = nil
        phones[id]?.peer = nil
        phones[id]?.applied = false
        return (hadSession ? [.release("iPhone disconnected")] : []) + stateChange(now)
    }

    func receive(_ packet: Data, from peer: Peer, service: UUID, now: TimeInterval) -> [Output] {
        if let offer, service == offer.invitation.service { return receivePairing(packet, peer: peer, service: service) }
        guard let id = phones.first(where: { $0.value.service == service })?.key, let phone = phones[id] else { return [] }
        let header: RelayWire.Header
        do { header = try RelayWire.Header(packet) } catch {
            return [.log("Ignored an unreadable packet from \(phone.record.name)")]
        }
        switch header.kind {
        case .phoneHello:
            do {
                let phoneNonce = try RelayWire.readPhoneHello(packet, phone.record.pairing)
                let macNonce = RelayWire.random(16)
                let hadSession = phone.session != nil
                var next = phone
                next.peer = peer
                next.session = RelayWire.Session(phone.record.pairing, phoneNonce: phoneNonce, macNonce: macNonce, isPhone: false)
                next.applied = false
                next.lastInbound = now
                next.holdReleased = false
                next.memory.appClosed = false
                let firstConnection = !next.memory.everConnected
                next.memory.everConnected = true
                phones[id] = next
                var out: [Output] = hadSession ? [.release("iPhone started a new session")] : []
                out.append(.send(peer: peer, service: service, packet: RelayWire.macHello(phone.record.pairing, phoneNonce: phoneNonce, macNonce: macNonce)))
                out += seal(id, .demand(effectiveDemand), now: now)
                out += sendBindings(id, now: now)
                if firstConnection || phone.memory.appClosed { out.append(.remember(id, next.memory)) }
                return out + stateChange(now)
            } catch {
                return [.log("Rejected a hello from an unpaired device")]
            }
        case let kind where kind.sealed:
            guard var session = phone.session, phone.peer == peer, header.tag == session.tag else {
                // A phone still using a session this Mac dropped (lease expiry, restart) is told to say hello again.
                guard now - phone.lastReset >= 1, let tag = header.tag else { return [] }
                phones[id]?.lastReset = now
                return [.send(peer: peer, service: service, packet: RelayWire.reset(tag: tag))]
            }
            let message: RelayWire.Message
            do { message = try session.open(packet) } catch {
                phones[id]?.session = nil
                phones[id]?.applied = false
                return [.log("Dropped a session after a message failed authentication"), .release("iPhone link reset"),
                        .send(peer: peer, service: service, packet: RelayWire.reset(tag: session.tag))] + stateChange(now)
            }
            phones[id]?.session = session
            phones[id]?.lastInbound = now
            phones[id]?.holdReleased = false
            return handle(id, message, now: now)
        default:
            return []
        }
    }

    private func handle(_ id: UUID, _ message: RelayWire.Message, now: TimeInterval) -> [Output] {
        guard let phone = phones[id] else { return [] }
        switch message {
        case .ready(let ready):
            phones[id]?.applied = ready != nil && ready == effectiveDemand && effectiveDemand.active
            return []
        case .lease(let seconds, _):
            phones[id]?.lease = min(max(seconds, 5), 60)
            return []
        case .pong:
            return []
        case .event(let event):
            guard accepts(event, phone) else { return [] }
            return [.event(event, phone: phone.record.name)]
        case .bye(let reason):
            phones[id]?.session = nil
            phones[id]?.applied = false
            switch reason {
            case .removed:
                phones.removeValue(forKey: id)
                return [.release("iPhone removed this Mac"), .removed(id)] + stateChange(now)
            case .terminating:
                phones[id]?.memory.appClosed = true
                return [.release("Runes closed on iPhone"), .remember(id, phones[id]!.memory)] + stateChange(now)
            default:
                return [.release("iPhone disconnected")] + stateChange(now)
            }
        case .bindings(let chunk):
            guard let list = phones[id]?.assembler.add(chunk) else { return [] }
            return [.bindings(list, phone: phone.record.name)]
        case .demand, .ping:
            return []
        }
    }

    /// Stale or unrequested events never reach the shortcut engine. Releases always do, so nothing stays held.
    private func accepts(_ event: RelayWire.Event, _ phone: Phone) -> Bool {
        if event.isRelease { return true }
        guard phone.applied, effectiveDemand.active else { return false }
        switch event.kind {
        case .gesture: return event.age <= RelayWire.gestureMaxAge
        case .gyro: return effectiveDemand.gyro && event.age <= RelayWire.motionMaxAge
        case .orientation: return effectiveDemand.orientation && event.age <= RelayWire.motionMaxAge
        }
    }

    /// Call about twice a second.
    func tick(now: TimeInterval) -> [Output] {
        var out: [Output] = []
        for id in phones.keys {
            guard let phone = phones[id], phone.session != nil else { continue }
            let silence = now - phone.lastInbound
            if silence > phone.lease {
                phones[id]?.session = nil
                phones[id]?.applied = false
                out.append(.release("iPhone link went quiet"))
                out.append(.log("Lease expired for \(phone.record.name) after \(Int(silence)) s"))
                continue
            }
            if holding {
                if silence > RelayWire.holdTimeout, !phone.holdReleased {
                    phones[id]?.holdReleased = true
                    out.append(.release("No reply from iPhone during a hold"))
                }
                if now - phone.lastPing >= RelayWire.holdPingInterval { out += ping(id, now: now) }
            }
        }
        return out + stateChange(now)
    }

    private func ping(_ id: UUID, now: TimeInterval) -> [Output] {
        guard let phone = phones[id] else { return [] }
        phones[id]?.lastPing = now
        phones[id]?.pingID = phone.pingID &+ 1
        return seal(id, .ping(phone.pingID &+ 1), now: now)
    }

    private func seal(_ id: UUID, _ message: RelayWire.Message, now: TimeInterval) -> [Output] {
        guard var session = phones[id]?.session, let peer = phones[id]?.peer, let service = phones[id]?.service else { return [] }
        do {
            let packet = try session.seal(message, now: now)
            phones[id]?.session = session
            return [.send(peer: peer, service: service, packet: packet)]
        } catch {
            return [.log("Could not encode a message for the iPhone")]
        }
    }

    private func receivePairing(_ packet: Data, peer: Peer, service: UUID) -> [Output] {
        guard var offer else { return [] }
        do {
            let (accept, pairing, phoneName) = try offer.respond(to: packet)
            self.offer = offer
            let record = RelayKeyStore.Record(id: pairing.id, name: phoneName.isEmpty ? "iPhone" : phoneName,
                                              secret: pairing.secret, created: Date())
            return [.paired(record, accept: accept, peer: peer, pairService: service)]
        } catch RelayWire.Failure.tokenUsed {
            return [.send(peer: peer, service: service, packet: RelayWire.MacPairing.reject)]
        } catch {
            return [.log("Rejected a pairing request: \(error.localizedDescription)")]
        }
    }
}
