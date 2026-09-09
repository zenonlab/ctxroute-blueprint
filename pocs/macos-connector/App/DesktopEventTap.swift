import CoreGraphics
import Foundation

enum DesktopTapState: String, Sendable {
    case stopped
    case permissionMissing = "permission-missing"
    case creationFailed = "creation-failed"
    case active
    case rearmed
    case disabled
}

/// Owns the active mouse tap and its private CFRunLoop. The callback never waits
/// for AppKit or XPC; it returns nil only when the synchronous gesture engine has
/// positively captured an event.
final class DesktopEventTap: @unchecked Sendable {
    typealias Handler = @Sendable (CGEventType, CGEvent) -> Bool
    typealias StateHandler = @Sendable (DesktopTapState) -> Void

    private let lock = NSLock()
    private let handler: Handler
    private let stateHandler: StateHandler
    private var port: CFMachPort?
    private var source: CFRunLoopSource?
    private var runLoop: CFRunLoop?
    private var thread: Thread?
    private var termination: DispatchSemaphore?
    private var watchdog: DispatchSourceTimer?
    private var desiredRunning = false
    private var pointName: String?

    init(handler: @escaping Handler, stateHandler: @escaping StateHandler) {
        self.handler = handler
        self.stateHandler = stateHandler
    }

    var isActive: Bool {
        lock.lock(); defer { lock.unlock() }
        return port.map { CFMachPortIsValid($0) && CGEvent.tapIsEnabled(tap: $0) } ?? false
    }
    var locationName: String? {
        lock.lock(); defer { lock.unlock() }
        return pointName
    }

    @discardableResult func start() -> Bool {
        if isActive { stateHandler(.active); return true }
        stop(notify: false)
        lock.lock(); desiredRunning = true; lock.unlock()
        let ready = DispatchSemaphore(value: 0)
        let terminated = DispatchSemaphore(value: 0)
        let thread = Thread { [weak self] in
            guard let self else { ready.signal(); terminated.signal(); return }
            defer {
                self.lock.lock()
                self.port = nil; self.source = nil; self.runLoop = nil; self.thread = nil
                self.termination = nil; self.pointName = nil
                self.lock.unlock()
                terminated.signal()
            }
            let events: [CGEventType] = [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
                                         .leftMouseDragged, .rightMouseDragged]
            let mask = events.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
            let context = Unmanaged.passUnretained(self).toOpaque()
            // Prefer the earliest point used by current Tahoe utilities, but
            // honour Apple's public contract: a non-root process may be denied
            // HID. Session is the safe fallback; annotated-session was too late
            // to isolate "click wallpaper to reveal desktop" on this PoC.
            let candidates: [(CGEventTapLocation, String)] = [(.cghidEventTap, "HID"), (.cgSessionEventTap, "session")]
            var selected: (CFMachPort, String)?
            for (location, name) in candidates {
                if let tap = CGEvent.tapCreate(tap: location, place: .headInsertEventTap,
                        options: .defaultTap, eventsOfInterest: mask,
                        callback: desktopEventTapCallback, userInfo: context) {
                    selected = (tap, name); break
                }
            }
            guard let (tap, pointName) = selected,
                  let source = CFMachPortCreateRunLoopSource(nil, tap, 0) else {
                self.stateHandler(.creationFailed); ready.signal(); return
            }
            let runLoop = CFRunLoopGetCurrent()
            self.lock.lock()
            self.port = tap; self.source = source; self.runLoop = runLoop; self.pointName = pointName
            self.lock.unlock()
            CFRunLoopAddSource(runLoop, source, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            self.stateHandler(CGEvent.tapIsEnabled(tap: tap) ? .active : .disabled)
            ready.signal()
            CFRunLoopRun()
            CFRunLoopRemoveSource(runLoop, source, .commonModes)
        }
        thread.name = "org.wallpaperthemes.connectorpoc2.mouse-tap"
        thread.qualityOfService = .userInteractive
        lock.lock(); self.thread = thread; self.termination = terminated; lock.unlock()
        thread.start()
        ready.wait()
        let active = isActive
        if active { startWatchdog() }
        return active
    }

    func stop() { stop(notify: true) }

    private func stop(notify: Bool) {
        lock.lock()
        desiredRunning = false
        let tap = port, loop = runLoop, terminated = termination, watchdog = watchdog
        self.watchdog = nil
        lock.unlock()
        watchdog?.cancel()
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let loop { CFRunLoopStop(loop) }
        if let terminated, Thread.current != thread {
            _ = terminated.wait(timeout: .now() + 1)
        }
        if notify { stateHandler(.stopped) }
    }

    /// macOS can leave a valid event-tap port silently disabled. A low-frequency
    /// watchdog observes the actual enabled bit; it never fabricates input and
    /// does no work while the tap remains healthy.
    private func startWatchdog() {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(
            label: "org.wallpaperthemes.connectorpoc2.mouse-tap.watchdog", qos: .utility))
        timer.schedule(deadline: .now() + 1.5, repeating: 1.5, leeway: .milliseconds(250))
        timer.setEventHandler { [weak self] in self?.rearmIfNeeded() }
        lock.lock()
        guard desiredRunning, watchdog == nil else { lock.unlock(); return }
        watchdog = timer
        lock.unlock()
        timer.resume()
    }

    private func rearmIfNeeded() {
        lock.lock()
        let shouldRun = desiredRunning
        let tap = port
        lock.unlock()
        guard shouldRun, let tap, CFMachPortIsValid(tap), !CGEvent.tapIsEnabled(tap: tap) else { return }
        CGEvent.tapEnable(tap: tap, enable: true)
        stateHandler(CGEvent.tapIsEnabled(tap: tap) ? .rearmed : .disabled)
    }

    fileprivate func process(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            _ = handler(type, event)
            lock.lock(); let tap = port; lock.unlock()
            if let tap {
                CGEvent.tapEnable(tap: tap, enable: true)
                stateHandler(CGEvent.tapIsEnabled(tap: tap) ? .rearmed : .disabled)
            } else {
                stateHandler(.disabled)
            }
            return Unmanaged.passUnretained(event)
        }
        return handler(type, event) ? nil : Unmanaged.passUnretained(event)
    }
}

private func desktopEventTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent,
                                     userInfo: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    guard let userInfo else { return Unmanaged.passUnretained(event) }
    return Unmanaged<DesktopEventTap>.fromOpaque(userInfo).takeUnretainedValue().process(type: type, event: event)
}
