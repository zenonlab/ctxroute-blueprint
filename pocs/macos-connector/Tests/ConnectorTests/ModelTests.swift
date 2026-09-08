import XCTest
@testable import ThemeModel
import ConnectorTransport
import SceneRenderer

final class ModelTests: XCTestCase {
    func testDevelopmentGroupRequiresExplicitModeAndAdHocSignature() throws {
        let groups = [Mailbox.localGroup]
        XCTAssertEqual(try Mailbox.sharedGroup(team: "", entitlements: groups,
            development: true, adHoc: true), Mailbox.localGroup)
        XCTAssertThrowsError(try Mailbox.sharedGroup(team: "", entitlements: groups, adHoc: true))
        XCTAssertThrowsError(try Mailbox.sharedGroup(team: "", entitlements: groups, development: true))
        XCTAssertThrowsError(try Mailbox.sharedGroup(team: "AB123CD456", entitlements: groups,
            development: true, adHoc: true))
        for invalid in [[], groups + groups, ["group.org.wallpaperthemes.connectorpoc2"]] {
            XCTAssertThrowsError(try Mailbox.sharedGroup(team: "", entitlements: invalid,
                development: true, adHoc: true))
        }
    }
    func testAccessProbeDoesNotSendCommandsOrNotifyProviders() throws {
        let recorder = SignalRecorder()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let box = try Mailbox(directory: root, onSignal: { recorder.append($0) })
        try box.verifyAccess()
        XCTAssertTrue(recorder.values.isEmpty)
        XCTAssertNil(try box.command()); XCTAssertNil(try box.status())
    }
    func testBuildRejectsIncompleteOrMalformedSigningArguments() throws {
        let script = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("build.sh")
        for args in [["--sign"], ["--unknown"], ["--development", "--sign"], ["--sign", "not-a-fingerprint", "AB123CD456"],
                     ["--sign", String(repeating: "0", count: 40), "../other"]] {
            let process = Process(); let output = Pipe()
            process.executableURL = URL(fileURLWithPath: "/bin/bash")
            process.arguments = [script.path] + args
            process.standardOutput = output; process.standardError = output
            try process.run()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            XCTAssertEqual(process.terminationStatus, 2)
            XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("no build created"))
        }
    }
    func testSharedGroupMustMatchSignedTeamExactly() throws {
        let group = "AB123CD456.org.wallpaperthemes.connectorpoc2"
        XCTAssertEqual(try Mailbox.sharedGroup(team: "AB123CD456", entitlements: [group]), group)
        for team in ["", "adhoc", "../escape", "ab123cd456", "AB123CD456\n"] {
            XCTAssertThrowsError(try Mailbox.sharedGroup(team: team, entitlements: [group]))
        }
        for groups in [[], ["group.org.wallpaperthemes.connectorpoc2"],
                       ["ZZ123CD456.org.wallpaperthemes.connectorpoc2"], [group, group]] {
            XCTAssertThrowsError(try Mailbox.sharedGroup(team: "AB123CD456", entitlements: groups))
        }
    }
    func testTransportNotificationsAreInjectedAfterWritesOnly() throws {
        let recorder = SignalRecorder()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let box = try Mailbox(directory: root, onSignal: { recorder.append($0) })
        let session = Session(themeID: "test")
        try box.write(Command(theme: "test", instance: session.instance, generation: 0, action: .inspect))
        try box.write(CatalogStatus(themes: [ProviderStatus(session: session, surfaces: 0)]))
        _ = try box.command(); _ = try box.status()
        XCTAssertEqual(recorder.values, [Mailbox.commandSignal, Mailbox.statusSignal])
        // Default test mailbox must never invoke this notifier or a system notifier.
        let isolated = try Mailbox(directory: root.appendingPathComponent("isolated"))
        try isolated.write(CatalogStatus(themes: []))
        XCTAssertEqual(recorder.values.count, 2)
    }
    func testReceiptSurvivesLifecyclePublicationAndExpires() throws {
        let now = Date(timeIntervalSince1970: 1000)
        var session = Session(themeID: "test")
        let command = Command(theme: "test", instance: session.instance, generation: 0, action: .pause, now: now)
        let receipt = session.apply(command, now: now)
        for count in [2, 1, 0, 2] {
            XCTAssertEqual(ProviderStatus(session: session, surfaces: count, now: now.addingTimeInterval(10)).receipt, receipt)
        }
        XCTAssertNil(ProviderStatus(session: session, surfaces: 2, now: now.addingTimeInterval(31)).receipt)
        XCTAssertNil(ProviderStatus(session: Session(themeID: "test"), surfaces: 2, now: now).receipt)
        XCTAssertEqual(session.generation, 1)
    }
    func testControlPresentationIsNotCapabilityAuthorization() throws {
        let theme = try Theme.load()
        XCTAssertEqual(theme.system_controls.items, ["audio", "desktop"])
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(theme)) as? [String: Any])
        for items in [["desktop", "audio"], ["settings"]] {
            json["system_controls"] = ["placement": "top_left", "items": items]
            XCTAssertNoThrow(try Theme.decode(JSONSerialization.data(withJSONObject: json)))
        }
        for items in [["shell"], ["audio", "audio"], []] {
            json["system_controls"] = ["placement": "top_left", "items": items]
            XCTAssertThrowsError(try Theme.decode(JSONSerialization.data(withJSONObject: json)))
        }
    }
    func testConcurrentPrototypePolicy() {
        let app = "/Applications/Wallpaper Connector PoC 2.app"
        let provider = app + "/Contents/Extensions/WallpaperProvider.appex/Contents/MacOS/WallpaperProvider"
        let old = "/Applications/Old.app/Contents/MacOS/SurfaceProbe"
        XCTAssertEqual(LaunchPolicy.conflicts(paths: [old, provider], installing: false, appPath: app), [old])
        XCTAssertEqual(LaunchPolicy.conflicts(paths: [old, provider], installing: true, appPath: app), [old, provider])
        XCTAssertTrue(LaunchPolicy.conflicts(paths: ["/System/Library/CoreServices/WallpaperAgent.app/Contents/MacOS/WallpaperAgent"], installing: true, appPath: app).isEmpty)
        XCTAssertEqual(LaunchPolicy.conflicts(paths: [provider], installing: false, appPath: "/Other.app"), [provider])
    }
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
        try box.write(CatalogStatus(themes: [ProviderStatus(session: session, surfaces: 2, receipt: receipt)]))
        XCTAssertEqual(try box.status()?.theme("test")?.receipt, receipt)
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
    @MainActor func testCatalogAndIndependentThemeStates() throws {
        let themes = try Theme.catalog()
        XCTAssertEqual(themes.count, 3)
        XCTAssertEqual(Set(themes.map(\.theme_id)).count, 3)
        var first = Session(themeID: themes[0].theme_id)
        let second = Session(themeID: themes[1].theme_id)
        _ = first.apply(Command(theme: first.themeID, instance: first.instance, generation: 0, action: .pause))
        XCTAssertTrue(first.state.paused); XCTAssertFalse(second.state.paused)
        let status = CatalogStatus(themes: [ProviderStatus(session: first, surfaces: 1), ProviderStatus(session: second, surfaces: 1)])
        XCTAssertFalse(try XCTUnwrap(status.theme(second.themeID)).state.paused)
        XCTAssertNil(status.theme("unknown"))
        for theme in themes {
            let scene = Scene(theme: theme); scene.resize(CGSize(width: 800, height: 500))
            XCTAssertEqual(scene.objectIDs, theme.objects.map(\.id))
            if theme.motion_path == "still" {
                XCTAssertTrue(scene.root.sublayers?.last?.sublayers?.allSatisfy { $0.animationKeys() == nil } == true)
            }
        }
    }
}

private final class SignalRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []
    var values: [String] { lock.withLock { recorded } }
    func append(_ value: String) { lock.withLock { recorded.append(value) } }
}
