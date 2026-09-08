import AppKit
import ProbeCore

/// Experimental object plane above Finder icons, below normal applications.
/// It projects deterministic snapshots and owns no simulation clock or visible object pixels.
@MainActor
final class SplitDesktopControls {
    let objectWindows: [InputProbePanel]
    let objectButtons: [DynamicObjectButton]
    let controlsWindow = InputProbePanel(background: ProbeStyle.surface)
    let effectButton = FirstClickButton(title: "Halo", target: nil, action: nil)
    let pauseButton = FirstClickButton(title: "Pause", target: nil, action: nil)
    let closeButton = FirstClickButton(title: "Fermer", target: nil, action: nil)
    let status = NSTextField(labelWithString: "")
    private(set) var desktopExposed = false
    private(set) var selectedObjectID: String?
    private let usesObjectWindows: Bool

    var objectButton: DynamicObjectButton { objectButtons[0] }
    var mouseDowns: Int {
        objectButtons.reduce(0) { $0 + $1.mouseDowns } +
            [effectButton, pauseButton, closeButton].reduce(0) { $0 + $1.mouseDowns }
    }
    var visibleObjectCount: Int { objectWindows.filter(\.isVisible).count }

    init(theme: FormationTheme, usesObjectWindows: Bool = true, target: AnyObject, open: Selector,
         effect: Selector, pause: Selector, close: Selector) {
        self.usesObjectWindows = usesObjectWindows
        objectWindows = theme.objects.map { _ in InputProbePanel(background: .clear) }
        objectButtons = theme.objects.map { object in
            DynamicObjectButton(objectID: object.id, label: object.label,
                                color: NSColor(hex: object.colorHex) ?? ProbeStyle.accent)
        }
        for (window, button) in zip(objectWindows, objectButtons) {
            button.target = target
            button.action = open
            button.setAccessibilityLabel("Véhicule \(button.objectLabel)")
            window.contentView = button
            button.autoresizingMask = [.width, .height]
        }
        for (button, action) in [(effectButton, effect), (pauseButton, pause), (closeButton, close)] {
            button.target = target
            button.action = action
            button.bezelStyle = .rounded
            button.setAccessibilityLabel(button.title)
        }
        controlsWindow.title = "Commandes de l’objet"
        let buttons = NSStackView(views: [effectButton, pauseButton, closeButton])
        buttons.spacing = 12
        let stack = NSStackView(views: [status, buttons])
        stack.orientation = .vertical
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        controlsWindow.contentView = stack
    }

    func update(snapshot: FormationSnapshot, desktop: NSWindow) {
        let frame = desktop.frame
        for (index, object) in snapshot.objects.enumerated() where index < objectWindows.count {
            let size = NSSize(width: 112, height: 70)
            let center = NSPoint(x: frame.minX + frame.width * object.centerX,
                                 y: frame.minY + frame.height * object.centerY)
            objectWindows[index].setFrame(NSRect(x: center.x - size.width / 2,
                                                  y: center.y - size.height / 2,
                                                  width: size.width, height: size.height), display: true)
            objectButtons[index].headingRadians = object.headingRadians
            objectButtons[index].needsDisplay = true
        }
        if let selectedObjectID,
           let selectedIndex = snapshot.objects.firstIndex(where: { $0.id == selectedObjectID }) {
            let origin = objectWindows[selectedIndex].frame.origin
            controlsWindow.setFrame(NSRect(x: origin.x, y: origin.y - 116, width: 320, height: 100), display: true)
        }
        syncVisibility(panelOpen: controlsWindow.isVisible)
    }

    func select(_ objectID: String) {
        selectedObjectID = objectID
        for button in objectButtons { button.effectEnabled = button.objectID == objectID }
    }

    func setDesktopExposed(_ exposed: Bool) {
        desktopExposed = exposed
        if !exposed { hide() }
    }

    func refresh(_ state: ProbeState) {
        let selected = selectedObjectID ?? "aucun"
        let label = "Objet : \(selected) · clics : \(mouseDowns) · halo : \(state.effectEnabled ? "oui" : "non")"
        if status.stringValue != label { status.stringValue = label }
        pauseButton.title = state.paused ? "Reprendre" : "Pause"
        for button in objectButtons {
            button.effectEnabled = state.effectEnabled && button.objectID == selectedObjectID
            button.needsDisplay = true
        }
        syncVisibility(panelOpen: state.panelOpen)
    }

    private func syncVisibility(panelOpen: Bool) {
        guard desktopExposed else { hide(); return }
        if usesObjectWindows {
            for window in objectWindows where !window.isVisible { window.orderFrontRegardless() }
        }
        if panelOpen {
            if !controlsWindow.isVisible { controlsWindow.orderFrontRegardless() }
        } else if controlsWindow.isVisible { controlsWindow.orderOut(nil) }
    }

    func show() { setDesktopExposed(true); syncVisibility(panelOpen: controlsWindow.isVisible) }
    func hide() {
        objectWindows.forEach { $0.orderOut(nil) }
        controlsWindow.orderOut(nil)
    }
}

@MainActor
class FirstClickButton: NSButton {
    private(set) var mouseDowns = 0
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        mouseDowns += 1
        super.mouseDown(with: event)
    }
}

@MainActor
final class DynamicObjectButton: FirstClickButton {
    let objectID: String
    let objectLabel: String
    let objectColor: NSColor
    var headingRadians = 0.0
    var effectEnabled = false

    init(objectID: String, label: String, color: NSColor) {
        self.objectID = objectID
        self.objectLabel = label
        self.objectColor = color
        super.init(frame: .zero)
        isBordered = false
        focusRingType = .none
        title = label
    }

    required init?(coder: NSCoder) { nil }

    override func draw(_ dirtyRect: NSRect) {
        // Hit-test only. Visible objects belong to the native wallpaper extension.
        NSColor.clear.setFill()
        bounds.fill()
    }
}

@MainActor
final class InputProbePanel: NSPanel {
    init(background: NSColor) {
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
        isOpaque = background != .clear
        backgroundColor = background
    }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private extension NSColor {
    convenience init?(hex: String) {
        guard hex.count == 7, hex.first == "#", let rgb = Int(hex.dropFirst(), radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((rgb >> 16) & 0xff) / 255,
                  green: CGFloat((rgb >> 8) & 0xff) / 255,
                  blue: CGFloat(rgb & 0xff) / 255, alpha: 1)
    }
}
