import Foundation

public enum ProbeVisibility: String, Sendable {
    case unknown, visible, notVisible
}

/// Diagnostic state only. No session, pathfinding, game or rendering dependency.
public struct ProbeState: Sendable {
    public private(set) var panelOpen = false
    public private(set) var animationRequested = false
    public private(set) var paused = false
    public private(set) var effectEnabled = false
    public private(set) var phaseSeconds: Double = 0
    public private(set) var ticks = 0
    public private(set) var actions = 0
    public var visibility: ProbeVisibility = .unknown
    public var reducedMotion = false
    public let interactive: Bool

    public init(interactive: Bool, animate: Bool = false) {
        self.interactive = interactive
        self.animationRequested = animate
    }

    public var shouldAnimate: Bool {
        animationRequested && !paused && !reducedMotion && visibility == .visible
    }

    public mutating func openPanel() {
        guard interactive else { return }
        panelOpen = true
        actions += 1
    }

    public mutating func closePanel() {
        guard interactive else { return }
        panelOpen = false
        actions += 1
    }

    public mutating func toggleAnimation() {
        guard interactive else { return }
        animationRequested.toggle()
        actions += 1
    }

    public mutating func togglePause() {
        guard interactive else { return }
        paused.toggle()
        actions += 1
    }

    public mutating func toggleEffect() {
        guard interactive else { return }
        effectEnabled.toggle()
        actions += 1
    }

    /// No catch-up storm after a delayed timer or system sleep.
    @discardableResult
    public mutating func advance(by delta: Double) -> Bool {
        guard shouldAnimate, delta.isFinite, delta > 0 else { return false }
        phaseSeconds = (phaseSeconds + min(delta, 0.1)).truncatingRemainder(dividingBy: 4)
        ticks += 1
        return true
    }
}
