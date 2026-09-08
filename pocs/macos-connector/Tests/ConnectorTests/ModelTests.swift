import XCTest
@testable import ThemeModel
import ConnectorTransport
import SceneRenderer

final class ModelTests: XCTestCase {
    func testManifestAndInvalidInputs() throws {
        let theme = try Theme.load()
        XCTAssertEqual(theme.objects.count, 4)
        let data = try JSONEncoder().encode(theme)
        XCTAssertEqual(try Theme.decode(data), theme)
        let string = String(decoding: data, as: UTF8.self)
        XCTAssertThrowsError(try Theme.decode(Data(string.replacingOccurrences(of: "orb.b", with: "orb.a").utf8)))
        XCTAssertThrowsError(try Theme.decode(Data(string.replacingOccurrences(of: "101B30", with: "red").utf8)))
        XCTAssertThrowsError(try Theme.decode(Data(repeating: 32, count: 32_769)))
    }
    func testCommandsAreCorrelatedIdempotentAndBounded() {
        var session = Session(themeID: "test")
        let now = Date()
        let command = Command(theme: "test", instance: session.instance, generation: 0, action: .pause, now: now)
        let result = session.apply(command, now: now)
        XCTAssertEqual(result.status, .applied); XCTAssertTrue(session.state.paused)
        XCTAssertEqual(session.apply(command, now: now), result)
        XCTAssertEqual(session.generation, 1)
        let conflict = Command(theme: "test", instance: session.instance, generation: 1,
            action: .resume, id: command.command_id, now: now)
        XCTAssertEqual(session.apply(conflict, now: now).status, .rejected)
        XCTAssertTrue(session.state.paused)
        let stale = Command(theme: "test", instance: session.instance, generation: 0, action: .resume, now: now)
        XCTAssertEqual(session.apply(stale, now: now).status, .rejected)
        let expired = Command(theme: "test", instance: session.instance, generation: 1, action: .resume,
            now: now.addingTimeInterval(-10))
        XCTAssertEqual(session.apply(expired, now: now).status, .rejected)
        let foreign = Command(theme: "test", instance: UUID(), generation: 1, action: .resume, now: now)
        XCTAssertEqual(session.apply(foreign, now: now).status, .rejected)
        let resume = Command(theme: "test", instance: session.instance, generation: 1, action: .resume, now: now)
        XCTAssertEqual(session.apply(resume, now: now).status, .applied)
        XCTAssertFalse(session.state.paused)
    }
    func testMailboxRoundTripAndOversize() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        // Leave fixture artifacts in the OS temporary directory; never remove user files.
        let box = try Mailbox(directory: root)
        XCTAssertNil(try box.status())
        var session = Session(themeID: "test")
        let command = Command(theme: "test", instance: session.instance, generation: 0, action: .highlight)
        try box.write(command)
        XCTAssertEqual(try box.command(), command)
        let receipt = session.apply(command)
        try box.write(ProviderStatus(session: session, surfaces: 2, receipt: receipt))
        XCTAssertEqual(try box.status()?.receipt, receipt)
        try Data(repeating: 1, count: 20_000).write(to: root.appendingPathComponent("command.json"))
        XCTAssertThrowsError(try box.command())
    }
    @MainActor func testPersistentSceneAndPauseResume() throws {
        let scene = Scene(theme: try Theme.load())
        scene.resize(CGSize(width: 800, height: 500))
        let children = scene.root.sublayers?.count
        scene.resize(CGSize(width: 800, height: 500))
        XCTAssertEqual(scene.updates, 1)
        scene.resize(CGSize(width: 800, height: 500), scale: 1)
        XCTAssertEqual(scene.root.contentsScale, 1)
        XCTAssertEqual(scene.root.sublayers?.count, children)
        XCTAssertEqual(scene.objectIDs, ["orb.a", "orb.b", "orb.c", "orb.d"])
        var state = ThemeState(); state.paused = true
        scene.apply(state); scene.apply(state)
        XCTAssertTrue(scene.isPaused)
        state.paused = false
        scene.apply(state, suspended: true); XCTAssertTrue(scene.isPaused)
        scene.apply(state); XCTAssertFalse(scene.isPaused)
        scene.resize(CGSize(width: 1200, height: 800))
        XCTAssertEqual(scene.root.sublayers?.count, children)
    }
}
