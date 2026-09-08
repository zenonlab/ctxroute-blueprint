import XCTest
import ThemeModel
import SceneRenderer

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
        XCTAssertEqual(ThemeLayout.hit(ScenePoint(x: 170, y: 70), theme: theme, width: 800, height: 500, elapsed: 0), .control(.desktopItems))
        for time in [0.0, 0.4, 6.1, 17.2, 24.0, 100.0] {
            let point = ThemeLayout.position(theme.objects[0], theme: theme, width: 800, height: 500, elapsed: time)
            XCTAssertEqual(ThemeLayout.hit(point, theme: theme, width: 800, height: 500, elapsed: time), .object(theme.objects[0].id))
        }
        XCTAssertEqual(ThemeLayout.hit(ScenePoint(x: -1, y: 0), theme: theme, width: 800, height: 500, elapsed: 0), .unknown)
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
