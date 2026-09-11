import CryptoKit
import XCTest
@testable import ThemeModel

final class ThemeInterfaceTests: XCTestCase {
    func testPrivateInterfaceResolvesOnlyDigestPinnedContainedPNGs() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("theme-interface-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
        let digest = SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()
        try png.write(to: root.appendingPathComponent("fixture.png"))
        let asset = ThemeInterfaceManifest.Asset(id: "fixture.icon", path: "fixture.png", sha256: digest)
        let slots = Dictionary(uniqueKeysWithValues: ThemeInterfaceLoader.requiredSlots.map { ($0, asset.id) })
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/1", assets: [asset],
            slots: slots, choices: [
                .init(id: "driver.fixture", label: "Pilote libre", kind: .character, preview: asset.id),
                .init(id: "kart.fixture", label: "Kart libre", kind: .vehicle, preview: asset.id,
                      appearance: .init(part: "body", material: "mat_body", tint: [1, 0.5, 0.25, 1]))
            ])
        let manifestURL = root.appendingPathComponent("interface.json")
        try JSONEncoder().encode(manifest).write(to: manifestURL)

        let resolved = try ThemeInterfaceLoader.load(manifestURL)
        XCTAssertEqual(resolved.asset(for: "slider.thumb"), root.appendingPathComponent("fixture.png"))
        XCTAssertEqual(resolved.manifest.choices.count, 2)
        XCTAssertEqual(resolved.manifest.choices[1].appearance?.material, "mat_body")

        try Data(png + [2]).write(to: root.appendingPathComponent("fixture.png"))
        XCTAssertThrowsError(try ThemeInterfaceLoader.load(manifestURL))
    }

    func testInterfaceRejectsMissingSemanticSlotAndTraversal() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("theme-interface-invalid-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/1", assets: [
            .init(id: "bad", path: "../bad.png", sha256: String(repeating: "0", count: 64))
        ], slots: [:], choices: [])
        let url = root.appendingPathComponent("interface.json")
        try JSONEncoder().encode(manifest).write(to: url)
        XCTAssertThrowsError(try ThemeInterfaceLoader.load(url))
    }

    func testVehicleOverridePreservesTargetAndValidatesThemeChoices() throws {
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/1", assets: [], slots: [:],
            choices: [
                .init(id: "driver.fixture", label: "Pilote", kind: .character, preview: "preview"),
                .init(id: "kart.fixture", label: "Kart", kind: .vehicle, preview: "preview")
            ], targets: [.init(id: "vehicle.one", label: "Véhicule", session_id: "session.alpha")])
        let value = ThemeInterfaceOverrides(themeID: "fixture.theme", targets: [
            "vehicle.one": .init(character: "driver.fixture", vehicle: "kart.fixture",
                                 sessionID: "session.beta")
        ])
        XCTAssertNoThrow(try value.validated(for: "fixture.theme", interface: manifest))
        XCTAssertEqual(value.targets["vehicle.one"]?.session_id, "session.beta")
        var invalid = value
        invalid.targets["vehicle.one"]?.vehicle = "kart.unknown"
        XCTAssertThrowsError(try invalid.validated(for: "fixture.theme", interface: manifest))
    }
}
