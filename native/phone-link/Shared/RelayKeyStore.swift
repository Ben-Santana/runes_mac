import Foundation
import Security

/// Long-term relay pairings, one Keychain item each. The phone keeps one per Mac; the Mac keeps one per phone.
/// Canonical copy: RunesIOS/RunesIOS/Relay/RelayKeyStore.swift (vendored by the Mac app).
enum RelayKeyStore {
    struct Record: Codable, Equatable, Sendable {
        let id: UUID
        /// The other device's name, for display only.
        var name: String
        let secret: Data
        let created: Date

        var pairing: RelayWire.Pairing { RelayWire.Pairing(id: id, secret: secret) }
    }

    static let service = "com.runes.relay.v1"
    /// The single shared key used by the BLE prototype. Deleted on first launch of this version.
    private static let prototype: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.runes.ble-prototype.v1",
        kSecAttrAccount as String: "relay-key"
    ]

    private static func query(_ id: UUID? = nil) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        if let id { query[kSecAttrAccount as String] = id.uuidString }
        return query
    }

    static func all() throws -> [Record] {
        SecItemDelete(prototype as CFDictionary)
        // The macOS file keychain cannot return data for a match-all query, so list accounts first.
        var lookup = query()
        lookup[kSecReturnAttributes as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitAll
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let items = result as? [[String: Any]] else { throw StoreError.status(status) }
        return try items.compactMap { item -> Record? in
            guard let account = item[kSecAttrAccount as String] as? String, let id = UUID(uuidString: account) else { return nil }
            return try load(id)
        }.sorted { $0.created < $1.created }
    }

    static func load(_ id: UUID) throws -> Record? {
        var lookup = query(id)
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw StoreError.status(status) }
        guard let record = try? JSONDecoder().decode(Record.self, from: data), record.id == id, record.secret.count == 32 else { return nil }
        return record
    }

    static func save(_ record: Record) throws {
        let data = try JSONEncoder().encode(record)
        var status = SecItemUpdate(query(record.id) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = query(record.id)
            add[kSecValueData as String] = data
            #if os(iOS)
            // A locked phone must still reach its Mac after the first unlock since boot.
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            #endif
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw StoreError.status(status) }
    }

    static func delete(_ id: UUID) throws {
        let status = SecItemDelete(query(id) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw StoreError.status(status) }
    }

    enum StoreError: LocalizedError {
        case status(OSStatus)
        var errorDescription: String? {
            switch self { case .status(let status): return "Could not access the Keychain (\(status))." }
        }
    }
}
