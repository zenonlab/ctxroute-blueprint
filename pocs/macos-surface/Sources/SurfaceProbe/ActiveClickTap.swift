@preconcurrency import ApplicationServices
import Foundation
import ProbeCore

extension Notification.Name {
    static let wallpaperObjectHit = Notification.Name("wallpaper.poc.object-hit")
}

/// Active, narrowly filtered event tap. It suppresses only a click that hits a themed object.
final class ActiveClickTap: @unchecked Sendable {
    private let engine: FormationEngine
    private let lock = NSLock()
    private var screenFrame: CGRect
    private var port: CFMachPort?
    private var source: CFRunLoopSource?

    init(engine: FormationEngine, screenFrame: CGRect) {
        self.engine = engine
        self.screenFrame = screenFrame
    }

    var isInstalled: Bool { lock.withLock { port != nil } }
    var isTrusted: Bool { AXIsProcessTrusted() }

    func install(promptForAccessibility: Bool) -> Bool {
        let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        guard AXIsProcessTrustedWithOptions([promptKey: promptForAccessibility] as CFDictionary) else {
            return false
        }
        let mask = CGEventMask(1) << CGEventType.leftMouseDown.rawValue
        guard let created = CGEvent.tapCreate(tap: .cgAnnotatedSessionEventTap,
                                              place: .headInsertEventTap,
                                              options: .defaultTap,
                                              eventsOfInterest: mask,
                                              callback: activeClickTapCallback,
                                              userInfo: Unmanaged.passUnretained(self).toOpaque()) else {
            return false
        }
        let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0)
        lock.withLock {
            port = created
            source = runLoopSource
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: created, enable: true)
        return true
    }

    func update(screenFrame: CGRect) { lock.withLock { self.screenFrame = screenFrame } }

    func setEnabled(_ enabled: Bool) {
        guard let current = lock.withLock({ port }) else { return }
        CGEvent.tapEnable(tap: current, enable: enabled)
    }

    func stop() {
        let retained = lock.withLock { () -> (CFMachPort?, CFRunLoopSource?) in
            defer { port = nil; source = nil }
            return (port, source)
        }
        if let source = retained.1 { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let port = retained.0 { CFMachPortInvalidate(port) }
    }

    fileprivate func objectHit(at quartzLocation: CGPoint, phaseSeconds: TimeInterval) -> String? {
        let frame = lock.withLock { screenFrame }
        let location = CGPoint(x: quartzLocation.x, y: frame.maxY - quartzLocation.y + frame.minY)
        guard frame.contains(location) else { return nil }
        return engine.hitTest(normalizedX: (location.x - frame.minX) / frame.width,
                              normalizedY: (location.y - frame.minY) / frame.height,
                              halfWidth: 56 / frame.width, halfHeight: 35 / frame.height,
                              phaseSeconds: phaseSeconds)
    }
}

private func activeClickTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent,
                                    userInfo: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    guard let userInfo else { return Unmanaged.passUnretained(event) }
    let tap = Unmanaged<ActiveClickTap>.fromOpaque(userInfo).takeUnretainedValue()
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        tap.setEnabled(true)
        return Unmanaged.passUnretained(event)
    }
    guard type == .leftMouseDown,
          let objectID = tap.objectHit(at: event.location,
                                       phaseSeconds: ProcessInfo.processInfo.systemUptime) else {
        return Unmanaged.passUnretained(event)
    }
    OperationQueue.main.addOperation {
        NotificationCenter.default.post(name: .wallpaperObjectHit, object: objectID)
    }
    return nil
}
