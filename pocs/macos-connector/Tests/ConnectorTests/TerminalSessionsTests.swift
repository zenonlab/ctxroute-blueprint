import XCTest
@testable import ThemeModel

final class TerminalSessionsTests: XCTestCase {
    func testMonotoneEventsCoverRecoveryAndReconnectWithoutPTYData() {
        var simulator = TerminalSessionSimulator()
        let states: [TerminalSessionState] = [.idle, .active, .busy, .error, .recovering,
                                               .disconnected, .active, .success]
        for (index, state) in states.enumerated() {
            let snapshot = TerminalSessionSnapshot(id: "session.alpha", displayName: "Projet Alpha",
                state: state, sequence: UInt64(index + 1))
            XCTAssertTrue(simulator.receive(TerminalSessionEvent(snapshot: snapshot)))
        }
        XCTAssertEqual(simulator.sessions["session.alpha"]?.state, .success)
        XCTAssertEqual(simulator.sessions["session.alpha"]?.sequence, 8)
    }

    func testDuplicateAndStaleEventsNeverReplay() {
        var simulator = TerminalSessionSimulator()
        let current = TerminalSessionEvent(snapshot: .init(id: "session.alpha", displayName: "Alpha",
                                                            state: .active, sequence: 2))
        XCTAssertTrue(simulator.receive(current))
        XCTAssertFalse(simulator.receive(current))
        XCTAssertFalse(simulator.receive(.init(snapshot: .init(id: "session.alpha", displayName: "Alpha",
                                                                state: .error, sequence: 1))))
        XCTAssertEqual(simulator.sessions["session.alpha"]?.state, .active)
    }

    func testFocusAndOpenAreTypedIdempotentIntents() {
        var simulator = TerminalSessionSimulator()
        _ = simulator.receive(.init(snapshot: .init(id: "session.alpha", displayName: "Alpha",
                                                    state: .active, sequence: 1)))
        let focus = TerminalSessionIntent(sessionID: "session.alpha", kind: .focus)
        XCTAssertTrue(simulator.accept(focus))
        XCTAssertEqual(simulator.lastAcceptedIntent, focus)
        XCTAssertFalse(simulator.accept(focus))
        let open = TerminalSessionIntent(sessionID: "session.new", kind: .open)
        XCTAssertTrue(simulator.accept(open))
        XCTAssertEqual(simulator.lastAcceptedIntent, open)

        _ = simulator.receive(.init(snapshot: .init(id: "session.alpha", displayName: "Alpha",
                                                    state: .disconnected, sequence: 2)))
        XCTAssertFalse(simulator.accept(.init(sessionID: "session.alpha", kind: .focus)))
        XCTAssertEqual(simulator.lastAcceptedIntent, open)
    }

    func testAppearanceChangePreservesSessionIdentity() throws {
        var theme = Theme.fixture()
        theme.objects[0].session_id = "session.alpha"
        let changed = try theme.applying(.init(character: "driver.luigi", vehicle: "kart.standard"),
                                         to: "orb.a")
        XCTAssertEqual(changed.objects[0].session_id, "session.alpha")
        XCTAssertEqual(changed.objects[0].character, "driver.luigi")
        XCTAssertEqual(changed.objects[0].vehicle, "kart.standard")
    }
}
