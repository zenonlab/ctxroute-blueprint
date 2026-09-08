import XCTest
import ThemeModel
import SceneRenderer
import QuartzCore

final class CustomizationTests: XCTestCase {
    func testDuplicateDesktopSurfacesRequireSemanticConsensus() throws {
        let theme = try Theme.load()
        let first = SurfaceLayout(id: UUID(), theme: theme.theme_id, display: 1, width: 800, height: 500,
            capturedAt: 100, elapsed: 0, running: true, interactive: true)
        let second = SurfaceLayout(id: UUID(), theme: theme.theme_id, display: 1, width: 800, height: 500,
            capturedAt: 100, elapsed: 0.005, running: true, interactive: true)
        let diverged = SurfaceLayout(id: UUID(), theme: theme.theme_id, display: 1, width: 800, height: 500,
            capturedAt: 100, elapsed: 3, running: true, interactive: true)
        let point = ThemeLayout.position(theme.objects[0], theme: theme, width: 800, height: 500, elapsed: 0)
        XCTAssertNotNil(SurfaceLayout.consensus([first, second], theme: theme, point: point, now: 100))
        XCTAssertNil(SurfaceLayout.consensus([first, diverged], theme: theme, point: point, now: 100))
        XCTAssertNil(SurfaceLayout.consensus([], theme: theme, point: point, now: 100))
        XCTAssertEqual(SurfaceLayout.consensus([first, second], theme: theme, point: point, now: 100)?.id,
                       SurfaceLayout.consensus([second, first], theme: theme, point: point, now: 100)?.id)
    }
    func testDraftValidationAndConfigurationCorrelation() throws {
        let original = try Theme.load()
        var draft = original
        draft.objects[0].label = "Travail"
        draft.objects[0].application_bundle_id = "com.apple.Terminal"
        draft.objects[0].size = 64
        XCTAssertNotEqual(draft, original)
        XCTAssertNil(original.objects[0].label)
        XCTAssertEqual(try Theme.decode(JSONEncoder().encode(draft)), draft)
        var session = Session(themeID: original.theme_id)
        let command = Command(theme: original.theme_id, instance: session.instance, generation: 0,
            action: .configure, configuration: draft)
        XCTAssertEqual(session.apply(command).status, .applied)
        XCTAssertEqual(session.apply(command).status, .applied)
        XCTAssertEqual(session.generation, 1)
        let wrong = Command(theme: original.theme_id, instance: session.instance, generation: 1,
            action: .pause, configuration: draft)
        XCTAssertEqual(session.apply(wrong).status, .rejected)
        draft.objects[0].x = 0.4
        XCTAssertThrowsError(try Theme.decode(JSONEncoder().encode(draft)))
        draft.objects[0].y = 0.6
        XCTAssertNoThrow(try Theme.decode(JSONEncoder().encode(draft)))
        draft.objects[0].label = "line\nbreak"
        XCTAssertThrowsError(try Theme.decode(JSONEncoder().encode(draft)))
    }
    func testShelfAndMovingHitGeometry() throws {
        let theme = try Theme.load()
        XCTAssertEqual(ThemeLayout.hit(ScenePoint(x: 30, y: 70), theme: theme, width: 800, height: 500, elapsed: 0), .control(.audio))
        XCTAssertEqual(ThemeLayout.hit(ScenePoint(x: 80, y: 70), theme: theme, width: 800, height: 500, elapsed: 0), .control(.desktopItems))
        XCTAssertEqual(ThemeLayout.hit(ScenePoint(x: 68, y: 70), theme: theme, width: 800, height: 500, elapsed: 0), .empty)
        for time in [0.0, 0.4, 6.1, 17.2, 24.0, 100.0] {
            let point = ThemeLayout.position(theme.objects[0], theme: theme, width: 800, height: 500, elapsed: time)
            XCTAssertEqual(ThemeLayout.hit(point, theme: theme, width: 800, height: 500, elapsed: time), .object(theme.objects[0].id))
        }
        XCTAssertEqual(ThemeLayout.hit(ScenePoint(x: -1, y: 0), theme: theme, width: 800, height: 500, elapsed: 0), .unknown)
    }
    func testObjectsKeepTheGenerousInvisibleTargetsProvenByPoC1() throws {
        let theme = try Theme.load(resource: "theme-amber")
        let center = ThemeLayout.position(theme.objects[0], theme: theme, width: 800, height: 500, elapsed: 0)
        XCTAssertEqual(ThemeLayout.minimumObjectHitWidth, 112)
        XCTAssertEqual(ThemeLayout.minimumObjectHitHeight, 70)
        XCTAssertEqual(ThemeLayout.hit(ScenePoint(x: center.x + 50, y: center.y + 30),
            theme: theme, width: 800, height: 500, elapsed: 0), .object(theme.objects[0].id))
        XCTAssertEqual(ThemeLayout.hit(ScenePoint(x: center.x + 57, y: center.y),
            theme: theme, width: 800, height: 500, elapsed: 0), .empty)
    }
    @MainActor func testLayoutClockPauseAndFixedObjects() throws {
        var theme = try Theme.load()
        theme.objects[0].x = 0.3; theme.objects[0].y = 0.7
        let a = ThemeLayout.position(theme.objects[0], theme: theme, width: 800, height: 500, elapsed: 0)
        let b = ThemeLayout.position(theme.objects[0], theme: theme, width: 800, height: 500, elapsed: 30)
        XCTAssertEqual(a, b)
        let scene = Scene(theme: theme); scene.resize(CGSize(width: 800, height: 500))
        var state = ThemeState(); state.paused = true; scene.apply(state)
        let layout = scene.layout(id: UUID(), display: 1, interactive: true)
        XCTAssertTrue(layout.valid); XCTAssertFalse(layout.running)
        XCTAssertEqual(layout.time(at: layout.captured_at + 100), layout.elapsed)
        state.paused = false; scene.apply(state)
        let resumed = scene.layout(id: layout.id, display: 1, interactive: true)
        XCTAssertEqual(resumed.time(at: resumed.captured_at + 10), resumed.elapsed + 10, accuracy: 0.0001)
        let replacement = Scene(theme: theme)
        replacement.resize(CGSize(width: 800, height: 500), initialElapsed: 12.5)
        XCTAssertEqual(replacement.layout(id: UUID(), display: 1, interactive: true).elapsed, 12.5, accuracy: 0.02)
        replacement.resize(CGSize(width: 1000, height: 700))
        XCTAssertEqual(replacement.layout(id: UUID(), display: 1, interactive: true).elapsed, 12.5, accuracy: 0.02)
    }
    @MainActor func testSquareIconControlsMatchHitRegionsAndMuteState() throws {
        let scene = Scene(theme: try Theme.load())
        scene.resize(CGSize(width: 800, height: 500), scale: 2)
        let controls = (scene.root.sublayers ?? []).filter { $0.name?.hasPrefix("control.") == true }
        XCTAssertEqual(controls.count, 2)
        for (index, control) in controls.enumerated() {
            let hit = ThemeLayout.control(index)
            XCTAssertEqual(control.frame, CGRect(x: hit.x, y: 500 - hit.y - hit.height, width: 40, height: 40))
            XCTAssertFalse(control is CATextLayer)
            XCTAssertEqual(control.sublayers?.count, 1)
            let icon = try XCTUnwrap(control.sublayers?.first as? CAShapeLayer)
            XCTAssertFalse(try XCTUnwrap(icon.path).isEmpty)
            XCTAssertEqual(icon.frame, CGRect(x: 8, y: 8, width: 24, height: 24))
            XCTAssertEqual(icon.contentsScale, 2)
        }
        XCTAssertEqual(controls[0].sublayers?.first?.name, "lucide.volume-x")
        var state = ThemeState(); state.muted = false; scene.apply(state)
        XCTAssertEqual(controls[0].sublayers?.first?.name, "lucide.volume-2")
        state.muted = true; scene.apply(state)
        XCTAssertEqual(controls[0].sublayers?.first?.name, "lucide.volume-x")
        XCTAssertEqual(controls[1].sublayers?.first?.name, "lucide.monitor")
        state.desktopItemsVisible = true; scene.apply(state)
        XCTAssertEqual(controls[1].sublayers?.first?.name, "lucide.eye")
        let visiblePath = try XCTUnwrap((controls[1].sublayers?.first as? CAShapeLayer)?.path)
        state.desktopItemsVisible = false; scene.apply(state)
        XCTAssertEqual(controls[1].sublayers?.first?.name, "lucide.eye-off")
        let hiddenPath = try XCTUnwrap((controls[1].sublayers?.first as? CAShapeLayer)?.path)
        XCTAssertEqual(visiblePath.boundingBox, CGRect(x: 2, y: 5, width: 20, height: 14))
        XCTAssertEqual(hiddenPath.boundingBox, CGRect(x: 2, y: 3, width: 20, height: 18))
        XCTAssertNotEqual(visiblePath, hiddenPath)
        state.desktopItemsVisible = nil; scene.apply(state)
        XCTAssertEqual(controls[1].sublayers?.first?.name, "lucide.monitor")
    }
    func testLocalStoreDoesNotModifyOriginalAndRejectsInvalidFile() throws {
        // Deliberately retain bounded fixtures; repository policy forbids automatic deletion.
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("connector-customization-" + UUID().uuidString)
        let store = ThemeStore(directory: directory)
        let original = try Theme.load()
        XCTAssertNil(try store.load(for: original))
        var draft = original; draft.objects[0].label = "Test"
        try store.save(draft)
        XCTAssertEqual(try store.load(for: original), draft)
        XCTAssertEqual(try Theme.load(), original)
        let url = directory.appendingPathComponent(original.theme_id + ".json")
        try Data(repeating: 0, count: 32_769).write(to: url)
        XCTAssertThrowsError(try store.load(for: original))
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    }
    func testMuteIsPerThemeAndNeverChangesOtherStates() throws {
        let theme = try Theme.load()
        var session = Session(themeID: theme.theme_id)
        let result = session.apply(Command(theme: theme.theme_id, instance: session.instance, generation: 0, action: .unmute))
        XCTAssertFalse(result.state.muted)
        XCTAssertFalse(result.state.paused)
        XCTAssertFalse(result.state.highlighted)
    }
}
