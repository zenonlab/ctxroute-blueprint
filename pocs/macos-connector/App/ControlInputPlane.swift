import AppKit

/// Input-only AppKit windows for fixed system controls rendered by the provider.
/// They own no pixels or theme state and never cover more than the declared hit-boxes.
@MainActor final class ControlInputPlane: NSObject {
    struct Projection: Equatable {
        let quartz: CGRect
        let appKit: CGRect
    }
    private struct Key: Hashable {
        let display: UInt32
        let theme: String
        let index: Int
    }
    private struct Target {
        let key: Key
        let projection: Projection
        let control: ShelfControl
        let theme: Theme
        let layout: SurfaceLayout
    }
    private final class InputPanel: NSPanel {
        init(frame: CGRect) {
            super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel],
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
        }
        override var canBecomeKey: Bool { false }
        override var canBecomeMain: Bool { false }
    }
    private final class InputButton: NSButton {
        var control: ShelfControl
        var theme: Theme
        var layout: SurfaceLayout
        init(control: ShelfControl, theme: Theme, layout: SurfaceLayout) {
            self.control = control; self.theme = theme; self.layout = layout
            super.init(frame: .zero)
            title = ""; isBordered = false; focusRingType = .none
            setAccessibilityLabel(control == .audio ? "Son du thème" : "Fichiers du bureau")
        }
        required init?(coder: NSCoder) { nil }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
        override func rightMouseDown(with event: NSEvent) {} // reserved control: never Finder background
    }

    private var windows: [Key: (InputPanel, InputButton)] = [:]
    private var quartzFrames: [CGRect] = []
    var onControl: ((ShelfControl, Theme, SurfaceLayout) -> Void)?

    static func projection(control: LayoutRect, quartzDisplay: CGRect, appKitScreen: CGRect) -> Projection {
        Projection(
            quartz: CGRect(x: quartzDisplay.minX + control.x, y: quartzDisplay.minY + control.y,
                           width: control.width, height: control.height),
            appKit: CGRect(x: appKitScreen.minX + control.x,
                           y: appKitScreen.maxY - control.y - control.height,
                           width: control.width, height: control.height)
        )
    }

    func contains(_ quartzPoint: CGPoint) -> Bool { quartzFrames.contains(where: { $0.contains(quartzPoint) }) }

    func update(_ catalog: CatalogStatus?) {
        let targets = Self.targets(catalog)
        let active = Set(targets.map(\.key))
        for key in Array(windows.keys) where !active.contains(key) {
            windows.removeValue(forKey: key)?.0.orderOut(nil)
        }
        for target in targets {
            let pair: (InputPanel, InputButton)
            if let current = windows[target.key] {
                pair = current
                pair.1.control = target.control; pair.1.theme = target.theme; pair.1.layout = target.layout
            } else {
                let button = InputButton(control: target.control, theme: target.theme, layout: target.layout)
                button.target = self; button.action = #selector(activate(_:))
                let panel = InputPanel(frame: target.projection.appKit)
                panel.contentView = button; button.autoresizingMask = [.width, .height]
                pair = (panel, button); windows[target.key] = pair
            }
            if pair.0.frame != target.projection.appKit { pair.0.setFrame(target.projection.appKit, display: false) }
            if !pair.0.isVisible { pair.0.orderFrontRegardless() }
        }
        quartzFrames = targets.map(\.projection.quartz)
    }

    func hide() {
        windows.values.forEach { $0.0.orderOut(nil) }
        windows.removeAll(); quartzFrames = []
    }

    @objc private func activate(_ sender: InputButton) {
        onControl?(sender.control, sender.theme, sender.layout)
    }

    private static func targets(_ catalog: CatalogStatus?) -> [Target] {
        guard let catalog else { return [] }
        let grouped = Dictionary(grouping: catalog.layouts?.filter(\.interactive) ?? []) {
            "\($0.display_id ?? 0)/\($0.theme_id)"
        }
        return grouped.values.flatMap { layouts -> [Target] in
            guard let first = layouts.first, let display = first.display_id,
                  layouts.allSatisfy({ $0.display_id == display && $0.theme_id == first.theme_id
                    && $0.width == first.width && $0.height == first.height }),
                  let theme = catalog.theme(first.theme_id)?.configuration,
                  let screen = NSScreen.screens.first(where: {
                      ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == display
                  }) else { return [] }
            let bounds = CGDisplayBounds(display)
            guard abs(bounds.width - first.width) < 1, abs(bounds.height - first.height) < 1,
                  abs(screen.frame.width - first.width) < 1, abs(screen.frame.height - first.height) < 1 else { return [] }
            return theme.system_controls.items.enumerated().compactMap { index, item in
                let control: ShelfControl
                if item == "audio" { control = .audio }
                else if item == "desktop" { control = .desktopItems }
                else { return nil }
                return Target(key: Key(display: display, theme: theme.theme_id, index: index),
                    projection: projection(control: ThemeLayout.control(index), quartzDisplay: bounds,
                                           appKitScreen: screen.frame),
                    control: control, theme: theme, layout: first)
            }
        }
    }
}
