import Foundation

/// Mac link logic against a simulated phone. No Bluetooth or Keychain. Run with `npm run test:phone-link`.
@main
struct PhoneLinkCoreTests {
    static let peer = UUID()

    struct FakePhone {
        let pairing: RelayWire.Pairing
        var nonce = Data()
        var session: RelayWire.Session?

        mutating func hello() -> Data {
            nonce = RelayWire.random(16)
            session = nil
            return RelayWire.phoneHello(pairing, nonce: nonce)
        }

        mutating func receive(_ packet: Data) throws -> RelayWire.Message? {
            let header = try RelayWire.Header(packet)
            if header.kind == .macHello {
                guard let macNonce = try RelayWire.readMacHello(packet, pairing, phoneNonce: nonce) else { return nil }
                session = RelayWire.Session(pairing, phoneNonce: nonce, macNonce: macNonce, isPhone: true)
                return nil
            }
            guard header.kind.sealed, var s = session, header.tag == s.tag else { return nil }
            let message = try s.open(packet)
            session = s
            return message
        }

        mutating func seal(_ message: RelayWire.Message, now: TimeInterval = 100) throws -> Data {
            var s = session!
            defer { session = s }
            return try s.seal(message, now: now)
        }
    }

    static func sent(_ outputs: [PhoneLinkCore.Output]) -> [Data] {
        outputs.compactMap { if case .send(_, _, let packet) = $0 { return packet } else { return nil } }
    }
    static func events(_ outputs: [PhoneLinkCore.Output]) -> [RelayWire.Event] {
        outputs.compactMap { if case .event(let event, _) = $0 { return event } else { return nil } }
    }
    static func releases(_ outputs: [PhoneLinkCore.Output]) -> Int {
        outputs.filter { if case .release = $0 { return true } else { return false } }.count
    }
    static func states(_ outputs: [PhoneLinkCore.Output]) -> [PhoneLinkCore.LinkState] {
        outputs.compactMap { if case .state(let state, _) = $0 { return state } else { return nil } }
    }

    static func gesture(_ action: UInt64, derived: UInt64, sequence: UInt64 = 1, age: TimeInterval = 0.01) -> RelayWire.Event {
        RelayWire.Event(kind: .gesture, sequence: sequence, timestamp: 1, phoneUptime: 100 - age, phoneTime: Date(), gesture: [2, action, derived, 0])
    }

    static func check(_ condition: @autoclosure () throws -> Bool, _ message: @autoclosure () -> String = "", line: Int = #line) rethrows {
        let passed = try condition()
        precondition(passed, "\(message()) at line \(line)")
    }

    static func main() throws {
        // First run: unpaired, with a pairing code.
        let core = PhoneLinkCore(records: [], now: 0)
        precondition(core.state(now: 0).0 == .unpaired)
        let invitation = core.startPairing(macName: "Studio")
        let phonePairing = RelayWire.PhonePairing(try RelayWire.Invitation.parse(invitation.text))
        let request = try phonePairing.request(phoneName: "Ben’s iPhone")
        var outputs = core.receive(request, from: peer, service: invitation.service, now: 1)
        guard case .paired(let record, let accept, _, let pairService)? = outputs.first else { preconditionFailure("Expected pairing") }
        precondition(pairService == invitation.service && record.name == "Ben’s iPhone")
        let (pairing, macName) = try phonePairing.accept(accept)
        precondition(macName == "Studio" && pairing == record.pairing)
        // The code is one-time.
        precondition(sent(core.receive(request, from: peer, service: invitation.service, now: 1)) == [RelayWire.MacPairing.reject])
        core.stopPairing()
        precondition(states(core.commit(record, now: 1)) == [.searching])

        // The phone connects and says hello; the Mac answers and asks for gestures.
        var phone = FakePhone(pairing: pairing)
        outputs = core.receive(phone.hello(), from: peer, service: pairing.service, now: 2)
        precondition(states(outputs) == [.connected])
        precondition(outputs.contains { if case .remember(_, let memory) = $0 { return memory.everConnected } else { return false } })
        var replies = sent(outputs)
        try check(try phone.receive(replies[0]) == nil && phone.session != nil)
        try check(try phone.receive(replies[1]) == .demand(.gestures))

        // Events count only after the phone confirms the streams.
        try check(events(core.receive(try phone.seal(.event(gesture(3, derived: 1))), from: peer, service: pairing.service, now: 3)).isEmpty)
        _ = core.receive(try phone.seal(.ready(.gestures)), from: peer, service: pairing.service, now: 3)
        let tap = events(core.receive(try phone.seal(.event(gesture(3, derived: 1))), from: peer, service: pairing.service, now: 3))
        precondition(tap.count == 1 && tap[0].gesture == [2, 3, 1, 0])

        // Stale events are rejected; releases always pass.
        try check(events(core.receive(try phone.seal(.event(gesture(3, derived: 1, age: 1.5))), from: peer, service: pairing.service, now: 3)).isEmpty)
        try check(events(core.receive(try phone.seal(.event(gesture(2, derived: 10, age: 9))), from: peer, service: pairing.service, now: 3)).count == 1)
        // Motion arrives only when requested.
        let gyro = RelayWire.Event(kind: .gyro, sequence: 2, timestamp: 1, phoneUptime: 100, phoneTime: Date(), values: [1, 2, 3])
        try check(events(core.receive(try phone.seal(.event(gyro)), from: peer, service: pairing.service, now: 3)).isEmpty)
        replies = sent(core.setDemand(.motion, now: 3))
        try check(try phone.receive(replies[0]) == .demand(.motion))
        try check(events(core.receive(try phone.seal(.event(gyro)), from: peer, service: pairing.service, now: 3)).isEmpty, "Not ready yet")
        _ = core.receive(try phone.seal(.ready(.motion)), from: peer, service: pairing.service, now: 3)
        try check(events(core.receive(try phone.seal(.event(gyro)), from: peer, service: pairing.service, now: 3)).count == 1)
        let oldGyro = RelayWire.Event(kind: .gyro, sequence: 3, timestamp: 1, phoneUptime: 99.5, phoneTime: Date(), values: [1, 2, 3])
        try check(events(core.receive(try phone.seal(.event(oldGyro)), from: peer, service: pairing.service, now: 3)).isEmpty)

        // A replayed packet is rejected and resets the session, releasing everything.
        let replayed = try phone.seal(.lease(seconds: 25, state: .unknown))
        _ = core.receive(replayed, from: peer, service: pairing.service, now: 4)
        outputs = core.receive(replayed, from: peer, service: pairing.service, now: 4)
        precondition(releases(outputs) == 1 && states(outputs) == [.searching], "Within the start-up grace period the Mac shows it is reconnecting")

        // Background relaunch: the phone says hello again. Old-session packets get a reset, never a crash.
        let stale = try phone.seal(.ready(.motion))
        outputs = core.receive(phone.hello(), from: peer, service: pairing.service, now: 5)
        for packet in sent(outputs) { _ = try phone.receive(packet) }
        precondition(core.state(now: 5).0 == .connected)
        let reset = sent(core.receive(stale, from: peer, service: pairing.service, now: 6))
        try check(reset.count == 1 && (try RelayWire.Header(reset[0])).kind == .reset)
        precondition(core.state(now: 6).0 == .connected, "A stale packet does not end the new session")
        _ = core.receive(try phone.seal(.ready(.motion)), from: peer, service: pairing.service, now: 6)

        // Holding: the Mac pings every second and releases if the phone stops answering.
        outputs = core.setHolding(true, now: 6)
        try check(try phone.receive(sent(outputs)[0]) == .ping(1))
        precondition(releases(core.tick(now: 7)) == 0)
        _ = core.receive(try phone.seal(.pong(1, .unknown)), from: peer, service: pairing.service, now: 7.1)
        precondition(releases(core.tick(now: 9)) == 0)
        precondition(releases(core.tick(now: 9.7)) == 1, "Silence during a hold releases it")
        precondition(releases(core.tick(now: 10)) == 0, "Released once")
        precondition(core.state(now: 10).0 == .connected, "The link itself stays up")
        _ = core.setHolding(false, now: 10)

        // Lease: a link that goes quiet is dropped and everything is released.
        _ = core.receive(try phone.seal(.lease(seconds: 25, state: .unknown)), from: peer, service: pairing.service, now: 30)
        precondition(releases(core.tick(now: 54)) == 0)
        outputs = core.tick(now: 56)
        precondition(releases(outputs) == 1 && states(outputs) == [.away])

        // Reconnect, then sleep: the phone is told, everything is released, and the state says so.
        for packet in sent(core.receive(phone.hello(), from: peer, service: pairing.service, now: 60)) { _ = try phone.receive(packet) }
        outputs = core.sleep(now: 61)
        try check(try phone.receive(sent(outputs)[0]) == .bye(.sleeping))
        precondition(releases(outputs) == 1 && states(outputs) == [.sleeping])
        precondition(states(core.wake(now: 70)) == [.searching])
        precondition(states(core.tick(now: 91)) == [.away])

        // Disconnect releases. A phone whose app closed shows "open Neural on iPhone once".
        for packet in sent(core.receive(phone.hello(), from: peer, service: pairing.service, now: 92)) { _ = try phone.receive(packet) }
        precondition(releases(core.unsubscribed(peer, service: pairing.service, now: 93)) == 1)
        for packet in sent(core.receive(phone.hello(), from: peer, service: pairing.service, now: 94)) { _ = try phone.receive(packet) }
        outputs = core.receive(try phone.seal(.bye(.terminating)), from: peer, service: pairing.service, now: 95)
        precondition(releases(outputs) == 1 && states(outputs) == [.openApp])

        // The phone removes this Mac: the pairing goes away and the code shows again.
        for packet in sent(core.receive(phone.hello(), from: peer, service: pairing.service, now: 96)) { _ = try phone.receive(packet) }
        outputs = core.receive(try phone.seal(.bye(.removed)), from: peer, service: pairing.service, now: 97)
        precondition(outputs.contains(.removed(record.id)) && states(outputs) == [.unpaired] && !core.isPaired)

        // A stranger with a guessed service ID gets nowhere.
        let other = PhoneLinkCore(records: [record], now: 0)
        var stranger = FakePhone(pairing: RelayWire.Pairing(id: record.id, secret: RelayWire.random(32)))
        precondition(sent(other.receive(stranger.hello(), from: peer, service: record.pairing.service, now: 1)).isEmpty)
        precondition(other.state(now: 1).0 == .searching && other.state(now: 21).0 == .openApp)

        // The Mac can remove a phone too.
        let mine = PhoneLinkCore(records: [record], memory: [record.id: .init(everConnected: true)], now: 0)
        precondition(mine.state(now: 30).0 == .away)
        outputs = mine.forget(nil, now: 31)
        precondition(outputs.contains(.removed(record.id)) && states(outputs) == [.unpaired])
        print("Phone link checks passed: pairing, one-time code, demand/ready, stale and motion filtering, replay, relaunch, hold watchdog, lease, sleep, removal.")
    }
}
