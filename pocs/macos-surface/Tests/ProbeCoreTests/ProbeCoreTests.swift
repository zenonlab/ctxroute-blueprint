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
        XCTAssertFalse(options.overlayOnly)
        XCTAssertFalse(ProbeState(interactive: true).shouldAnimate)
    }

    func testInvalidArgumentsFailClosed() {
        for arguments in [
            ["--duration", "nan"], ["--duration", "inf"], ["--duration", "0"],
            ["--duration", "601"], ["--duration"], ["--mode", "other"],
            ["--exec", "anything"], ["--mode", "window", "--mode", "desktop"],
            ["--smoke", "--smoke"], ["--snapshot"], ["--mode", "desktop", "--smoke", "--snapshot"],
            ["--smoke", "--duration", "3"], ["--split-input"], ["--export-still"],
            ["--mode", "desktop", "--split-input", "--split-input"],
            ["--overlay-only"], ["--mode", "desktop", "--overlay-only"],
            ["--mode", "desktop", "--split-input", "--overlay-only", "--export-still"]
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
        XCTAssertTrue(try ProbeOptions.parse(["--mode", "desktop", "--split-input", "--overlay-only"]).overlayOnly)
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
        XCTAssertTrue((0..<3_600).contains(state.phaseSeconds))
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

    func testFormationSnapshotIsDeterministicAndKeepsIdentityOrder() throws {
        let theme = try decodedFormationTheme()
        let engine = FormationEngine(theme: theme)
        let first = engine.snapshot(phaseSeconds: 1.25)
        XCTAssertEqual(first, engine.snapshot(phaseSeconds: 1.25))
        XCTAssertEqual(first.objects.map(\.id), theme.objects.map(\.id))
        XCTAssertTrue(first.objects.allSatisfy {
            $0.centerX.isFinite && $0.centerY.isFinite && $0.headingRadians.isFinite
        })
    }

    func testFormationObjectsRemainSeparatedAroundCurve() throws {
        let engine = FormationEngine(theme: try decodedFormationTheme())
        for phase in stride(from: 0.0, through: 4.0, by: 0.1) {
            let objects = engine.snapshot(phaseSeconds: phase).objects
            for left in objects.indices {
                for right in objects.indices where right > left {
                    XCTAssertGreaterThan(hypot(objects[left].centerX - objects[right].centerX,
                                               objects[left].centerY - objects[right].centerY), 0.025)
                }
            }
        }
    }

    func testFormationUsesPacedEllipseLikeNativeCoreAnimation() throws {
        let engine = FormationEngine(theme: try decodedFormationTheme())
        let steps = (0...64).map { step in
            engine.snapshot(phaseSeconds: Double(step) / 64 * 4).objects[0]
        }
        let distances = zip(steps, steps.dropFirst()).map {
            hypot($0.centerX - $1.centerX, $0.centerY - $1.centerY)
        }
        let average = distances.reduce(0, +) / Double(distances.count)
        XCTAssertLessThan(distances.map { abs($0 - average) }.max()!, average * 0.02)
    }

    func testFormationHitTestSelectsOnlyCurrentObjectBounds() throws {
        let engine = FormationEngine(theme: try decodedFormationTheme())
        let object = engine.snapshot(phaseSeconds: 1.25).objects[2]
        XCTAssertEqual(engine.hitTest(normalizedX: object.centerX, normalizedY: object.centerY,
                                      halfWidth: 0.04, halfHeight: 0.04,
                                      phaseSeconds: 1.25), object.id)
        XCTAssertNil(engine.hitTest(normalizedX: 0.5, normalizedY: 0.5,
                                    halfWidth: 0.01, halfHeight: 0.01,
                                    phaseSeconds: 1.25))
    }

    func testFormationThemeRejectsDuplicateIdentity() {
        let invalid = Data("""
        {"schemaVersion":1,"track":{"centerX":0.5,"centerY":0.5,"radiusX":0.3,"radiusY":0.2,"periodSeconds":4},
         "objects":[
           {"id":"same","label":"A","colorHex":"#112233","laneOffset":0,"trailingOffset":0},
           {"id":"same","label":"B","colorHex":"#445566","laneOffset":0.04,"trailingOffset":0.1}
         ]}
        """.utf8)
        XCTAssertThrowsError(try FormationTheme.decode(invalid)) { error in
            XCTAssertEqual(error as? FormationThemeError, .invalidObjectIdentity)
        }
    }

    private func decodedFormationTheme() throws -> FormationTheme {
        try FormationTheme.decode(Data("""
        {"schemaVersion":1,"track":{"centerX":0.5,"centerY":0.5,"radiusX":0.34,"radiusY":0.24,"periodSeconds":4},
         "objects":[
           {"id":"alpha","label":"Alpha","colorHex":"#32D6C5","laneOffset":-0.045,"trailingOffset":0},
           {"id":"beta","label":"Beta","colorHex":"#FFB547","laneOffset":0.045,"trailingOffset":0.08},
           {"id":"gamma","label":"Gamma","colorHex":"#A78BFA","laneOffset":-0.045,"trailingOffset":0.18},
           {"id":"delta","label":"Delta","colorHex":"#FF6B7A","laneOffset":0.045,"trailingOffset":0.26}
         ]}
        """.utf8))
    }
}
