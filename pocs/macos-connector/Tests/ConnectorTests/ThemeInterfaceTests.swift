import CryptoKit
import XCTest
@testable import ThemeModel

final class ThemeInterfaceTests: XCTestCase {
    private func pinning(targetID: String = "object.primary") -> ThemeInterfaceManifest.Pinning {
        .init(target_ids: [targetID], visibility_scope: "workspace-windows",
              same_instance_and_session: true, edit_mode: "transform-frame",
              controls: ["position", "size", "brightness", "opacity"],
              actions: ["accept", "cancel", "disable"],
              limits: .init(size: [0.25, 4], brightness: [0, 1], opacity: [0, 1]),
              persistent_per_object_settings: true, atomic_preview: true)
    }

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
        let subject = ThemeInterfaceManifest.Choice.Kind(rawValue: "subject")
        let carrier = ThemeInterfaceManifest.Choice.Kind(rawValue: "carrier")
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/5", assets: [asset],
            slots: slots, choices: [
                .init(id: "subject.fixture", label: "Sujet libre", kind: subject, preview: asset.id),
                .init(id: "carrier.fixture", label: "Support libre", kind: carrier, preview: asset.id,
                      appearance: .init(part: "body", material: "mat_body", tint: [1, 0.5, 0.25, 1]))
            ], targets: [.init(id: "object.primary", label: "Objet", session_id: "session.primary")],
            selection: .init(stages: [
                .init(id: "subject", label: "Choisir un sujet", kind: subject, columns: 2),
                .init(id: "carrier", label: "Choisir un support", kind: carrier, columns: 2)
            ]), pinning: pinning())
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
        let overrides = ThemeInterfaceOverrides(themeID: "fixture.theme")
        let state = try RenderHostControlState(generation: 7, audioVolume: 0.35,
            desktopItemsVisible: false, brightness: 0.8, visualPaused: true,
            overrides: overrides)
        XCTAssertEqual(state.schema_version, 2)
        XCTAssertEqual(state.audio_volume, 0.35)
        XCTAssertTrue(state.visual_paused)
        XCTAssertEqual(state.overrides?.schema_version, 2)
        XCTAssertThrowsError(try RenderHostControlState(generation: 8, audioVolume: 1.1,
            desktopItemsVisible: nil, brightness: 0.8, visualPaused: false))
    }

    func testInterfaceV5AcceptsDigestPinnedModelBinding() throws {
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
        let subject = ThemeInterfaceManifest.Choice.Kind(rawValue: "subject")
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/5", assets: [asset],
            models: [.init(id: "model.driver", path: "driver.glb", sha256: digest(glb),
                           clipIndices: [0, 1, 2], hideParts: ["default.driver"],
                           partOffsets: ["driver": [0, 1.25, 0]],
                           effectSockets: ["trail": [[-0.5, 0, 1], [0.5, 0, 1]]],
                           footprint: [1, 2, 3, 4, 5])], slots: slots,
            choices: [.init(id: "subject.fixture", label: "Sujet", kind: subject, preview: asset.id,
                            appearance: .init(part: "driver", model: "model.driver"))],
            targets: [.init(id: "object.primary", label: "Objet", session_id: "session.primary")],
            selection: .init(stages: [
                .init(id: "subject", label: "Choisir", kind: subject, columns: 2)
            ]), placements: [
                .init(selections: ["subject": "subject.fixture"], part: "driver", translation: [0, 1, 0])
            ], pinning: .init(target_ids: ["object.primary"], visibility_scope: "workspace-windows",
                             same_instance_and_session: true, edit_mode: "transform-frame",
                             controls: ["position", "size", "brightness", "opacity"],
                             actions: ["accept", "cancel", "disable"],
                             limits: .init(size: [0.25, 4], brightness: [0, 1], opacity: [0, 1]),
                             persistent_per_object_settings: true, atomic_preview: true))
        let url = root.appendingPathComponent("interface.json")
        try JSONEncoder().encode(manifest).write(to: url)

        let loaded = try ThemeInterfaceLoader.load(url).manifest
        XCTAssertEqual(loaded.models?.first?.clip_indices, [0, 1, 2])
        XCTAssertEqual(loaded.models?.first?.effect_sockets["trail"]?[0], [-0.5, 0, 1])
        XCTAssertEqual(loaded.placements.first?.translation, [0, 1, 0])
        XCTAssertEqual(loaded.pinning?.target_ids, ["object.primary"])
    }

    func testInterfaceV5RejectsMissingPinningContract() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("theme-interface-missing-pin-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
        try png.write(to: root.appendingPathComponent("preview.png"))
        let digest = SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()
        let asset = ThemeInterfaceManifest.Asset(id: "preview", path: "preview.png", sha256: digest)
        let slots = Dictionary(uniqueKeysWithValues: ThemeInterfaceLoader.requiredSlots.map { ($0, asset.id) })
        let subject = ThemeInterfaceManifest.Choice.Kind(rawValue: "subject")
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/5", assets: [asset],
            slots: slots,
            choices: [.init(id: "subject.fixture", label: "Sujet", kind: subject, preview: asset.id)],
            targets: [.init(id: "object.primary", label: "Objet", session_id: "session.primary")],
            selection: .init(stages: [
                .init(id: "subject", label: "Choisir", kind: subject, columns: 2)
            ]))
        let url = root.appendingPathComponent("interface.json")
        try JSONEncoder().encode(manifest).write(to: url)
        XCTAssertThrowsError(try ThemeInterfaceLoader.load(url)) { error in
            XCTAssertEqual(error.localizedDescription, "interface v5 requires pinning")
        }
    }

    func testInterfaceV5RejectsUnknownTopLevelFields() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("theme-interface-unknown-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let bytes = Data(#"{"format":"orbite.theme-interface/5","assets":[],"slots":{},"choices":[],"targets":[],"selection":null,"game_specific":true}"#.utf8)
        let url = root.appendingPathComponent("interface.json")
        try bytes.write(to: url)
        XCTAssertThrowsError(try ThemeInterfaceLoader.load(url))
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

    func testGenericOverridePreservesTargetAndValidatesThemeChoices() throws {
        let subject = ThemeInterfaceManifest.Choice.Kind(rawValue: "subject")
        let carrier = ThemeInterfaceManifest.Choice.Kind(rawValue: "carrier")
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/5", assets: [], slots: [:],
            choices: [
                .init(id: "subject.fixture", label: "Sujet", kind: subject, preview: "preview"),
                .init(id: "carrier.fixture", label: "Support", kind: carrier, preview: "preview")
            ], targets: [.init(id: "target.one", label: "Objet", session_id: "session.alpha")],
            selection: .init(stages: [
                .init(id: "subject", label: "Sujet", kind: subject, columns: 2),
                .init(id: "carrier", label: "Support", kind: carrier, columns: 2)
            ]))
        let value = ThemeInterfaceOverrides(themeID: "fixture.theme", targets: [
            "target.one": .init(selections: ["subject": "subject.fixture", "carrier": "carrier.fixture"],
                                sessionID: "session.beta")
        ])
        XCTAssertNoThrow(try value.validated(for: "fixture.theme", interface: manifest))
        XCTAssertEqual(value.targets["target.one"]?.session_id, "session.beta")
        var invalid = value
        invalid.targets["target.one"]?.selections["carrier"] = "carrier.unknown"
        XCTAssertThrowsError(try invalid.validated(for: "fixture.theme", interface: manifest))

        var normalized = ThemeInterfaceOverrides(themeID: "fixture.theme", targets: [
            "target.one": .init(selections: ["subject": "subject.fixture"])
        ])
        normalized.set(.init(), for: "target.one")
        XCTAssertTrue(normalized.targets.isEmpty)
    }

    func testSelectionPipelineFiltersNextStageByDeclaredAttribute() throws {
        let subject = ThemeInterfaceManifest.Choice.Kind(rawValue: "subject")
        let carrier = ThemeInterfaceManifest.Choice.Kind(rawValue: "carrier")
        let manifest = ThemeInterfaceManifest(format: "orbite.theme-interface/5", assets: [], slots: [:],
            choices: [
                .init(id: "subject.light", label: "Sujet léger", kind: subject, preview: "subject",
                      attributes: ["weight": "light"]),
                .init(id: "subject.heavy", label: "Sujet lourd", kind: subject, preview: "subject",
                      attributes: ["weight": "heavy"]),
                .init(id: "carrier.light", label: "Support léger", kind: carrier, preview: "carrier",
                      attributes: ["weight": "light"]),
                .init(id: "carrier.heavy", label: "Support lourd", kind: carrier, preview: "carrier",
                      attributes: ["weight": "heavy"])
            ], selection: .init(stages: [
                .init(id: "subject", label: "Choisir un sujet", kind: subject, columns: 6),
                .init(id: "carrier", label: "Choisir un support", kind: carrier, columns: 6)
            ], compatibility: [
                .init(sourceStage: "subject", targetStage: "carrier", attribute: "weight")
            ]))

        XCTAssertEqual(manifest.compatibleChoices(kind: carrier,
            selected: [subject: "subject.light"]).map(\.id), ["carrier.light"])
        XCTAssertTrue(manifest.compatibleChoices(kind: carrier, selected: [:]).isEmpty)
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
            ], targets: [.init(id: "object.primary", label: "Objet", session_id: "session.primary")],
            selection: .init(stages: [
                .init(id: "look", label: "Choisir une tenue", kind: outfit, columns: 4)
            ]), pinning: pinning())
        let url = root.appendingPathComponent("interface.json")
        try JSONEncoder().encode(manifest).write(to: url)

        XCTAssertEqual(try ThemeInterfaceLoader.load(url).manifest.effectiveStages.first?.kind, outfit)
    }

    func testLegacyOverridesAreRejectedInsteadOfSilentlyMigrated() throws {
        let bytes = Data(#"{"schema_version":1,"theme_id":"fixture.theme","targets":{"target.one":{"character":"driver.one","vehicle":"vehicle.one","session_id":"session.one"}}}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ThemeInterfaceOverrides.self, from: bytes))
    }
}
