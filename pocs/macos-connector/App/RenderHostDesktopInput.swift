import AppKit
@preconcurrency import ApplicationServices
import QuartzCore

enum RenderHostDesktopAction: Sendable {
    case audioVolume(Double)
    case desktopFiles
    case brightness(Double)
    case visualPause
    case target(String, context: Bool)
}

private final class RenderHostGestureState: @unchecked Sendable {
    private struct Capture {
        let button: CGMouseButton
        let hit: RenderHostHitSnapshot.Target
        let start: CGPoint
        var cancelled: Bool
    }
    private let lock = NSLock()
    private var snapshot: RenderHostHitSnapshot?
    private var receivedAt = 0.0
    private var desktopItemsVisible: Bool?
    private var finderPID: pid_t?
    private var capture: Capture?
    private let deliver: @Sendable (RenderHostDesktopAction) -> Void

    init(deliver: @escaping @Sendable (RenderHostDesktopAction) -> Void) { self.deliver = deliver }

    func update(snapshot: RenderHostHitSnapshot?, desktopItemsVisible: Bool?, finderPID: pid_t?) {
        lock.withLock {
            self.snapshot = snapshot
            receivedAt = CACurrentMediaTime()
            self.desktopItemsVisible = desktopItemsVisible
            self.finderPID = finderPID
            if snapshot == nil { capture = nil }
        }
    }

    func consume(_ type: CGEventType, event: CGEvent) -> Bool {
        lock.withLock {
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                capture = nil
                return false
            }
            if type == .leftMouseDragged || type == .rightMouseDragged {
                guard var current = capture else { return false }
                if current.hit.kind == .control, isSlider(current.hit.id) {
                    deliverSlider(current.hit.id, point: event.location, target: current.hit)
                } else if hypot(event.location.x - current.start.x, event.location.y - current.start.y) > 4 {
                    current.cancelled = true
                    capture = current
                }
                return true
            }
            let down = type == .leftMouseDown || type == .rightMouseDown
            let button: CGMouseButton = type == .leftMouseDown || type == .leftMouseUp ? .left : .right
            if down {
                guard capture == nil, authorized(event), let hit = hit(event.location),
                      allowed(hit: hit, button: button) else { return false }
                capture = Capture(button: button, hit: hit, start: event.location, cancelled: false)
                if button == .left, isSlider(hit.id) {
                    deliverSlider(hit.id, point: event.location, target: hit)
                }
                return true
            }
            guard let current = capture, current.button == button else { return false }
            capture = nil
            guard !current.cancelled, authorized(event) else { return true }
            if isSlider(current.hit.id) { return true }
            dispatch(hit: current.hit, button: button, point: event.location)
            return true
        }
    }

    private func allowed(hit: RenderHostHitSnapshot.Target, button: CGMouseButton) -> Bool {
        hit.kind == .target || (button == .left && hit.kind == .control)
    }

    private func hit(_ point: CGPoint) -> RenderHostHitSnapshot.Target? {
        guard let snapshot, CACurrentMediaTime() - receivedAt <= 0.5 else { return nil }
        let bounds = CGDisplayBounds(CGMainDisplayID())
        guard bounds.width > 0, bounds.height > 0, bounds.contains(point) else { return nil }
        let x = (point.x - bounds.minX) * snapshot.width / bounds.width
        let y = (point.y - bounds.minY) * snapshot.height / bounds.height
        return snapshot.hit(x: x, y: y)
    }

    private func sliderValue(_ point: CGPoint, target: RenderHostHitSnapshot.Target) -> Double {
        let bounds = CGDisplayBounds(CGMainDisplayID())
        guard let snapshot, bounds.width > 0 else { return 0 }
        let x = (point.x - bounds.minX) * snapshot.width / bounds.width
        return min(1, max(0, (x - target.x) / target.width))
    }

    private func isSlider(_ id: String) -> Bool {
        id == "theme.audio" || id == "display.brightness"
    }

    private func deliverSlider(_ id: String, point: CGPoint, target: RenderHostHitSnapshot.Target) {
        let value = sliderValue(point, target: target)
        deliver(id == "theme.audio" ? .audioVolume(value) : .brightness(value))
    }

    private func dispatch(hit: RenderHostHitSnapshot.Target, button: CGMouseButton, point _: CGPoint) {
        if hit.kind == .target {
            deliver(.target(hit.id, context: button == .right))
        } else if hit.id == "desktop.files" {
            deliver(.desktopFiles)
        } else if hit.id == "visual.motion" {
            deliver(.visualPause)
        }
    }

    private func authorized(_ event: CGEvent) -> Bool {
        switch desktopItemsVisible {
        case true:
            return finderPID.map { RenderHostFinderBackground.contains(event.location, finderPID: $0) } ?? false
        case false:
            return DesktopEventTarget.isDesktop(event)
        case nil:
            return false
        }
    }
}

@MainActor final class RenderHostDesktopInput {
    private let state: RenderHostGestureState
    private lazy var tap = DesktopEventTap(handler: { [state] type, event in
        state.consume(type, event: event)
    }, stateHandler: { _ in })
    var onAction: ((RenderHostDesktopAction) -> Void)?

    init() {
        let delivery = MainActorDelivery()
        state = RenderHostGestureState { action in delivery.send(action) }
        delivery.owner = self
    }

    func update(snapshot: RenderHostHitSnapshot?, desktopItemsVisible: Bool?) {
        let finder = NSWorkspace.shared.runningApplications
            .first { $0.bundleIdentifier == "com.apple.finder" }?.processIdentifier
        state.update(snapshot: snapshot, desktopItemsVisible: desktopItemsVisible, finderPID: finder)
    }

    func requestPermissionAndStart() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        guard AXIsProcessTrustedWithOptions([key: true] as CFDictionary) else { return }
        _ = tap.start()
    }
    func startIfAuthorized() {
        guard AXIsProcessTrusted() else { return }
        _ = tap.start()
    }
    func stop() { state.update(snapshot: nil, desktopItemsVisible: nil, finderPID: nil); tap.stop() }

    private final class MainActorDelivery: @unchecked Sendable {
        weak var owner: RenderHostDesktopInput?
        func send(_ action: RenderHostDesktopAction) {
            Task { @MainActor [weak self] in self?.owner?.onAction?(action) }
        }
    }
}

enum RenderHostFinderBackground {
    static func contains(_ point: CGPoint, finderPID: pid_t) -> Bool {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 0.012)
        var target: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &target) == .success,
              let target else { return false }
        var current = target
        var roles: [String] = []
        for _ in 0..<8 {
            var role: CFTypeRef?
            guard AXUIElementCopyAttributeValue(current, kAXRoleAttribute as CFString, &role) == .success,
                  let role = role as? String else { return false }
            roles.append(role)
            if role == kAXApplicationRole { break }
            var parent: CFTypeRef?
            guard AXUIElementCopyAttributeValue(current, kAXParentAttribute as CFString, &parent) == .success,
                  let parent, CFGetTypeID(parent) == AXUIElementGetTypeID() else { return false }
            current = unsafeDowncast(parent, to: AXUIElement.self)
        }
        var pid: pid_t = 0
        guard AXUIElementGetPid(target, &pid) == .success, pid == finderPID,
              roles.last == kAXApplicationRole, roles.contains(kAXScrollAreaRole) else { return false }
        let native: Set<String> = [kAXWindowRole, kAXImageRole, kAXButtonRole, kAXStaticTextRole]
        return (roles.first == kAXGroupRole || roles.first == kAXScrollAreaRole)
            && roles.allSatisfy { !native.contains($0) }
    }
}
