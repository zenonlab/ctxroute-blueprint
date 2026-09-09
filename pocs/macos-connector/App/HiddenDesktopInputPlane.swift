import AppKit
import QuartzCore

/// Native hit regions used only while Finder's desktop plane is disabled.
/// They render no pixels and stay below normal application windows, so macOS
/// remains the authority for whether a wallpaper target is actually exposed.
@MainActor final class HiddenDesktopInputPlane {
    struct Target {
        let key: String
        let frame: NSRect
        let intent: InteractionIntent
        let theme: Theme
        let layout: SurfaceLayout
    }

    private var snapshot = DesktopInputSnapshot.empty
    private var panels: [String: HiddenInputPanel] = [:]
    private var timer: Timer?
    var onIntent: ((InteractionIntent, Theme, SurfaceLayout) -> Void)?

    func replace(_ snapshot: DesktopInputSnapshot) {
        self.snapshot = snapshot
        refresh(now: CACurrentMediaTime())
        updateTimer()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        panels.values.forEach { $0.orderOut(nil) }
        panels.removeAll()
        snapshot = .empty
    }

    private func updateTimer() {
        let needsAnimation = snapshot.surfaces.contains { surface in
            surface.desktopItemsVisible == false && surface.layout.running
                && surface.theme.motion_path != "still"
                && surface.theme.objects.contains { $0.x == nil || $0.y == nil }
        }
        if needsAnimation && timer == nil {
            let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in self?.refresh(now: CACurrentMediaTime()) }
            }
            RunLoop.main.add(timer, forMode: .common)
            self.timer = timer
        } else if !needsAnimation {
            timer?.invalidate()
            timer = nil
        }
    }

    private func refresh(now: Double) {
        let targets = Self.targets(snapshot: snapshot, now: now)
        let activeKeys = Set(targets.map(\.key))
        for key in panels.keys.filter({ !activeKeys.contains($0) }) {
            panels.removeValue(forKey: key)?.orderOut(nil)
        }
        for target in targets {
            let panel = panels[target.key] ?? HiddenInputPanel()
            if panels[target.key] == nil {
                panel.onClick = { [weak self, weak panel] button in
                    guard let self, let target = panel?.target else { return }
                    let intent: InteractionIntent
                    switch button {
                    case .left: intent = target.intent
                    case .right:
                        guard case .activate(let id) = target.intent else { return }
                        intent = .customize(id)
                    }
                    self.onIntent?(intent, target.theme, target.layout)
                }
                panels[target.key] = panel
            }
            panel.target = target
            if panel.frame != target.frame { panel.setFrame(target.frame, display: false) }
            if !panel.isVisible { panel.orderFrontRegardless() }
        }
    }

    /// Pure projection kept testable without creating an AppKit window.
    static func targets(snapshot: DesktopInputSnapshot, now: Double) -> [Target] {
        guard now.isFinite else { return [] }
        var seen = Set<String>()
        var result: [Target] = []
        for surface in snapshot.surfaces where surface.desktopItemsVisible == false {
            guard let display = surface.layout.display_id,
                  let screen = NSScreen.screens.first(where: {
                      ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == display
                  }) else { continue }
            let prefix = "\(display):\(surface.theme.theme_id)"
            for (index, control) in surface.theme.system_controls.items.enumerated() {
                let intent: InteractionIntent
                if control == "audio" { intent = .toggle(.audio) }
                else if control == "desktop" { intent = .toggle(.desktopItems) }
                else { continue }
                let key = "\(prefix):control:\(index)"
                guard seen.insert(key).inserted else { continue }
                result.append(Target(key: key,
                    frame: appKitFrame(ThemeLayout.control(index), on: screen, layout: surface.layout),
                    intent: intent, theme: surface.theme, layout: surface.layout))
            }
            for object in surface.theme.objects {
                let key = "\(prefix):object:\(object.id)"
                guard seen.insert(key).inserted else { continue }
                let center = ThemeLayout.position(object, theme: surface.theme,
                    width: surface.layout.width, height: surface.layout.height,
                    elapsed: surface.layout.time(at: now))
                let width = max(object.size ?? 44, ThemeLayout.minimumObjectHitWidth)
                let height = max(object.size ?? 44, ThemeLayout.minimumObjectHitHeight)
                let rect = LayoutRect(x: center.x - width / 2, y: center.y - height / 2,
                                      width: width, height: height)
                result.append(Target(key: key, frame: appKitFrame(rect, on: screen, layout: surface.layout),
                    intent: .activate(object.id), theme: surface.theme, layout: surface.layout))
            }
        }
        return result
    }

    private static func appKitFrame(_ rect: LayoutRect, on screen: NSScreen,
                                    layout: SurfaceLayout) -> NSRect {
        NSRect(x: screen.frame.minX + rect.x,
               y: screen.frame.minY + layout.height - rect.y - rect.height,
               width: rect.width, height: rect.height)
    }
}

@MainActor private final class HiddenInputPanel: NSPanel {
    var target: HiddenDesktopInputPlane.Target?
    var onClick: ((PointerButton) -> Void)? {
        didSet { inputView.onClick = onClick }
    }
    private let inputView = HiddenInputView(frame: .zero)

    init() {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        level = NSWindow.Level(rawValue: NSWindow.Level.normal.rawValue - 1)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        isFloatingPanel = false
        hidesOnDeactivate = false
        animationBehavior = .none
        isReleasedWhenClosed = false
        isRestorable = false
        hasShadow = false
        isOpaque = false
        backgroundColor = .clear
        contentView = inputView
    }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor private final class HiddenInputView: NSView {
    var onClick: ((PointerButton) -> Void)?
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseUp(with event: NSEvent) { onClick?(.left) }
    override func rightMouseUp(with event: NSEvent) { onClick?(.right) }
}
