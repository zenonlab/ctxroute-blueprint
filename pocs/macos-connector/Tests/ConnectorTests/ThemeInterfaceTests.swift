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
        var slots = Dictionary(uniqueKeysWithValues: ThemeInterfaceLoader.requiredSlots.map { ($0, asset.id) })
        slots["session.action.focus"] = asset.id
        slots["session.state.active"] = asset.id
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/2", assets: [asset],
            slots: slots, choices: [
                .init(id: "driver.fixture", label: "Pilote libre", kind: .character, preview: asset.id),
                .init(id: "kart.fixture", label: "Kart libre", kind: .vehicle, preview: asset.id,
                      appearance: .init(part: "body", material: "mat_body", tint: [1, 0.5, 0.25, 1]))
            ])
        let manifestURL = root.appendingPathComponent("interface.json")
        try JSONEncoder().encode(manifest).write(to: manifestURL)

        let resolved = try ThemeInterfaceLoader.load(manifestURL)
        XCTAssertEqual(resolved.asset(for: "slider.thumb"), root.appendingPathComponent("fixture.png"))
        XCTAssertEqual(resolved.asset(for: "session.action.focus"), root.appendingPathComponent("fixture.png"))
        XCTAssertEqual(resolved.asset(for: "session.state.active"), root.appendingPathComponent("fixture.png"))
        XCTAssertEqual(resolved.manifest.choices.count, 2)
        XCTAssertEqual(resolved.manifest.choices[1].appearance?.material, "mat_body")

        try Data(png + [2]).write(to: root.appendingPathComponent("fixture.png"))
        XCTAssertThrowsError(try ThemeInterfaceLoader.load(manifestURL))
    }

    func testControlV2CarriesOneThemeMixBrightnessAndPause() throws {
        let state = try RenderHostControlState(generation: 7, audioVolume: 0.35,
            desktopItemsVisible: false, brightness: 0.8, visualPaused: true)
        XCTAssertEqual(state.schema_version, 2)
        XCTAssertEqual(state.audio_volume, 0.35)
        XCTAssertTrue(state.visual_paused)
        XCTAssertThrowsError(try RenderHostControlState(generation: 8, audioVolume: 1.1,
            desktopItemsVisible: nil, brightness: 0.8, visualPaused: false))
    }

    func testInterfaceV4AcceptsDigestPinnedModelBinding() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("theme-interface-model-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
        let glb = Data([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])
        try png.write(to: root.appendingPathComponent("preview.png"))
        try glb.write(to: root.appendingPathComponent("driver.glb"))
        let digest: (Data) -> String = { bytes in
            SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        }
        let asset = ThemeInterfaceManifest.Asset(id: "preview", path: "preview.png", sha256: digest(png))
        let slots = Dictionary(uniqueKeysWithValues: ThemeInterfaceLoader.requiredSlots.map { ($0, asset.id) })
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/4", assets: [asset],
            models: [.init(id: "model.driver", path: "driver.glb", sha256: digest(glb),
                           clipIndices: [0, 1, 2])], slots: slots,
            choices: [.init(id: "driver.fixture", label: "Pilote", kind: .character, preview: asset.id,
                            appearance: .init(part: "driver", model: "model.driver"))],
            selection: .init(stages: [
                .init(id: "driver", label: "Choisir", kind: .character, columns: 2)
            ]))
        let url = root.appendingPathComponent("interface.json")
        try JSONEncoder().encode(manifest).write(to: url)

        XCTAssertEqual(try ThemeInterfaceLoader.load(url).manifest.models?.first?.clip_indices, [0, 1, 2])
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

        var normalized = ThemeInterfaceOverrides(themeID: "fixture.theme", targets: [
            "vehicle.one": .init(character: "driver.fixture")
        ])
        normalized.set(.init(), for: "vehicle.one")
        XCTAssertTrue(normalized.targets.isEmpty)
    }

    func testSelectionPipelineFiltersNextStageByDeclaredAttribute() throws {
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/3", assets: [], slots: [:],
            choices: [
                .init(id: "driver.light", label: "Pilote léger", kind: .character, preview: "driver",
                      attributes: ["weight": "light"]),
                .init(id: "driver.heavy", label: "Pilote lourd", kind: .character, preview: "driver",
                      attributes: ["weight": "heavy"]),
                .init(id: "vehicle.light", label: "Véhicule léger", kind: .vehicle, preview: "vehicle",
                      attributes: ["weight": "light"]),
                .init(id: "vehicle.heavy", label: "Véhicule lourd", kind: .vehicle, preview: "vehicle",
                      attributes: ["weight": "heavy"])
            ], selection: .init(stages: [
                .init(id: "driver", label: "Choisir un pilote", kind: .character, columns: 6),
                .init(id: "machine", label: "Choisir un véhicule", kind: .vehicle, columns: 6)
            ], compatibility: [
                .init(sourceStage: "driver", targetStage: "machine", attribute: "weight")
            ]))

        XCTAssertEqual(manifest.compatibleChoices(kind: .vehicle,
            selected: [.character: "driver.light"]).map(\.id), ["vehicle.light"])
        XCTAssertTrue(manifest.compatibleChoices(kind: .vehicle, selected: [:]).isEmpty)
    }

    func testInterfaceV5AcceptsArbitraryOrderedMenuKinds() throws {
        let outfit = ThemeInterfaceManifest.Choice.Kind(rawValue: "outfit")
        let companion = ThemeInterfaceManifest.Choice.Kind(rawValue: "companion")
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/5", assets: [], slots: [:],
            choices: [
                .init(id: "outfit.blue", label: "Bleu", kind: outfit, preview: "outfit",
                      attributes: ["family": "cool"]),
                .init(id: "companion.ice", label: "Glace", kind: companion, preview: "companion",
                      attributes: ["family": "cool"])
            ], selection: .init(stages: [
                .init(id: "look", label: "Choisir une tenue", kind: outfit, columns: 4),
                .init(id: "ally", label: "Choisir un compagnon", kind: companion, columns: 3)
            ], compatibility: [
                .init(sourceStage: "look", targetStage: "ally", attribute: "family")
            ]))

        XCTAssertEqual(manifest.effectiveStages.map(\.kind), [outfit, companion])
        XCTAssertEqual(manifest.compatibleChoices(kind: companion,
            selected: [outfit: "outfit.blue"]).map(\.id), ["companion.ice"])
    }

    func testInterfaceV5LoaderDoesNotKnowMenuKindNames() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("theme-interface-v5-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
        try png.write(to: root.appendingPathComponent("preview.png"))
        let digest = SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()
        let asset = ThemeInterfaceManifest.Asset(id: "preview", path: "preview.png", sha256: digest)
        let slots = Dictionary(uniqueKeysWithValues: ThemeInterfaceLoader.requiredSlots.map { ($0, asset.id) })
        let outfit = ThemeInterfaceManifest.Choice.Kind(rawValue: "outfit")
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/5", assets: [asset],
            slots: slots, choices: [
                .init(id: "outfit.blue", label: "Tenue bleue", kind: outfit, preview: asset.id)
            ], selection: .init(stages: [
                .init(id: "look", label: "Choisir une tenue", kind: outfit, columns: 4)
            ]))
        let url = root.appendingPathComponent("interface.json")
        try JSONEncoder().encode(manifest).write(to: url)

        XCTAssertEqual(try ThemeInterfaceLoader.load(url).manifest.effectiveStages.first?.kind, outfit)
    }

    func testLegacyOverridesMigrateToGenericSelections() throws {
        let bytes = Data(#"{"schema_version":1,"theme_id":"fixture.theme","targets":{"target.one":{"character":"driver.one","vehicle":"vehicle.one","session_id":"session.one"}}}"#.utf8)
        let decoded = try JSONDecoder().decode(ThemeInterfaceOverrides.self, from: bytes)
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/5", assets: [], slots: [:],
            choices: [
                .init(id: "driver.one", label: "Pilote", kind: .character, preview: "driver"),
                .init(id: "vehicle.one", label: "Véhicule", kind: .vehicle, preview: "vehicle")
            ], targets: [.init(id: "target.one", label: "Cible", session_id: nil)],
            selection: .init(stages: [
                .init(id: "driver", label: "Pilote", kind: .character, columns: 2),
                .init(id: "vehicle", label: "Véhicule", kind: .vehicle, columns: 2)
            ]))

        let migrated = try decoded.validated(for: "fixture.theme", interface: manifest)
        XCTAssertEqual(migrated.schema_version, 2)
        XCTAssertEqual(migrated.targets["target.one"]?.selections,
                       ["character": "driver.one", "vehicle": "vehicle.one"])
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(migrated)) as? [String: Any]
        let targets = encoded?["targets"] as? [String: [String: Any]]
        XCTAssertNotNil(targets?["target.one"]?["selections"])
        XCTAssertNil(targets?["target.one"]?["character"])
        XCTAssertNil(targets?["target.one"]?["vehicle"])
    }
}
