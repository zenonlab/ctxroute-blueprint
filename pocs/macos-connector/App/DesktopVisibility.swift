import AppKit
import CoreGraphics

struct DesktopCoverageWindow: Equatable {
    let ownerPID: pid_t
    let layer: Int
    let alpha: Double
    let bounds: CGRect
}

enum DesktopVisibilityPolicy {
    /// A display is occluded only by one application's certain, opaque,
    /// normal-layer coverage. WindowServer fragments may be joined by PID;
    /// windows from unrelated applications are never combined.
    static func visible(displays: [CGRect], windows: [DesktopCoverageWindow], excludedPIDs: Set<pid_t>) -> Bool? {
        guard !displays.isEmpty, displays.allSatisfy({ !$0.isEmpty && $0.isFinite }) else { return nil }
        let candidates = windows.filter {
            !excludedPIDs.contains($0.ownerPID) && $0.layer == 0 && $0.alpha >= 0.99
                && !$0.bounds.isEmpty && $0.bounds.isFinite
        }
        let byOwner = Dictionary(grouping: candidates, by: \.ownerPID)
        let fullyOccluded = displays.allSatisfy { display in
            byOwner.values.contains { windows in
                covers(display, rectangles: windows.map(\.bounds))
            }
        }
        return !fullyOccluded
    }

    private static func covers(_ target: CGRect, rectangles: [CGRect]) -> Bool {
        let clipped = rectangles.map { $0.intersection(target) }.filter { !$0.isNull && !$0.isEmpty }
        var xValues = [target.minX, target.maxX]
        for rect in clipped { xValues.append(max(target.minX, rect.minX)); xValues.append(min(target.maxX, rect.maxX)) }
        xValues = Array(Set(xValues)).sorted()
        guard xValues.count >= 2 else { return false }
        for index in 0..<(xValues.count - 1) where xValues[index + 1] - xValues[index] > 0.5 {
            let x = (xValues[index] + xValues[index + 1]) / 2
            let intervals = clipped.filter { $0.minX <= x + 0.5 && $0.maxX >= x - 0.5 }
                .map { (max(target.minY, $0.minY), min(target.maxY, $0.maxY)) }
                .sorted { $0.0 < $1.0 }
            var covered = target.minY
            for interval in intervals where interval.1 >= covered - 1 {
                guard interval.0 <= covered + 1 else { break }
                covered = max(covered, interval.1)
                if covered >= target.maxY - 1 { break }
            }
            if covered < target.maxY - 1 { return false }
        }
        return true
    }
}

extension DesktopVisibilityPolicy {
    @MainActor
    static func current(displays: [CGRect]) -> Bool? {
        visible(displays: displays, windows: DesktopVisibility.currentWindows(),
            excludedPIDs: DesktopVisibility.excludedPIDs())
    }

    @MainActor
    static func desktopArea(displayID: CGDirectDisplayID) -> CGRect? {
        guard CGDisplayIsOnline(displayID) != 0,
              let screen = NSScreen.screens.first(where: {
                  ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == displayID
              }) else { return nil }
        let display = CGDisplayBounds(displayID)
        let frame = screen.frame
        let visible = screen.visibleFrame
        return CGRect(x: display.minX + visible.minX - frame.minX,
            y: display.minY + frame.maxY - visible.maxY,
            width: visible.width, height: visible.height)
    }
}

/// Event-driven visibility classification. It creates no window and no periodic timer.
@MainActor final class DesktopVisibility {
    private var catalog: CatalogStatus?
    private var observers: [NSObjectProtocol] = []
    private var refreshTask: Task<Void, Never>?
    private(set) var values: [String: Bool?] = [:]
    var onChange: (() -> Void)?

    init() {
        let workspace = NSWorkspace.shared.notificationCenter
        let names: [Notification.Name] = [
            NSWorkspace.didActivateApplicationNotification,
            NSWorkspace.activeSpaceDidChangeNotification,
            NSWorkspace.didLaunchApplicationNotification,
            NSWorkspace.didTerminateApplicationNotification,
            NSWorkspace.didHideApplicationNotification,
            NSWorkspace.didUnhideApplicationNotification
        ]
        for name in names {
            observers.append(workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.schedule() }
            })
        }
        observers.append(NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.schedule() }
        })
    }

    func update(_ catalog: CatalogStatus?) {
        self.catalog = catalog
        schedule(delay: .zero)
    }

    /// Mouse-up catches full-screen and zoom changes made inside the active app.
    func pointerActivity() { schedule() }

    /// Outer optional: this theme has been classified. Inner optional: the
    /// classifier ran but could not establish a safe result.
    func classification(for themeID: String) -> Bool?? { values[themeID] }

    private func schedule(delay: Duration = .milliseconds(120)) {
        refreshTask?.cancel()
        refreshTask = Task { @MainActor [weak self] in
            if delay != .zero {
                do { try await Task.sleep(for: delay) } catch { return }
            }
            self?.refresh()
        }
    }

    private func refresh() {
        guard let catalog else {
            if !values.isEmpty { values = [:]; onChange?() }
            return
        }
        let windows = Self.currentWindows()
        let excluded = Self.excludedPIDs()
        var next: [String: Bool?] = [:]
        for theme in catalog.themes where theme.surfaces > 0 {
            let displayIDs = Set((catalog.layouts ?? []).filter { $0.theme_id == theme.theme_id }.compactMap(\.display_id))
            let displays = displayIDs.compactMap(DesktopVisibilityPolicy.desktopArea)
            next[theme.theme_id] = DesktopVisibilityPolicy.visible(
                displays: displays, windows: windows, excludedPIDs: excluded)
        }
        guard !Self.equal(values, next) else { return }
        values = next
        onChange?()
    }

    fileprivate static func currentWindows() -> [DesktopCoverageWindow] {
        guard let descriptions = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
        ) as? [[String: Any]] else { return [] }
        return descriptions.compactMap { value in
            guard let owner = value[kCGWindowOwnerPID as String] as? NSNumber,
                  let layer = value[kCGWindowLayer as String] as? NSNumber,
                  let alpha = value[kCGWindowAlpha as String] as? NSNumber,
                  let dictionary = value[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: dictionary as CFDictionary) else { return nil }
            return DesktopCoverageWindow(ownerPID: owner.int32Value, layer: layer.intValue,
                alpha: alpha.doubleValue, bounds: bounds)
        }
    }

    fileprivate static func excludedPIDs() -> Set<pid_t> {
        var result: Set<pid_t> = [getpid()]
        let excludedBundles: Set<String> = [
            "org.wallpaperthemes.connectorpoc2",
            "org.wallpaperthemes.connectorpoc2.agent"
        ]
        for app in NSWorkspace.shared.runningApplications where
            app.bundleIdentifier.map(excludedBundles.contains) == true {
            result.insert(app.processIdentifier)
        }
        return result
    }

    private static func equal(_ lhs: [String: Bool?], _ rhs: [String: Bool?]) -> Bool {
        lhs == rhs
    }
}

private extension CGRect {
    var isFinite: Bool {
        [origin.x, origin.y, size.width, size.height].allSatisfy(\.isFinite)
    }
}
