import XCTest
@testable import ProbeCore

final class ProbeCoreTests: XCTestCase {
    func testDefaultsAreFiniteAndPassiveAtRest() throws {
        let options = try ProbeOptions.parse([])
        XCTAssertEqual(options.mode, .window)
        XCTAssertEqual(options.duration, 60)
        XCTAssertFalse(options.smoke)
        XCTAssertFalse(options.splitInput)
        XCTAssertFalse(options.exportStill)
        XCTAssertFalse(ProbeState(interactive: true).shouldAnimate)
    }

    func testInvalidArgumentsFailClosed() {
        for arguments in [
            ["--duration", "nan"], ["--duration", "inf"], ["--duration", "0"],
            ["--duration", "601"], ["--duration"], ["--mode", "other"],
            ["--exec", "anything"], ["--mode", "window", "--mode", "desktop"],
            ["--smoke", "--smoke"], ["--snapshot"], ["--mode", "desktop", "--smoke", "--snapshot"],
            ["--smoke", "--duration", "3"], ["--split-input"], ["--export-still"],
            ["--mode", "desktop", "--split-input", "--split-input"]
        ] {
            XCTAssertThrowsError(try ProbeOptions.parse(arguments), "\(arguments)")
        }
    }

    func testExplicitModesAndBounds() throws {
        XCTAssertEqual(try ProbeOptions.parse(["--mode", "desktop", "--duration", "1"]).mode, .desktop)
        XCTAssertEqual(try ProbeOptions.parse(["--duration", "600"]).duration, 600)
        XCTAssertTrue(try ProbeOptions.parse(["--smoke", "--snapshot", "--duration", "4"]).snapshot)
        XCTAssertTrue(try ProbeOptions.parse(["--mode", "desktop", "--smoke"]).smoke)
        let split = try ProbeOptions.parse(["--mode", "desktop", "--split-input", "--export-still"])
        XCTAssertTrue(split.splitInput)
        XCTAssertTrue(split.exportStill)
    }

    func testPassiveStateRejectsEveryLocalAction() {
        var state = ProbeState(interactive: false)
        state.visibility = .visible
        state.openPanel()
        state.toggleAnimation()
        state.togglePause()
        state.toggleEffect()
        state.closePanel()
        XCTAssertEqual(state.actions, 0)
        XCTAssertFalse(state.advance(by: 0.03))
        XCTAssertFalse(state.shouldAnimate)
    }

    func testPauseAndResumePreservePhase() {
        var state = runningState()
        XCTAssertTrue(state.advance(by: 0.03))
        state.togglePause()
        let before = state.phaseSeconds
        XCTAssertFalse(state.advance(by: 20))
        XCTAssertEqual(state.phaseSeconds, before)
        XCTAssertEqual(state.ticks, 1)
        state.togglePause()
        XCTAssertTrue(state.advance(by: 0.03))
        XCTAssertEqual(state.phaseSeconds, before + 0.03, accuracy: 1e-10)
    }

    func testUnknownInvisibleAndReducedMotionSuspend() {
        var state = runningState()
        for visibility in [ProbeVisibility.unknown, .notVisible] {
            state.visibility = visibility
            XCTAssertFalse(state.shouldAnimate)
            XCTAssertFalse(state.advance(by: 0.03))
        }
        state.visibility = .visible
        state.reducedMotion = true
        XCTAssertFalse(state.shouldAnimate)
        state.reducedMotion = false
        XCTAssertTrue(state.shouldAnimate)
    }

    func testInvalidTimeAndCatchUpAreBounded() {
        var state = runningState()
        for delta in [Double.nan, .infinity, -.infinity, -1, 0] {
            XCTAssertFalse(state.advance(by: delta))
        }
        XCTAssertTrue(state.advance(by: 500))
        XCTAssertEqual(state.phaseSeconds, 0.1)
        for _ in 0..<1000 { state.advance(by: 0.1) }
        XCTAssertTrue((0..<4).contains(state.phaseSeconds))
    }

    func testPanelAndEffectDoNotRequireAnimation() {
        var state = ProbeState(interactive: true)
        state.openPanel()
        state.toggleEffect()
        XCTAssertTrue(state.panelOpen)
        XCTAssertTrue(state.effectEnabled)
        XCTAssertFalse(state.shouldAnimate)
        state.closePanel()
        XCTAssertFalse(state.panelOpen)
        XCTAssertEqual(state.actions, 3)
    }

    private func runningState() -> ProbeState {
        var state = ProbeState(interactive: true)
        state.visibility = .visible
        state.toggleAnimation()
        return state
    }

    func testAnimationDoesNotRequireSurfaceInput() {
        var state = ProbeState(interactive: false, animate: true)
        state.visibility = .visible
        XCTAssertTrue(state.advance(by: 0.03))
        state.openPanel()
        XCTAssertFalse(state.panelOpen)
        XCTAssertEqual(state.actions, 0)
        state.reducedMotion = true
        XCTAssertFalse(state.advance(by: 0.03))
    }

    func testDesktopSchedulingGatesAndProxyAreExplicit() {
        for ordered in [false, true] {
            for active in [false, true] {
                for awake in [false, true] {
                    for session in [false, true] {
                        for visible in [false, true] {
                            for finder in [false, true] {
                                let source = DesktopActivity.source(ordered: ordered, activeSpace: active,
                                    appKitVisible: visible, finderFrontmost: finder, awake: awake, sessionActive: session)
                                let expected = ordered && active && awake && session
                                    ? (visible ? "appkit-visible" : (finder ? "finder-frontmost-proxy" : "suspended"))
                                    : "suspended"
                                XCTAssertEqual(source, expected)
                            }
                        }
                    }
                }
            }
        }
    }

    func testSuspensionPreservesAnimationAndEffectState() {
        var state = ProbeState(interactive: true, animate: true)
        state.visibility = .visible
        state.toggleEffect()
        state.advance(by: 0.03)
        let phase = state.phaseSeconds
        state.visibility = .notVisible
        XCTAssertFalse(state.advance(by: 100))
        XCTAssertEqual(state.phaseSeconds, phase)
        state.visibility = .visible
        XCTAssertTrue(state.advance(by: 0.03))
        XCTAssertTrue(state.effectEnabled)
        XCTAssertTrue(state.animationRequested)
    }
}
