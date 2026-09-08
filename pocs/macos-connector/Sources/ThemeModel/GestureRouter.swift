import Foundation

/// Coordinates in the scene's local logical points, not global desktop pixels.
public struct ScenePoint: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
    var isFinite: Bool { x.isFinite && y.isFinite }
    func distance(to other: ScenePoint) -> Double { hypot(x - other.x, y - other.y) }
}

public enum PointerButton: Sendable { case left, right }
public enum ShelfControl: Sendable { case audio, desktopItems }
public enum SceneHit: Equatable, Sendable {
    case native, unknown, empty
    case object(String)
    case control(ShelfControl)
}
public enum InteractionIntent: Equatable, Sendable {
    case activate(String)
    case customize(String)
    case add(ScenePoint)
    case toggle(ShelfControl)
}
public struct GestureResult: Equatable, Sendable {
    public let consumed: Bool
    public let intent: InteractionIntent?
}

/// Pure decision policy, not a desktop input adapter or an authorization broker.
/// The connector must positively classify Finder priority and permission at BOTH
/// ends of a gesture. No OS action is executed here, including for synthetic input.
public struct GestureRouter: Sendable {
    private struct Capture: Sendable {
        let button: PointerButton
        let hit: SceneHit
        let start: ScenePoint
        let scene: UUID
        var cancelled = false
    }
    public private(set) var scene: UUID
    private var objectIDs: Set<String>
    private var capture: Capture?
    private let dragThreshold: Double

    public init(scene: UUID, objectIDs: Set<String>, dragThreshold: Double = 4) {
        self.scene = scene; self.objectIDs = objectIDs
        self.dragThreshold = dragThreshold.isFinite && dragThreshold >= 0 ? dragThreshold : 4
    }
    /// Returns whether the adapter should capture the down event. A left click in
    /// empty space stays native, including the start of Finder rectangle selection.
    public mutating func begin(button: PointerButton, point: ScenePoint, hit: SceneHit,
                               scene: UUID, inputAuthorized: Bool) -> Bool {
        guard capture == nil else { cancel(); return false }
        guard inputAuthorized, self.scene == scene, point.isFinite, isKnown(hit) else { return false }
        if hit == .empty && button == .left { return false }
        if case .control = hit, button == .right { return false }
        capture = Capture(button: button, hit: hit, start: point, scene: scene)
        return true
    }
    public mutating func move(to point: ScenePoint) {
        guard let capture else { return }
        if !point.isFinite || capture.start.distance(to: point) > dragThreshold { cancel() }
    }
    /// Cancellation retains only the obligation to consume the matching up event.
    /// It cannot become a click again when the pointer returns to its start.
    public mutating func cancel() { capture?.cancelled = true }
    public mutating func replaceScene(_ scene: UUID, objectIDs: Set<String>) {
        cancel(); self.scene = scene; self.objectIDs = objectIDs
    }
    /// Call only after the native tap/window has been detached and its gesture
    /// lifecycle ended; unlike cancel(), this discards the pending up obligation.
    public mutating func detach() { capture = nil }

    public mutating func end(button: PointerButton, point: ScenePoint, hit: SceneHit,
                             scene: UUID, inputAuthorized: Bool) -> GestureResult {
        guard let active = capture, active.button == button else {
            return GestureResult(consumed: false, intent: nil)
        }
        capture = nil
        guard !active.cancelled, inputAuthorized, self.scene == scene, active.scene == scene,
              point.isFinite, active.start.distance(to: point) <= dragThreshold,
              compatibleRelease(active.hit, hit), isKnown(active.hit) else {
            return GestureResult(consumed: true, intent: nil)
        }
        let intent: InteractionIntent
        switch active.hit {
        case .object(let id): intent = button == .left ? .activate(id) : .customize(id)
        case .empty: intent = .add(point)
        case .control(let control): intent = .toggle(control)
        case .native, .unknown: return GestureResult(consumed: true, intent: nil)
        }
        return GestureResult(consumed: true, intent: intent)
    }
    private func isKnown(_ hit: SceneHit) -> Bool {
        switch hit {
        case .native, .unknown: false
        case .object(let id): objectIDs.contains(id)
        case .empty, .control: true
        }
    }
    private func compatibleRelease(_ captured: SceneHit, _ current: SceneHit) -> Bool {
        switch (captured, current) {
        // A scene object may move away while the physical pointer stays still.
        // Finder/native priority is still revalidated at release by DesktopInput.
        case (.object(let first), .object(let second)): first == second
        case (.object, .empty): true
        default: captured == current
        }
    }
}
