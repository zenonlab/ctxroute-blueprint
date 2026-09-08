import XCTest
@testable import ThemeModel

final class GestureTests: XCTestCase {
    let scene = UUID()
    let point = ScenePoint(x: 100, y: 80)
    func makeRouter() -> GestureRouter { GestureRouter(scene: scene, objectIDs: ["car.a", "car.b"]) }

    func testLeftLaunchAndRightCustomizeAreExclusive() {
        for button in [PointerButton.left, .right] {
            var router = makeRouter()
            XCTAssertTrue(router.begin(button: button, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: true))
            let result = router.end(button: button, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: true)
            XCTAssertEqual(result.intent, button == .left ? .activate("car.a") : .customize("car.a"))
            XCTAssertTrue(result.consumed)
            XCTAssertNil(router.end(button: button, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: true).intent)
        }
    }
    func testEmptySpaceOnlyCreatesOnRightClickRelease() {
        var router = makeRouter()
        XCTAssertFalse(router.begin(button: .left, point: point, hit: .empty, scene: scene, inputAuthorized: true))
        XCTAssertFalse(router.end(button: .left, point: point, hit: .empty, scene: scene, inputAuthorized: true).consumed)
        XCTAssertTrue(router.begin(button: .right, point: point, hit: .empty, scene: scene, inputAuthorized: true))
        XCTAssertEqual(router.end(button: .right, point: point, hit: .empty, scene: scene, inputAuthorized: true).intent, .add(point))
    }
    func testNativeUnknownAbsentObjectsAndDeniedInputNeverCapture() {
        for hit in [SceneHit.native, .unknown, .object("missing")] {
            for button in [PointerButton.left, .right] {
                var router = makeRouter()
                XCTAssertFalse(router.begin(button: button, point: point, hit: hit, scene: scene, inputAuthorized: true))
                XCTAssertFalse(router.end(button: button, point: point, hit: hit, scene: scene, inputAuthorized: true).consumed)
            }
        }
        var router = makeRouter()
        XCTAssertFalse(router.begin(button: .left, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: false))
    }
    func testDragOutAndBackCannotBecomeClick() {
        var router = makeRouter()
        XCTAssertTrue(router.begin(button: .left, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: true))
        router.move(to: ScenePoint(x: 106, y: 80)); router.move(to: point)
        let result = router.end(button: .left, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: true)
        XCTAssertTrue(result.consumed); XCTAssertNil(result.intent)
    }
    func testPermissionLossNativeOverlapAndTargetChangeAtReleaseCancel() {
        for hit in [SceneHit.native, .unknown, .object("car.b"), .empty] {
            var router = makeRouter()
            _ = router.begin(button: .left, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: true)
            XCTAssertNil(router.end(button: .left, point: point, hit: hit, scene: scene, inputAuthorized: true).intent)
        }
        var router = makeRouter()
        _ = router.begin(button: .right, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: true)
        XCTAssertNil(router.end(button: .right, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: false).intent)
    }
    func testSceneReplacementAndExplicitCancelKeepBalancedRelease() {
        var router = makeRouter()
        _ = router.begin(button: .right, point: point, hit: .empty, scene: scene, inputAuthorized: true)
        let replacement = UUID()
        router.replaceScene(replacement, objectIDs: ["car.a"])
        let result = router.end(button: .right, point: point, hit: .empty, scene: replacement, inputAuthorized: true)
        XCTAssertTrue(result.consumed); XCTAssertNil(result.intent)
        _ = router.begin(button: .right, point: point, hit: .empty, scene: replacement, inputAuthorized: true)
        router.cancel()
        XCTAssertNil(router.end(button: .right, point: point, hit: .empty, scene: replacement, inputAuthorized: true).intent)
    }
    func testControlsNeverActivateObjectsUnderneath() {
        for control in [ShelfControl.audio, .desktopItems] {
            var router = makeRouter()
            XCTAssertTrue(router.begin(button: .left, point: point, hit: .control(control), scene: scene, inputAuthorized: true))
            XCTAssertEqual(router.end(button: .left, point: point, hit: .control(control), scene: scene, inputAuthorized: true).intent, .toggle(control))
            XCTAssertFalse(router.begin(button: .right, point: point, hit: .control(control), scene: scene, inputAuthorized: true))
        }
    }
    func testStaleInvalidUnpairedAndOverlappingEvents() {
        var router = makeRouter()
        XCTAssertFalse(router.begin(button: .left, point: point, hit: .object("car.a"), scene: UUID(), inputAuthorized: true))
        XCTAssertFalse(router.begin(button: .left, point: ScenePoint(x: .nan, y: 0), hit: .object("car.a"), scene: scene, inputAuthorized: true))
        _ = router.begin(button: .left, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: true)
        XCTAssertFalse(router.begin(button: .right, point: point, hit: .empty, scene: scene, inputAuthorized: true))
        XCTAssertFalse(router.end(button: .right, point: point, hit: .empty, scene: scene, inputAuthorized: true).consumed)
        XCTAssertNil(router.end(button: .left, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: true).intent)
        router.detach()
        XCTAssertFalse(router.end(button: .left, point: point, hit: .object("car.a"), scene: scene, inputAuthorized: true).consumed)
    }
}
