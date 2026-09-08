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
    private var exclusionFrames: [CGRect] = []
    private var port: CFMachPort?
    private var source: CFRunLoopSource?
    private var suppressNextLeftMouseUp = false

    init(engine: FormationEngine, screenFrame: CGRect) {
        self.engine = engine
        self.screenFrame = screenFrame
    }

    var isInstalled: Bool { lock.withLock { port != nil } }
    var isTrusted: Bool { AXIsProcessTrusted() }

    func install(promptForAccessibility: Bool) -> Bool {
        if isInstalled { return true }
        let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        guard AXIsProcessTrustedWithOptions([promptKey: promptForAccessibility] as CFDictionary) else {
            return false
        }
        let mask = (CGEventMask(1) << CGEventType.leftMouseDown.rawValue) |
            (CGEventMask(1) << CGEventType.leftMouseUp.rawValue)
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

    /// AppKit-coordinate rectangles owned by native controls. Their events must never
    /// be reclassified as wallpaper-object hits, even when a vehicle passes behind them.
    func update(exclusionFrames: [CGRect]) { lock.withLock { self.exclusionFrames = exclusionFrames } }

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
        let (frame, exclusions) = lock.withLock { (screenFrame, exclusionFrames) }
        let location = CGPoint(x: quartzLocation.x, y: frame.maxY - quartzLocation.y + frame.minY)
        guard frame.contains(location) else { return nil }
        guard !exclusions.contains(where: { $0.contains(location) }) else { return nil }
        return engine.hitTest(normalizedX: (location.x - frame.minX) / frame.width,
                              normalizedY: (location.y - frame.minY) / frame.height,
                              halfWidth: 56 / frame.width, halfHeight: 35 / frame.height,
                              phaseSeconds: phaseSeconds)
    }

    fileprivate func consumeMouseUpIfNeeded() -> Bool {
        lock.withLock {
            defer { suppressNextLeftMouseUp = false }
            return suppressNextLeftMouseUp
        }
    }

    fileprivate func markMouseDown(consumed: Bool) {
        lock.withLock { suppressNextLeftMouseUp = consumed }
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
    if type == .leftMouseUp {
        return tap.consumeMouseUpIfNeeded() ? nil : Unmanaged.passUnretained(event)
    }
    guard type == .leftMouseDown else {
        return Unmanaged.passUnretained(event)
    }
    guard let objectID = tap.objectHit(at: event.location,
                                      phaseSeconds: ProcessInfo.processInfo.systemUptime) else {
        tap.markMouseDown(consumed: false)
        return Unmanaged.passUnretained(event)
    }
    tap.markMouseDown(consumed: true)
    OperationQueue.main.addOperation {
        NotificationCenter.default.post(name: .wallpaperObjectHit, object: objectID)
    }
    return nil
}
