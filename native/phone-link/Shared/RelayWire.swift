import Foundation
import CryptoKit

/// iPhone ↔ Mac relay protocol, version 1.
///
/// The iPhone is the BLE central and the Mac the peripheral. Every GATT value is one complete packet:
///
///     byte 0      protocol version (1)
///     byte 1      kind
///     plaintext kinds (pairing and handshake) follow with their own fields;
///     sealed kinds follow with: session tag (4) · counter (u32 BE) · ChaCha20-Poly1305 ciphertext + tag (16)
///
/// All integers are big-endian. Canonical copy: RunesIOS/RunesIOS/Relay/RelayWire.swift.
/// The Mac app vendors this file byte for byte (mac_os_meta_band_app/scripts/sync-relay-wire.sh).
enum RelayWire {
    static let version: UInt8 = 1
    /// Larger than any packet this version sends. Apple-to-Apple links negotiate an ATT MTU of 185 or more.
    static let maxPacket = 160
    static let invitationLifetime: TimeInterval = 120
    /// The phone renews its lease this often while it runs. A locked phone still runs at least every ~7 s
    /// because the band's GATT pulse wakes it (Documentation/WakeTest.md).
    static let leaseInterval: TimeInterval = 4
    /// The Mac treats a link as stale when nothing authenticated arrives for this long.
    static let leaseDuration: TimeInterval = 25
    /// While a key, button or adjustment is held, the Mac pings this often and releases after `holdTimeout` of silence.
    static let holdPingInterval: TimeInterval = 1
    static let holdTimeout: TimeInterval = 2.5
    /// Events older than this, measured on the phone from band receipt to sending, are rejected.
    static let gestureMaxAge: TimeInterval = 1
    static let motionMaxAge: TimeInterval = 0.2

    enum Failure: LocalizedError, Equatable {
        case invalidInvitation, expiredInvitation, invalidPacket, unsupportedVersion, authentication, replay, tokenUsed
        var errorDescription: String? {
            switch self {
            case .invalidInvitation: return "This isn't a Runes Mac code."
            case .expiredInvitation: return "This code expired. Scan the new code on your Mac."
            case .invalidPacket: return "The Mac link sent an invalid message."
            case .unsupportedVersion: return "Update Runes on this iPhone and on your Mac."
            case .authentication: return "The Mac link could not be verified."
            case .replay: return "The Mac link repeated a message."
            case .tokenUsed: return "This code was already used. Scan the new code on your Mac."
            }
        }
    }

    enum Kind: UInt8, Sendable {
        // Plaintext: pairing and handshake. Their contents are bound by keys only the two peers hold.
        case pairRequest = 0x01, pairAccept = 0x02, pairReject = 0x03
        case phoneHello = 0x04, macHello = 0x05, reset = 0x06
        // Sealed with the session keys.
        case demand = 0x10, ready = 0x11, gesture = 0x12, gyro = 0x13, orientation = 0x14
        case lease = 0x15, ping = 0x16, pong = 0x17, bye = 0x18
        /// Either direction: one chunk of the sender's gesture assignments. Older peers ignore this kind.
        case bindings = 0x19

        var sealed: Bool { rawValue >= 0x10 }
    }

    // MARK: - Messages

    struct Demand: Codable, Equatable, Sendable {
        let active: Bool
        let gyro: Bool
        let orientation: Bool
        static let idle = Self(active: false, gyro: false, orientation: false)
        static let gestures = Self(active: true, gyro: false, orientation: false)
        static let motion = Self(active: true, gyro: true, orientation: true)

        var flags: UInt8 { (active ? 1 : 0) | (gyro ? 2 : 0) | (orientation ? 4 : 0) }
        init(active: Bool, gyro: Bool, orientation: Bool) {
            self.active = active; self.gyro = gyro; self.orientation = orientation
        }
        init(flags: UInt8) {
            self.init(active: flags & 1 != 0, gyro: flags & 2 != 0, orientation: flags & 4 != 0)
        }
        /// True when streams opened for `self` also satisfy `other`.
        func covers(_ other: Demand) -> Bool {
            guard other.active else { return true }
            return active && (gyro || !other.gyro) && (orientation || !other.orientation)
        }
        static func union(_ demands: [Demand]) -> Demand {
            demands.reduce(.idle) { Demand(active: $0.active || $1.active, gyro: $0.gyro || $1.gyro, orientation: $0.orientation || $1.orientation) }
        }
    }

    struct Event: Codable, Equatable, Sendable {
        enum Kind: String, Codable, Sendable { case gesture, gyro, orientation }
        let kind: Kind
        let sequence: UInt64
        let timestamp: UInt64
        /// When the phone received this from the band (`systemUptime`). Zero on a decoded event.
        let phoneUptime: TimeInterval
        let phoneTime: Date
        /// finger, action, derived action, synthetic (0/1).
        var gesture: [UInt64]? = nil
        var values: [Double]? = nil
        /// Phone-side delay from band receipt to sending. Set on a decoded event.
        var age: TimeInterval = 0

        /// A release ends a held key or button. It must never be dropped as stale.
        var isRelease: Bool {
            guard kind == .gesture, let gesture, gesture.count >= 3 else { return false }
            return gesture[1] == 2 || gesture[2] == 4 || gesture[2] == 10
        }
    }

    struct PhoneState: Equatable, Sendable {
        enum App: UInt8, Sendable { case unknown = 0, foreground = 1, background = 2, launching = 3 }
        enum Band: UInt8, Sendable { case disconnected = 0, connecting = 1, streaming = 2 }
        var app: App
        var band: Band
        static let unknown = Self(app: .unknown, band: .disconnected)
    }

    enum ByeReason: UInt8, Sendable {
        /// `removed`: the sender deleted this pairing. `sleeping`: the Mac is going to sleep.
        case normal = 0, removed = 1, terminating = 2, sleeping = 3
    }

    enum Message: Equatable, Sendable {
        case demand(Demand)
        case ready(Demand?)
        case event(Event)
        case lease(seconds: TimeInterval, state: PhoneState)
        case ping(UInt16)
        case pong(UInt16, PhoneState)
        case bye(ByeReason)
        case bindings(BindingsChunk)
    }

    // MARK: - Gesture assignments shared between the two apps

    /// One assigned gesture or combo. `trigger` is a gesture id (`tap-index`) or a combo's steps joined by
    /// spaces, each `gesture[:axis[:direction]]` (`hold-index rotation:x:left release-index`).
    struct Binding: Codable, Equatable, Hashable, Sendable {
        let trigger: String
        let profile: String
        let action: String
        init(trigger: String, profile: String, action: String) {
            self.trigger = trigger; self.profile = RelayWire.clip(profile, 40); self.action = RelayWire.clip(action, 60)
        }
    }

    struct BindingsChunk: Equatable, Sendable {
        let generation: UInt16
        let index: UInt8
        let count: UInt8
        let data: Data
    }

    static let bindingsChunkSize = 120
    static let bindingsMaxChunks = 48

    /// Splits a binding list into sealed-message chunks. The list is zlib-compressed JSON.
    static func bindingChunks(_ bindings: [Binding], generation: UInt16) -> [Message] {
        var list = bindings
        while true {
            let json = (try? JSONEncoder().encode(list.map { [$0.trigger, $0.profile, $0.action] })) ?? Data("[]".utf8)
            let packed = (try? (json as NSData).compressed(using: .zlib) as Data) ?? Data()
            let count = max(1, (packed.count + bindingsChunkSize - 1) / bindingsChunkSize)
            if count <= bindingsMaxChunks || list.isEmpty {
                return (0..<count).map { i in
                    let start = i * bindingsChunkSize
                    let part = packed.subdata(in: min(start, packed.count)..<min(start + bindingsChunkSize, packed.count))
                    return .bindings(BindingsChunk(generation: generation, index: UInt8(i), count: UInt8(count), data: part))
                }
            }
            list.removeLast(max(1, list.count / 4))
        }
    }

    /// Collects chunks until one generation is complete.
    struct BindingsAssembler {
        private var generation: UInt16?
        private var parts: [UInt8: Data] = [:]
        private var count: UInt8 = 0

        mutating func add(_ chunk: BindingsChunk) -> [Binding]? {
            guard chunk.count > 0, chunk.index < chunk.count else { return nil }
            if chunk.generation != generation || chunk.count != count {
                generation = chunk.generation; count = chunk.count; parts = [:]
            }
            parts[chunk.index] = chunk.data
            guard parts.count == Int(count) else { return nil }
            let packed = (0..<count).reduce(into: Data()) { $0.append(parts[$1] ?? Data()) }
            parts = [:]
            guard let json = try? (packed as NSData).decompressed(using: .zlib) as Data,
                  let rows = try? JSONDecoder().decode([[String]].self, from: json) else { return nil }
            return rows.compactMap { $0.count == 3 ? Binding(trigger: $0[0], profile: $0[1], action: $0[2]) : nil }
        }
    }

    // MARK: - Byte helpers

    struct Writer {
        private(set) var data = Data()
        mutating func u8(_ v: UInt8) { data.append(v) }
        mutating func u16(_ v: UInt16) { withUnsafeBytes(of: v.bigEndian) { data.append(contentsOf: $0) } }
        mutating func u32(_ v: UInt32) { withUnsafeBytes(of: v.bigEndian) { data.append(contentsOf: $0) } }
        mutating func u64(_ v: UInt64) { withUnsafeBytes(of: v.bigEndian) { data.append(contentsOf: $0) } }
        mutating func bytes(_ v: Data) { data.append(v) }
        mutating func text(_ v: String, max: Int = 32) {
            let utf8 = Data(RelayWire.clip(v, max).utf8)
            u8(UInt8(utf8.count)); data.append(utf8)
        }
    }

    struct Reader {
        private let data: Data
        private var offset: Int
        init(_ data: Data) { self.data = Data(data); offset = 0 }
        var remaining: Int { data.count - offset }
        mutating func bytes(_ count: Int) throws -> Data {
            guard count >= 0, remaining >= count else { throw Failure.invalidPacket }
            defer { offset += count }
            return data.subdata(in: offset..<offset + count)
        }
        mutating func u8() throws -> UInt8 { try bytes(1)[0] }
        mutating func u16() throws -> UInt16 { try bytes(2).reduce(0) { $0 << 8 | UInt16($1) } }
        mutating func u32() throws -> UInt32 { try bytes(4).reduce(0) { $0 << 8 | UInt32($1) } }
        mutating func u64() throws -> UInt64 { try bytes(8).reduce(0) { $0 << 8 | UInt64($1) } }
        mutating func text() throws -> String {
            guard let value = String(data: try bytes(Int(try u8())), encoding: .utf8) else { throw Failure.invalidPacket }
            return value
        }
        func end() throws { guard remaining == 0 else { throw Failure.invalidPacket } }
    }

    /// Version and kind of any packet, without decrypting it.
    struct Header: Equatable {
        let kind: Kind
        /// Sealed packets only.
        let tag: Data?

        init(_ packet: Data) throws {
            let bytes = [UInt8](packet.prefix(6))
            guard bytes.count >= 2 else { throw Failure.invalidPacket }
            guard bytes[0] == version else { throw Failure.unsupportedVersion }
            guard let kind = Kind(rawValue: bytes[1]) else { throw Failure.invalidPacket }
            self.kind = kind
            if kind.sealed {
                guard bytes.count == 6 else { throw Failure.invalidPacket }
                tag = Data(bytes[2..<6])
            } else {
                tag = nil
            }
        }
    }

    /// Truncates to whole characters within `max` UTF-8 bytes, identically on both peers.
    static func clip(_ text: String, _ max: Int = 32) -> String {
        var utf8 = Data(text.utf8.prefix(max))
        while String(data: utf8, encoding: .utf8) == nil, !utf8.isEmpty { utf8.removeLast() }
        return String(decoding: utf8, as: UTF8.self)
    }

    static func random(_ count: Int) -> Data {
        var generator = SystemRandomNumberGenerator()
        return Data((0..<count).map { _ in UInt8.random(in: .min ... .max, using: &generator) })
    }

    /// RFC 4122 version 4 layout, so the derived value is an ordinary 128-bit UUID.
    static func uuid(_ bytes: Data) -> UUID {
        var b = [UInt8](bytes.prefix(16))
        b[6] = (b[6] & 0x0f) | 0x40
        b[8] = (b[8] & 0x3f) | 0x80
        return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
    }

    private static func label(_ text: String) -> Data { Data("runes-relay/v1/\(text)".utf8) }

    private static func hash(_ parts: Data...) -> Data {
        var hasher = SHA256()
        for part in parts { hasher.update(data: part) }
        return Data(hasher.finalize())
    }

    private static func mac(_ key: SymmetricKey, _ parts: Data...) -> Data {
        var code = HMAC<SHA256>(key: key)
        for part in parts { code.update(data: part) }
        return Data(code.finalize()).prefix(16)
    }

    private static func derive(_ input: SymmetricKey, salt: Data, info: Data, count: Int = 32) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: input, salt: salt, info: info, outputByteCount: count)
    }

    private static func bytes(_ key: SymmetricKey) -> Data { key.withUnsafeBytes { Data($0) } }

    /// Constant-time comparison for authentication tags.
    private static func same(_ a: Data, _ b: Data) -> Bool {
        guard a.count == b.count else { return false }
        return zip(a, b).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }

    // MARK: - GATT layout

    /// Characteristics are derived from their service, so a Mac hosting several pairings can tell them apart.
    enum Role: String { case control, inbound, bond }

    static func characteristic(_ role: Role, of service: UUID) -> UUID {
        uuid(hash(withUnsafeBytes(of: service.uuid) { Data($0) }, label("characteristic/\(role.rawValue)")))
    }

    // MARK: - Pairing

    /// The Mac's QR code: a short-lived public key and a one-time token. It never carries a long-lived secret.
    struct Invitation: Equatable {
        static let prefix = "RUNESMAC1:"
        let macKey: Data
        let token: Data
        let expires: Date
        let macName: String

        /// Advertised only while this code is valid, so the phone finds the Mac that showed it.
        var service: UUID { RelayWire.uuid(RelayWire.hash(RelayWire.label("pair-service"), token)) }

        var text: String {
            var w = Writer()
            w.u8(RelayWire.version); w.bytes(macKey); w.bytes(token)
            w.u32(UInt32(clamping: Int64(expires.timeIntervalSince1970.rounded(.down))))
            w.text(macName)
            return Self.prefix + w.data.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }

        init(macKey: Data, token: Data, expires: Date, macName: String) {
            self.macKey = macKey; self.token = token; self.macName = macName
            self.expires = Date(timeIntervalSince1970: expires.timeIntervalSince1970.rounded(.down))
        }

        static func parse(_ text: String, now: Date = Date()) throws -> Self {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.count <= 256, trimmed.hasPrefix(prefix) else { throw Failure.invalidInvitation }
            var body = String(trimmed.dropFirst(prefix.count))
                .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            while body.count % 4 != 0 { body += "=" }
            guard let data = Data(base64Encoded: body) else { throw Failure.invalidInvitation }
            var r = Reader(data)
            do {
                let format = try r.u8()
                guard format == RelayWire.version else { throw format > RelayWire.version ? Failure.unsupportedVersion : Failure.invalidInvitation }
                let key = try r.bytes(32), token = try r.bytes(16)
                let expires = Date(timeIntervalSince1970: TimeInterval(try r.u32()))
                let name = try r.text()
                try r.end()
                guard (try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: key)) != nil else { throw Failure.invalidInvitation }
                guard expires > now, expires.timeIntervalSince(now) <= invitationLifetime + 60 else { throw Failure.expiredInvitation }
                return Self(macKey: key, token: token, expires: expires, macName: name)
            } catch let failure as Failure where failure == .unsupportedVersion || failure == .expiredInvitation {
                throw failure
            } catch {
                throw Failure.invalidInvitation
            }
        }
    }

    /// What both sides keep after pairing. `secret` lives in the Keychain; `service` is advertised by the Mac.
    struct Pairing: Equatable, Sendable {
        let id: UUID
        let secret: Data
        var service: UUID { RelayWire.uuid(RelayWire.hash(RelayWire.label("link-service"), secret)) }
    }

    private struct PairingKeys {
        let confirm: SymmetricKey
        let pairing: Pairing
    }

    private static func pairingKeys(shared: SharedSecret, macKey: Data, phoneKey: Data, token: Data) -> PairingKeys {
        let input = SymmetricKey(data: shared.withUnsafeBytes { Data($0) })
        let transcript = macKey + phoneKey + token
        let confirm = derive(input, salt: token, info: label("pair-confirm") + transcript)
        let secret = bytes(derive(input, salt: token, info: label("link-secret") + transcript))
        let id = uuid(bytes(derive(input, salt: token, info: label("pairing-id") + transcript, count: 16)))
        return PairingKeys(confirm: confirm, pairing: Pairing(id: id, secret: secret))
    }

    /// The phone's side of pairing, created when the QR is scanned.
    struct PhonePairing {
        let invitation: Invitation
        private let key = Curve25519.KeyAgreement.PrivateKey()

        init(_ invitation: Invitation) { self.invitation = invitation }

        private func keys() throws -> PairingKeys {
            let mac = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: invitation.macKey)
            return pairingKeys(shared: try key.sharedSecretFromKeyAgreement(with: mac), macKey: invitation.macKey,
                               phoneKey: key.publicKey.rawRepresentation, token: invitation.token)
        }

        func request(phoneName: String) throws -> Data {
            var w = Writer()
            w.u8(version); w.u8(Kind.pairRequest.rawValue)
            w.bytes(key.publicKey.rawRepresentation)
            let name = clip(phoneName)
            w.bytes(RelayWire.mac(try keys().confirm, label("phone-confirm"), Data(name.utf8)))
            w.text(name)
            return w.data
        }

        /// Verifies that the Mac holds the private key from the QR code.
        func accept(_ packet: Data) throws -> (pairing: Pairing, macName: String) {
            var r = Reader(packet)
            guard try r.u8() == version else { throw Failure.unsupportedVersion }
            let kind = try r.u8()
            if kind == Kind.pairReject.rawValue { throw Failure.tokenUsed }
            guard kind == Kind.pairAccept.rawValue else { throw Failure.invalidPacket }
            let proof = try r.bytes(16), name = try r.text()
            try r.end()
            let keys = try keys()
            guard same(proof, RelayWire.mac(keys.confirm, label("mac-confirm"), Data(name.utf8))) else { throw Failure.authentication }
            return (keys.pairing, name)
        }
    }

    /// The Mac's side of pairing. One instance per QR code; it accepts exactly one phone.
    struct MacPairing {
        let invitation: Invitation
        private let key: Curve25519.KeyAgreement.PrivateKey
        private(set) var used = false

        init(macName: String, now: Date = Date()) {
            key = Curve25519.KeyAgreement.PrivateKey()
            invitation = Invitation(macKey: key.publicKey.rawRepresentation, token: RelayWire.random(16),
                                    expires: now.addingTimeInterval(invitationLifetime), macName: macName)
        }

        /// Returns the accept packet once. A second request, even a valid one, is refused.
        mutating func respond(to packet: Data, now: Date = Date()) throws -> (accept: Data, pairing: Pairing, phoneName: String) {
            guard !used else { throw Failure.tokenUsed }
            guard now < invitation.expires else { throw Failure.expiredInvitation }
            var r = Reader(packet)
            guard try r.u8() == version else { throw Failure.unsupportedVersion }
            guard try r.u8() == Kind.pairRequest.rawValue else { throw Failure.invalidPacket }
            let phoneKey = try r.bytes(32), proof = try r.bytes(16), name = try r.text()
            try r.end()
            let phone = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: phoneKey)
            let keys = pairingKeys(shared: try key.sharedSecretFromKeyAgreement(with: phone), macKey: invitation.macKey,
                                   phoneKey: phoneKey, token: invitation.token)
            guard same(proof, RelayWire.mac(keys.confirm, label("phone-confirm"), Data(name.utf8))) else { throw Failure.authentication }
            used = true
            var w = Writer()
            w.u8(version); w.u8(Kind.pairAccept.rawValue)
            let macName = clip(invitation.macName)
            w.bytes(RelayWire.mac(keys.confirm, label("mac-confirm"), Data(macName.utf8)))
            w.text(macName)
            return (w.data, keys.pairing, name)
        }

        static var reject: Data { Data([version, Kind.pairReject.rawValue]) }
    }

    // MARK: - Link handshake

    /// The phone starts every session. A fresh nonce per attempt means anything the Mac sent for an
    /// earlier session, including notifications iOS delivers after relaunching the app, is recognizably stale.
    static func phoneHello(_ pairing: Pairing, nonce: Data) -> Data {
        var w = Writer()
        w.u8(version); w.u8(Kind.phoneHello.rawValue); w.bytes(nonce)
        w.bytes(mac(authKey(pairing), label("phone-hello"), nonce))
        return w.data
    }

    static func readPhoneHello(_ packet: Data, _ pairing: Pairing) throws -> Data {
        var r = Reader(packet)
        guard try r.u8() == version else { throw Failure.unsupportedVersion }
        guard try r.u8() == Kind.phoneHello.rawValue else { throw Failure.invalidPacket }
        let nonce = try r.bytes(16), proof = try r.bytes(16)
        try r.end()
        guard same(proof, mac(authKey(pairing), label("phone-hello"), nonce)) else { throw Failure.authentication }
        return nonce
    }

    static func macHello(_ pairing: Pairing, phoneNonce: Data, macNonce: Data) -> Data {
        var w = Writer()
        w.u8(version); w.u8(Kind.macHello.rawValue); w.bytes(phoneNonce); w.bytes(macNonce)
        w.bytes(mac(authKey(pairing), label("mac-hello"), phoneNonce, macNonce))
        return w.data
    }

    /// Returns nil for a reply to a different hello, which the caller ignores.
    static func readMacHello(_ packet: Data, _ pairing: Pairing, phoneNonce: Data) throws -> Data? {
        var r = Reader(packet)
        guard try r.u8() == version else { throw Failure.unsupportedVersion }
        guard try r.u8() == Kind.macHello.rawValue else { throw Failure.invalidPacket }
        let echoed = try r.bytes(16), macNonce = try r.bytes(16), proof = try r.bytes(16)
        try r.end()
        guard echoed == phoneNonce else { return nil }
        guard same(proof, mac(authKey(pairing), label("mac-hello"), phoneNonce, macNonce)) else { throw Failure.authentication }
        return macNonce
    }

    /// Mac → phone: "I have no session with that tag; say hello again."
    static func reset(tag: Data) -> Data { Data([version, Kind.reset.rawValue]) + tag.prefix(4) }

    static func readReset(_ packet: Data) throws -> Data {
        var r = Reader(packet)
        guard try r.u8() == version, try r.u8() == Kind.reset.rawValue else { throw Failure.invalidPacket }
        let tag = try r.bytes(4)
        try r.end()
        return tag
    }

    private static func authKey(_ pairing: Pairing) -> SymmetricKey {
        derive(SymmetricKey(data: pairing.secret), salt: Data(), info: label("auth"))
    }

    // MARK: - Session

    /// Directional keys per session. Counters are authenticated and must strictly increase,
    /// which rejects replay and reordering.
    struct Session {
        let tag: Data
        private let sendKey: SymmetricKey
        private let receiveKey: SymmetricKey
        private let sendDirection: UInt8
        private var sent: UInt32 = 0
        private var received: UInt32?

        init(_ pairing: Pairing, phoneNonce: Data, macNonce: Data, isPhone: Bool) {
            let salt = phoneNonce + macNonce
            let secret = SymmetricKey(data: pairing.secret)
            let toMac = RelayWire.derive(secret, salt: salt, info: RelayWire.label("phone-to-mac"))
            let toPhone = RelayWire.derive(secret, salt: salt, info: RelayWire.label("mac-to-phone"))
            sendKey = isPhone ? toMac : toPhone
            receiveKey = isPhone ? toPhone : toMac
            sendDirection = isPhone ? 0 : 1
            tag = RelayWire.hash(RelayWire.label("session-tag"), salt).prefix(4)
        }

        private static func nonce(_ direction: UInt8, _ counter: UInt32) throws -> ChaChaPoly.Nonce {
            var w = Writer()
            w.u8(direction); w.u8(0); w.u8(0); w.u8(0); w.u32(0); w.u32(counter)
            return try ChaChaPoly.Nonce(data: w.data)
        }

        mutating func seal(_ message: Message, now: TimeInterval = ProcessInfo.processInfo.systemUptime) throws -> Data {
            guard sent < UInt32.max else { throw Failure.replay }
            let (kind, body) = try RelayWire.encode(message, now: now)
            sent += 1
            var header = Writer()
            header.u8(version); header.u8(kind.rawValue); header.bytes(tag); header.u32(sent)
            let box = try ChaChaPoly.seal(body, using: sendKey, nonce: try Self.nonce(sendDirection, sent), authenticating: header.data)
            let packet = header.data + box.ciphertext + box.tag
            guard packet.count <= maxPacket else { throw Failure.invalidPacket }
            return packet
        }

        /// Call only for packets whose header tag matches `tag`.
        mutating func open(_ packet: Data) throws -> Message {
            guard packet.count >= 10 + 16, packet.count <= maxPacket else { throw Failure.invalidPacket }
            let header = try Header(packet)
            guard header.kind.sealed, header.tag == tag else { throw Failure.invalidPacket }
            let bytes = Data(packet)
            let counter = bytes.subdata(in: 6..<10).reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
            if let received, counter <= received { throw Failure.replay }
            let direction: UInt8 = sendDirection == 0 ? 1 : 0
            let box = try ChaChaPoly.SealedBox(nonce: try Self.nonce(direction, counter),
                                               ciphertext: bytes.subdata(in: 10..<bytes.count - 16),
                                               tag: bytes.subdata(in: bytes.count - 16..<bytes.count))
            let body: Data
            do { body = try ChaChaPoly.open(box, using: receiveKey, authenticating: bytes.prefix(10)) }
            catch { throw Failure.authentication }
            received = counter
            return try RelayWire.decode(header.kind, body)
        }
    }

    // MARK: - Message bodies

    private static func ageMilliseconds(_ event: Event, now: TimeInterval) -> UInt16 {
        guard event.phoneUptime > 0 else { return 0 }
        return UInt16(clamping: Int(max(0, (now - event.phoneUptime) * 1000).rounded()))
    }

    private static func state(_ w: inout Writer, _ s: PhoneState) { w.u8(s.app.rawValue); w.u8(s.band.rawValue) }

    private static func state(_ r: inout Reader) throws -> PhoneState {
        PhoneState(app: PhoneState.App(rawValue: try r.u8()) ?? .unknown, band: PhoneState.Band(rawValue: try r.u8()) ?? .disconnected)
    }

    static func encode(_ message: Message, now: TimeInterval) throws -> (Kind, Data) {
        var w = Writer()
        switch message {
        case .demand(let demand):
            w.u8(demand.flags)
            return (.demand, w.data)
        case .ready(let demand):
            w.u8(demand.map { 0x80 | $0.flags } ?? 0)
            return (.ready, w.data)
        case .lease(let seconds, let s):
            w.u16(UInt16(clamping: Int(seconds * 1000))); state(&w, s)
            return (.lease, w.data)
        case .ping(let id):
            w.u16(id)
            return (.ping, w.data)
        case .pong(let id, let s):
            w.u16(id); state(&w, s)
            return (.pong, w.data)
        case .bye(let reason):
            w.u8(reason.rawValue)
            return (.bye, w.data)
        case .bindings(let chunk):
            guard chunk.data.count <= bindingsChunkSize else { throw Failure.invalidPacket }
            w.u16(chunk.generation); w.u8(chunk.index); w.u8(chunk.count); w.bytes(chunk.data)
            return (.bindings, w.data)
        case .event(let event):
            w.u32(UInt32(truncatingIfNeeded: event.sequence)); w.u64(event.timestamp); w.u16(ageMilliseconds(event, now: now))
            switch event.kind {
            case .gesture:
                guard let g = event.gesture, g.count == 4 else { throw Failure.invalidPacket }
                for value in g { w.u8(UInt8(clamping: value)) }
                return (.gesture, w.data)
            case .gyro:
                guard let v = event.values, v.count == 3, v.allSatisfy(\.isFinite) else { throw Failure.invalidPacket }
                for value in v { w.u16(UInt16(bitPattern: Int16(clamping: Int(value.rounded())))) }
                return (.gyro, w.data)
            case .orientation:
                guard let v = event.values, v.count == 4, v.allSatisfy(\.isFinite) else { throw Failure.invalidPacket }
                for value in v { w.u32(Float(value).bitPattern) }
                return (.orientation, w.data)
            }
        }
    }

    static func decode(_ kind: Kind, _ body: Data) throws -> Message {
        var r = Reader(body)
        let message: Message
        switch kind {
        case .demand:
            message = .demand(Demand(flags: try r.u8()))
        case .ready:
            let flags = try r.u8()
            message = .ready(flags & 0x80 == 0 ? nil : Demand(flags: flags & 0x7f))
        case .lease:
            message = .lease(seconds: TimeInterval(try r.u16()) / 1000, state: try state(&r))
        case .ping:
            message = .ping(try r.u16())
        case .pong:
            message = .pong(try r.u16(), try state(&r))
        case .bye:
            message = .bye(ByeReason(rawValue: try r.u8()) ?? .normal)
        case .bindings:
            let generation = try r.u16(), index = try r.u8(), count = try r.u8()
            message = .bindings(BindingsChunk(generation: generation, index: index, count: count, data: try r.bytes(r.remaining)))
        case .gesture, .gyro, .orientation:
            let sequence = UInt64(try r.u32()), timestamp = try r.u64()
            let age = TimeInterval(try r.u16()) / 1000
            let receivedAt = Date().addingTimeInterval(-age)
            switch kind {
            case .gesture:
                let g = try (0..<4).map { _ in UInt64(try r.u8()) }
                message = .event(Event(kind: .gesture, sequence: sequence, timestamp: timestamp, phoneUptime: 0,
                                       phoneTime: receivedAt, gesture: g, age: age))
            case .gyro:
                let v = try (0..<3).map { _ in Double(Int16(bitPattern: try r.u16())) }
                message = .event(Event(kind: .gyro, sequence: sequence, timestamp: timestamp, phoneUptime: 0,
                                       phoneTime: receivedAt, values: v, age: age))
            default:
                let v = try (0..<4).map { _ in Double(Float(bitPattern: try r.u32())) }
                guard v.allSatisfy(\.isFinite) else { throw Failure.invalidPacket }
                message = .event(Event(kind: .orientation, sequence: sequence, timestamp: timestamp, phoneUptime: 0,
                                       phoneTime: receivedAt, values: v, age: age))
            }
        default:
            throw Failure.invalidPacket
        }
        try r.end()
        return message
    }
}
