import AppKit
@preconcurrency import ApplicationServices
import QuartzCore
import os

/// No overlay window, keyboard interception, frame polling or permission prompt.
@MainActor final class DesktopInput {
    private var port: CFMachPort?
    private var source: CFRunLoopSource?
    private var router = GestureRouter(scene: UUID(), objectIDs: [])
    private var gestureTheme: String?
    private var captured = false
    private var screensAwake = true
    private var sessionActive = true
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var traceBudget = CommandLine.arguments.contains("--diagnostics") ? 32 : 0
    private lazy var controls: ControlInputPlane = {
        let plane = ControlInputPlane()
        plane.onControl = { [weak self] control, theme, layout in
            self?.onIntent?(.toggle(control), theme, layout)
        }
        return plane
    }()
    var catalog: CatalogStatus? { didSet { controls.update(catalog) } }
    var onIntent: ((InteractionIntent, Theme, SurfaceLayout) -> Void)?
    var installed: Bool { port.map { CGEvent.tapIsEnabled(tap: $0) } ?? false }

    init() {
        // The accessory agent need not become active when the user returns from
        // Privacy settings. Observe the desktop lifecycle, as in the first PoC.
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.activeSpaceDidChangeNotification,
                     NSWorkspace.screensDidSleepNotification, NSWorkspace.screensDidWakeNotification,
                     NSWorkspace.sessionDidResignActiveNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            lifecycleObservers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                let name = note.name
                Task { @MainActor in
                    guard let self else { return }
                    self.router.cancel()
                    switch name {
                    case NSWorkspace.screensDidSleepNotification: self.screensAwake = false
                    case NSWorkspace.screensDidWakeNotification: self.screensAwake = true
                    case NSWorkspace.sessionDidResignActiveNotification: self.sessionActive = false
                    case NSWorkspace.sessionDidBecomeActiveNotification: self.sessionActive = true
                    default: break
                    }
                    if self.screensAwake && self.sessionActive { self.install() }
                }
            })
        }
    }

    /// Only called from an explicit user menu action, never at startup.
    func requestPermission() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        if AXIsProcessTrustedWithOptions([key: true] as CFDictionary) { detachTap(); install() }
    }

    func install() {
        let trusted = AXIsProcessTrusted()
        guard trusted, screensAwake, sessionActive else { return }
        if let port {
            if CFMachPortIsValid(port) {
                let wasEnabled = CGEvent.tapIsEnabled(tap: port)
                let restored = Self.restoreExistingTap(trusted: trusted, awake: screensAwake,
                    active: sessionActive, isEnabled: { CGEvent.tapIsEnabled(tap: port) },
                    enable: { CGEvent.tapEnable(tap: port, enable: true) })
                if !wasEnabled { trace(restored ? "tap-reenabled" : "tap-reenable-failed") }
                return
            }
            detachTap()
        }
        let events: [CGEventType] = [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
                                     .leftMouseDragged, .rightMouseDragged]
        let mask = events.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
            options: .defaultTap, eventsOfInterest: mask, callback: { _, type, event, context in
                guard let context else { return Unmanaged.passUnretained(event) }
                let consumed = MainActor.assumeIsolated {
                    let input = Unmanaged<DesktopInput>.fromOpaque(context).takeUnretainedValue()
                    return input.consume(type, event)
                }
                return consumed ? nil : Unmanaged.passUnretained(event)
            }, userInfo: Unmanaged.passUnretained(self).toOpaque()) else { trace("tap-create-failed"); return }
        port = tap; source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        trace(installed ? "tap-enabled" : "tap-disabled")
    }
    func stop() {
        detachTap()
        controls.hide()
    }
    private func detachTap() {
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let port { CFMachPortInvalidate(port) }
        port = nil; source = nil; captured = false; router.detach()
    }
    /// Shared recovery path; injected operations let tests verify retry and refusal
    /// without creating an event tap or changing the user's permissions.
    static func restoreExistingTap(trusted: Bool, awake: Bool, active: Bool,
                                   isEnabled: () -> Bool, enable: () -> Void) -> Bool {
        guard trusted, awake, active else { return false }
        if !isEnabled() { enable() }
        return isEnabled()
    }
    private func consume(_ type: CGEventType, _ event: CGEvent) -> Bool {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            trace("tap-disabled-by-system")
            router.detach(); captured = false
            // No AX queries or reinstall inside the time-sensitive callback.
            // A stopped agent must not be resurrected by an already queued task.
            Task { @MainActor [weak self] in
                guard let self, self.port != nil else { return }
                self.install()
            }
            return false
        }
        if type == .leftMouseDragged || type == .rightMouseDragged {
            if captured { router.cancel() }
            return captured
        }
        // Fixed controls are real, tiny AppKit input regions. The native window owns
        // the complete gesture; the global tap must neither consume nor reinterpret it.
        if controls.contains(event.location) { return false }
        let down = type == .leftMouseDown || type == .rightMouseDown
        let button: PointerButton = type == .leftMouseDown || type == .leftMouseUp ? .left : .right
        guard screensAwake, sessionActive, AXIsProcessTrusted(), let (theme, layout, point) = target(at: event.location) else {
            if down { trace("no-authorized-surface") }
            router.cancel()
            if !down {
                let result = router.end(button: button, point: ScenePoint(x: 0, y: 0), hit: .unknown,
                    scene: router.scene, inputAuthorized: false)
                if result.consumed { captured = false }
                return result.consumed
            }
            return false
        }
        let hit: SceneHit = FinderBackground.contains(event.location)
            ? ThemeLayout.hit(point, theme: theme, width: layout.width, height: layout.height,
                elapsed: layout.time(at: CACurrentMediaTime())) : .native
        if down { trace(hit == .native ? "finder-rejected" : "finder-background-accepted") }
        if down {
            if router.scene != layout.id || gestureTheme != theme.theme_id {
                router.replaceScene(layout.id, objectIDs: Set(theme.objects.map(\.id)))
            }
            gestureTheme = theme.theme_id
            let consumed = router.begin(button: button, point: point, hit: hit,
                scene: layout.id, inputAuthorized: true)
            captured = captured || consumed
            return consumed
        }
        let result = router.end(button: button, point: point, hit: hit, scene: layout.id, inputAuthorized: true)
        if result.consumed { captured = false }
        if let intent = result.intent {
            trace("intent-dispatched")
            // UI activation and XPC are deliberately outside the tap callback.
            Task { @MainActor [weak self] in self?.onIntent?(intent, theme, layout) }
        }
        return result.consumed
    }
    private func trace(_ decision: String) {
        guard traceBudget > 0 else { return }
        traceBudget -= 1
        // Fixed decision codes only: no coordinates, object IDs or desktop data.
        Logger(subsystem: "org.wallpaperthemes.connectorpoc2", category: "input").notice("\(decision, privacy: .public)")
    }
    private func target(at point: CGPoint) -> (Theme, SurfaceLayout, ScenePoint)? {
        guard let catalog else { return nil }
        let matches = (catalog.layouts ?? []).compactMap { layout -> (Theme, SurfaceLayout, ScenePoint)? in
            guard layout.interactive, let display = layout.display_id,
                  let screen = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == display }),
                  let theme = catalog.theme(layout.theme_id)?.configuration else { return nil }
            let bounds = CGDisplayBounds(display)
            guard bounds.contains(point), abs(layout.width - screen.frame.width) < 1,
                  abs(layout.height - screen.frame.height) < 1,
                  abs(bounds.width - layout.width) < 1, abs(bounds.height - layout.height) < 1 else { return nil }
            return (theme, layout, ScenePoint(x: point.x - bounds.minX, y: point.y - bounds.minY))
        }
        // Native AX priority is checked separately: duplicates only become a
        // candidate when they agree on the same theme, coordinates and hit.
        guard let first = matches.first, matches.allSatisfy({ $0.0 == first.0 && $0.2 == first.2 }),
              let layout = SurfaceLayout.consensus(matches.map { $0.1 }, theme: first.0,
                point: first.2, now: CACurrentMediaTime()) else { return nil }
        return (first.0, layout, first.2)
    }
}

/// Measured macOS desktop: AXGroup -> AXScrollArea -> AXApplication.
/// Never promote an icon or a Finder window by walking upward to a matching group.
@MainActor enum FinderBackground {
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
    static func contains(_ point: CGPoint) -> Bool {
        let started = CACurrentMediaTime()
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 0.003)
        var target: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &target) == .success,
              let target else { return false }
        AXUIElementSetMessagingTimeout(target, 0.003)
        var pid: pid_t = 0
        guard AXUIElementGetPid(target, &pid) == .success else { return false }
        let bundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier
        guard bundle == "com.apple.finder" else { return false }
        var roles: [String] = [], current = target
        for _ in 0..<8 {
            guard CACurrentMediaTime() - started < 0.018,
                  let role = attribute(current, kAXRoleAttribute) as? String else { return false }
            roles.append(role)
            if role == kAXApplicationRole { break }
            guard let parent = attribute(current, kAXParentAttribute),
                  CFGetTypeID(parent) == AXUIElementGetTypeID() else { return false }
            current = unsafeDowncast(parent, to: AXUIElement.self)
        }
        return matches(bundle: bundle, roles: roles) && CACurrentMediaTime() - started < 0.020
    }
    private static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        AXUIElementSetMessagingTimeout(element, 0.003)
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
}
