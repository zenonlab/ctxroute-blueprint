import AppKit
@preconcurrency import ApplicationServices
import QuartzCore
import os

struct DesktopInputDelivery: Sendable {
    let intent: InteractionIntent
    let theme: Theme
    let layout: SurfaceLayout
}

private struct DesktopInputOutcome: Sendable {
    let consumed: Bool
    let delivery: DesktopInputDelivery?
}

/// Synchronous state owned by the tap thread. The lock protects catalog refreshes
/// from XPC while a gesture is in flight; no AppKit window or XPC call occurs here.
private final class DesktopGestureEngine: @unchecked Sendable {
    private let lock = NSLock()
    private var snapshot = DesktopInputSnapshot.empty
    private var router = GestureRouter(scene: UUID(), objectIDs: [])
    private var gestureTheme: String?
    private var captured = false

    func replace(_ value: DesktopInputSnapshot) {
        lock.lock(); defer { lock.unlock() }
        snapshot = value
        captured = false
        gestureTheme = nil
        router.cancel()
    }

    func reset() {
        lock.lock(); defer { lock.unlock() }
        captured = false
        gestureTheme = nil
        router.detach()
    }

    func consume(_ type: CGEventType, _ event: CGEvent) -> DesktopInputOutcome {
        lock.lock(); defer { lock.unlock() }
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            captured = false; router.detach()
            return DesktopInputOutcome(consumed: false, delivery: nil)
        }
        if type == .leftMouseDragged || type == .rightMouseDragged {
            if captured { router.cancel() }
            return DesktopInputOutcome(consumed: captured, delivery: nil)
        }
        let down = type == .leftMouseDown || type == .rightMouseDown
        let button: PointerButton = type == .leftMouseDown || type == .leftMouseUp ? .left : .right
        guard let target = snapshot.target(at: event.location, now: CACurrentMediaTime()) else {
            return finishUnauthorized(down: down, button: button)
        }
        let theme = target.theme, layout = target.layout, point = target.point
        let authorized: Bool
        switch target.desktopItemsVisible {
        case true:
            authorized = snapshot.finderPID.map {
                FinderBackground.contains(event.location, finderPID: $0)
            } ?? false
        case false:
            // CreateDesktop removes Finder's useful AX plane. Use the window that
            // WindowServer attached to this exact event; never create an overlay.
            authorized = DesktopEventTarget.isDesktop(event)
        case nil:
            authorized = false
        }
        let hit: SceneHit = authorized
            ? ThemeLayout.hit(point, theme: theme, width: layout.width, height: layout.height,
                elapsed: layout.time(at: CACurrentMediaTime())) : .native
        if down {
            if router.scene != layout.id || gestureTheme != theme.theme_id {
                router.replaceScene(layout.id, objectIDs: Set(theme.objects.map(\.id)))
            }
            gestureTheme = theme.theme_id
            let consumed = router.begin(button: button, point: point, hit: hit,
                scene: layout.id, inputAuthorized: true)
            captured = captured || consumed
            return DesktopInputOutcome(consumed: consumed, delivery: nil)
        }
        let result = router.end(button: button, point: point, hit: hit,
            scene: layout.id, inputAuthorized: true)
        if result.consumed { captured = false }
        return DesktopInputOutcome(consumed: result.consumed,
            delivery: result.intent.map { DesktopInputDelivery(intent: $0, theme: theme, layout: layout) })
    }

    private func finishUnauthorized(down: Bool, button: PointerButton) -> DesktopInputOutcome {
        if down {
            router.cancel()
            return DesktopInputOutcome(consumed: false, delivery: nil)
        }
        let result = router.end(button: button, point: ScenePoint(x: 0, y: 0), hit: .unknown,
            scene: router.scene, inputAuthorized: false)
        if result.consumed { captured = false }
        return DesktopInputOutcome(consumed: result.consumed, delivery: nil)
    }
}

/// The global path owns no overlay window or frame polling in either Finder mode.
@MainActor final class DesktopInput {
    private let engine = DesktopGestureEngine()
    private var screensAwake = true
    private var sessionActive = true
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var traceBudget = CommandLine.arguments.contains("--diagnostics") ? 32 : 0
    private lazy var tap = DesktopEventTap(handler: { [weak self] type, event in
        guard let self else { return false }
        let outcome = self.engine.consume(type, event)
        if type == .leftMouseUp || type == .rightMouseUp {
            Task { @MainActor [weak self] in self?.onPointerActivity?() }
        }
        if let delivery = outcome.delivery {
            Task { @MainActor [weak self] in
                self?.trace("intent-dispatched")
                self?.onIntent?(delivery.intent, delivery.theme, delivery.layout)
            }
        }
        return outcome.consumed
    }, stateHandler: { [weak self] state in
        Task { @MainActor [weak self] in self?.record(state) }
    })
    private(set) var tapState = DesktopTapState.stopped
    var catalog: CatalogStatus? {
        didSet {
            let snapshot = DesktopInputSnapshot.make(catalog)
            engine.replace(snapshot)
        }
    }
    var onIntent: ((InteractionIntent, Theme, SurfaceLayout) -> Void)?
    var onPointerActivity: (() -> Void)?
    var onStatus: ((DesktopTapState, Bool) -> Void)?
    var installed: Bool { tap.isActive }
    var tapLocation: String? { tap.locationName }

    init() {
        // The accessory agent need not become active when the user returns from
        // Privacy settings. Observe the desktop lifecycle, as in the first PoC.
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.activeSpaceDidChangeNotification,
                     NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification,
                     NSWorkspace.screensDidSleepNotification, NSWorkspace.screensDidWakeNotification,
                     NSWorkspace.sessionDidResignActiveNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            lifecycleObservers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                let name = note.name
                Task { @MainActor in
                    guard let self else { return }
                    self.engine.reset()
                    switch name {
                    case NSWorkspace.screensDidSleepNotification:
                        self.screensAwake = false; self.tap.stop()
                    case NSWorkspace.screensDidWakeNotification: self.screensAwake = true
                    case NSWorkspace.sessionDidResignActiveNotification:
                        self.sessionActive = false; self.tap.stop()
                    case NSWorkspace.sessionDidBecomeActiveNotification: self.sessionActive = true
                    default: break
                    }
                    let snapshot = DesktopInputSnapshot.make(self.catalog)
                    self.engine.replace(snapshot)
                    if self.screensAwake && self.sessionActive {
                        self.install()
                    }
                }
            })
        }
    }

    /// Only called from an explicit user menu action, never at startup.
    func requestPermission() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        if AXIsProcessTrustedWithOptions([key: true] as CFDictionary) { tap.stop(); install() }
        else { record(.permissionMissing) }
    }

    func install() {
        let trusted = AXIsProcessTrusted()
        guard trusted else { record(.permissionMissing); return }
        guard screensAwake, sessionActive else { record(.stopped); return }
        if !tap.start() { record(.creationFailed) }
    }
    func stop() { engine.reset(); tap.stop() }

    /// Shared recovery path; injected operations let tests verify retry and refusal
    /// without creating an event tap or changing the user's permissions.
    static func restoreExistingTap(trusted: Bool, awake: Bool, active: Bool,
                                   isEnabled: () -> Bool, enable: () -> Void) -> Bool {
        guard trusted, awake, active else { return false }
        if !isEnabled() { enable() }
        return isEnabled()
    }
    private func record(_ state: DesktopTapState) {
        tapState = state
        trace("tap-\(state.rawValue)-\(tap.locationName ?? "none")")
        onStatus?(state, AXIsProcessTrusted())
    }
    private func trace(_ decision: String) {
        guard traceBudget > 0 else { return }
        traceBudget -= 1
        // Fixed decision codes only: no coordinates, object IDs or desktop data.
        Logger(subsystem: "org.wallpaperthemes.connectorpoc2", category: "input").notice("\(decision, privacy: .public)")
    }
}

/// Measured macOS desktop: AXGroup -> AXScrollArea -> AXApplication.
/// Never promote an icon or a Finder window by walking upward to a matching group.
enum FinderBackground {
    static func matches(bundle: String?, roles: [String]) -> Bool {
        guard bundle == "com.apple.finder", let first = roles.first,
              first == kAXGroupRole || first == kAXScrollAreaRole,
              roles.last == kAXApplicationRole,
              roles.contains(kAXScrollAreaRole) else { return false }
        // A Finder window, icon, label or control always remains native. The
        // desktop background itself can gain intermediary AXGroup ancestors
        // across macOS versions, so its chain must not be fixed to three nodes.
        let nativeRoles: Set<String> = [kAXWindowRole, kAXImageRole, kAXButtonRole,
                                        kAXStaticTextRole]
        return roles.allSatisfy { !nativeRoles.contains($0) }
    }
    static func contains(_ point: CGPoint, finderPID: pid_t) -> Bool {
        let started = CACurrentMediaTime()
        let system = AXUIElementCreateSystemWide()
        // Three milliseconds proved too aggressive on a busy Finder and made
        // otherwise valid targets intermittently fail closed. Keep a strict
        // total budget while allowing individual public AX calls to complete.
        AXUIElementSetMessagingTimeout(system, 0.012)
        var target: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &target) == .success,
              let target else { return false }
        AXUIElementSetMessagingTimeout(target, 0.012)
        var pid: pid_t = 0
        guard AXUIElementGetPid(target, &pid) == .success else { return false }
        guard pid == finderPID else { return false }
        var roles: [String] = [], current = target
        for _ in 0..<8 {
            guard CACurrentMediaTime() - started < 0.075,
                  let role = attribute(current, kAXRoleAttribute) as? String else { return false }
            roles.append(role)
            if role == kAXApplicationRole { break }
            guard let parent = attribute(current, kAXParentAttribute),
                  CFGetTypeID(parent) == AXUIElementGetTypeID() else { return false }
            current = unsafeDowncast(parent, to: AXUIElement.self)
        }
        return matches(bundle: "com.apple.finder", roles: roles) && CACurrentMediaTime() - started < 0.080
    }
    private static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        AXUIElementSetMessagingTimeout(element, 0.012)
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
}
