import Foundation

/// Reaches Runes on a plugged-in iPhone through usbmuxd, the system service that carries TCP to an
/// iPhone over its cable. The phone app listens on `RelayWire.usbPort`; this dials it for as long as a
/// phone is attached and hands the link's packets to `PhoneLinkCore` exactly as GATT does. Each
/// connection is one peer. Nothing here is trusted: the packets authenticate themselves.
///
/// Callbacks arrive on the main queue; call `start`, `send` and `peers` there too.
final class CableLink {
    var onPacket: ((_ peer: UUID, _ service: UUID, _ packet: Data) -> Void)?
    var onClosed: ((_ peer: UUID) -> Void)?
    var onLog: ((String) -> Void)?

    private var sockets: [UUID: Int32] = [:]
    /// usbmuxd device IDs attached by cable (not the ones it sees over Wi-Fi).
    private var attached: Set<Int> = []
    /// Devices with a dial in progress or a connection open.
    private var busy: Set<Int> = []

    var peers: Set<UUID> { Set(sockets.keys) }

    func start() {
        Thread.detachNewThread { [self] in watch() }
    }

    /// False when `peer` is not a cable connection.
    func send(_ packet: Data, to peer: UUID, service: UUID) -> Bool {
        guard let fd = sockets[peer] else { return false }
        // A failed write ends the connection; the reader notices and cleans up.
        if !Self.put(fd, RelayWire.usbFrame(service: service, packet)) { shutdown(fd, SHUT_RDWR) }
        return true
    }

    // MARK: Devices

    private func watch() {
        while true {
            if let fd = Self.dial(), Self.put(fd, message: ["MessageType": "Listen"]) {
                while let message = Self.message(fd) {
                    guard let device = message["DeviceID"] as? Int else { continue }
                    switch message["MessageType"] as? String {
                    case "Attached":
                        guard (message["Properties"] as? [String: Any])?["ConnectionType"] as? String == "USB" else { continue }
                        DispatchQueue.main.async { [self] in
                            attached.insert(device)
                            connect(device, attempt: 0)
                        }
                    case "Detached":
                        DispatchQueue.main.async { [self] in _ = attached.remove(device) }
                    default:
                        break
                    }
                }
                Darwin.close(fd)
                DispatchQueue.main.async { [self] in attached.removeAll() }
            }
            Thread.sleep(forTimeInterval: 5)
        }
    }

    /// Dials the phone app until it answers or the phone is unplugged. The app may not be running yet.
    private func connect(_ device: Int, attempt: Int) {
        guard attached.contains(device), attempt > 0 || !busy.contains(device) else {
            if attempt > 0 { busy.remove(device) }
            return
        }
        busy.insert(device)
        Thread.detachNewThread { [self] in
            let fd = Self.tunnel(to: device)
            DispatchQueue.main.async { [self] in
                guard let fd else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + (attempt < 15 ? 2 : 5)) { [self] in connect(device, attempt: attempt + 1) }
                    return
                }
                let peer = UUID()
                sockets[peer] = fd
                onLog?("cable connected to an iPhone")
                Thread.detachNewThread { [self] in read(fd, peer: peer, device: device) }
            }
        }
    }

    private func read(_ fd: Int32, peer: UUID, device: Int) {
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 16384)
        reading: while true {
            let count = Darwin.read(fd, &chunk, chunk.count)
            if count < 0, errno == EINTR { continue }
            guard count > 0 else { break }
            buffer.append(contentsOf: chunk[0..<count])
            guard let frames = try? RelayWire.usbFrames(&buffer) else { break reading }
            if frames.isEmpty { continue }
            DispatchQueue.main.async { [self] in
                guard sockets[peer] != nil else { return }
                for frame in frames { onPacket?(peer, frame.service, frame.packet) }
            }
        }
        DispatchQueue.main.async { [self] in
            sockets.removeValue(forKey: peer)
            Darwin.close(fd)
            busy.remove(device)
            onLog?("cable disconnected")
            onClosed?(peer)
            // Still plugged in: the app closed or restarted, so keep dialing.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [self] in connect(device, attempt: 0) }
        }
    }

    // MARK: usbmuxd

    private static func dial() -> Int32? {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &address.sun_path) { path in
            "/var/run/usbmuxd".utf8CString.withUnsafeBytes { path.copyMemory(from: UnsafeRawBufferPointer(rebasing: $0.prefix(path.count - 1))) }
        }
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard result == 0 else { Darwin.close(fd); return nil }
        return fd
    }

    /// A socket that, once this returns, is a TCP connection to the phone app.
    private static func tunnel(to device: Int) -> Int32? {
        guard let fd = dial() else { return nil }
        // usbmuxd wants the port in network byte order inside a host-order integer.
        let port = Int(RelayWire.usbPort.byteSwapped)
        guard put(fd, message: ["MessageType": "Connect", "DeviceID": device, "PortNumber": port]),
              let reply = message(fd), reply["Number"] as? Int == 0 else {
            Darwin.close(fd)
            return nil
        }
        // Sends come from the main queue; a phone that stops reading must not stall it.
        var timeout = timeval(tv_sec: 1, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        return fd
    }

    private static func put(_ fd: Int32, message: [String: Any]) -> Bool {
        var body = message
        body["ProgName"] = "Runes"
        body["ClientVersionString"] = "runes-phone-link"
        guard let plist = try? PropertyListSerialization.data(fromPropertyList: body, format: .xml, options: 0) else { return false }
        var header = Data()
        // Length, protocol version 1, message type 8 (plist), tag. Little-endian.
        for field in [UInt32(16 + plist.count), 1, 8, 1] { withUnsafeBytes(of: field.littleEndian) { header.append(contentsOf: $0) } }
        return put(fd, header + plist)
    }

    private static func message(_ fd: Int32) -> [String: Any]? {
        guard let header = take(fd, 16) else { return nil }
        let length = header.prefix(4).reversed().reduce(0) { $0 << 8 | Int($1) }
        guard length >= 16, length <= 1 << 20, let body = take(fd, length - 16) else { return nil }
        return (try? PropertyListSerialization.propertyList(from: body, format: nil)) as? [String: Any]
    }

    private static func put(_ fd: Int32, _ data: Data) -> Bool {
        data.withUnsafeBytes { bytes in
            var sent = 0
            while sent < bytes.count {
                let count = Darwin.write(fd, bytes.baseAddress! + sent, bytes.count - sent)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { return false }
                sent += count
            }
            return true
        }
    }

    private static func take(_ fd: Int32, _ length: Int) -> Data? {
        var data = Data(count: length)
        var filled = 0
        while filled < length {
            let count = data.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress! + filled, length - filled) }
            if count < 0, errno == EINTR { continue }
            guard count > 0 else { return nil }
            filled += count
        }
        return data
    }
}
