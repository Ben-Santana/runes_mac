#!/usr/bin/env swift
// Run with the Mac Bluetooth device identifier used by meta_neural_py.
import AppKit
import CoreImage
import CryptoKit
import Security

struct SavedIdentity: Decodable {
    let version: Int
    let private_key: Data
    let band_key: Data?
    let stage: String
    let allow_missing_band_key: Bool?
}
struct Transfer: Encodable {
    let type = "neural-band-identity"
    let version = 2
    let privateKey: Data
    let bandPoint: Data?
    let allowMissingBandKey: Bool
}
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1)
}
guard CommandLine.arguments.count == 2 else { fail("Expected the Mac band device ID.") }
var account = CommandLine.arguments[1]
let bindingURL = ProcessInfo.processInfo.environment["NEURAL_IDENTITY_MAP"].map { URL(fileURLWithPath: $0) }
    ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Neural/band-identities.json")
if FileManager.default.fileExists(atPath: bindingURL.path) {
    guard let data = try? Data(contentsOf: bindingURL),
          let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          record["version"] as? Int == 1, let aliases = record["aliases"] as? [String: String] else {
        fail("Cannot read saved identity bindings. Existing Keychain identities were not changed.")
    }
    account = aliases[account.uppercased()] ?? account
}
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "org.meta-neural-py.identity.v1",
    kSecAttrAccount as String: account,
    kSecReturnData as String: true,
    kSecMatchLimit as String: kSecMatchLimitOne
]
var result: CFTypeRef?
let status = SecItemCopyMatching(query as CFDictionary, &result)
guard status == errSecSuccess, let data = result as? Data else {
    fail("Could not read the saved Mac identity (Keychain status \(status)). Check the device ID and Keychain permission.")
}
guard data.count <= 8192,
      let identity = try? JSONDecoder().decode(SavedIdentity.self, from: data),
      identity.version == 1, identity.private_key.count == 32,
      (try? P256.Signing.PrivateKey(rawRepresentation: identity.private_key)) != nil else {
    fail("A verified Mac identity with a band public key is required. Saved identity is invalid.")
}
let compatibility = identity.stage == "host_verified" && identity.band_key == nil && identity.allow_missing_band_key == true
guard compatibility || (identity.stage == "verified" && identity.band_key != nil) else {
    fail("A verified Mac identity with a band public key is required. Incomplete identities cannot be exported.")
}
if let point = identity.band_key {
    guard point.count == 64,
          (try? P256.Signing.PublicKey(x963Representation: Data([4]) + point)) != nil else {
        fail("A verified Mac identity with a band public key is required. Band key is invalid.")
    }
}
let payload = try JSONEncoder().encode(Transfer(privateKey: identity.private_key, bandPoint: identity.band_key, allowMissingBandKey: compatibility))
guard let filter = CIFilter(name: "CIQRCodeGenerator") else { fail("QR generation unavailable.") }
filter.setValue(payload, forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel")
guard let output = filter.outputImage else { fail("Could not encode identity QR.") }
let qr = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
guard let cg = CIContext(options: [.useSoftwareRenderer: true]).createCGImage(qr, from: qr.extent) else { fail("Could not render identity QR.") }
let image = NSBitmapImageRep(cgImage: cg)
guard let png = image.representation(using: .png, properties: [:]) else { fail("Could not generate QR image.") }
FileHandle.standardOutput.write(Data(png.base64EncodedString().utf8))
