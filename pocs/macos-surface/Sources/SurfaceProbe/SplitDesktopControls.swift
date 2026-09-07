import AppKit
import ProbeCore

/// Experimental widget plane above Finder icons, below normal applications.
/// Never claim icon priority for this mode. No global input monitor.
@MainActor
final class SplitDesktopControls {
    let objectWindow = InputProbePanel()
    let controlsWindow = InputProbePanel()
    let objectButton = FirstClickButton(title: "Objet · ouvrir", target: nil, action: nil)
    let effectButton = FirstClickButton(title: "Halo", target: nil, action: nil)
    let pauseButton = FirstClickButton(title: "Pause", target: nil, action: nil)
    let closeButton = FirstClickButton(title: "Fermer", target: nil, action: nil)
    let status = NSTextField(labelWithString: "")

    var mouseDowns: Int {
        [objectButton, effectButton, pauseButton, closeButton].reduce(0) { $0 + $1.mouseDowns }
    }

    init(target: AnyObject, open: Selector, effect: Selector, pause: Selector, close: Selector) {
        for (button, action) in [(objectButton, open), (effectButton, effect),
                                 (pauseButton, pause), (closeButton, close)] {
            button.target = target
            button.action = action
            button.bezelStyle = .rounded
            button.setAccessibilityLabel(button.title)
        }
        objectWindow.title = "Objet wallpaper · essai"
        objectWindow.contentView = objectButton
        objectButton.autoresizingMask = [.width, .height]
        controlsWindow.title = "Commandes objet wallpaper"
        let buttons = NSStackView(views: [effectButton, pauseButton, closeButton])
        buttons.spacing = 12
        let stack = NSStackView(views: [status, buttons])
        stack.orientation = .vertical
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        controlsWindow.contentView = stack
    }

    func place(relativeTo desktop: NSWindow, anchor: NSRect) {
        objectWindow.setFrame(desktop.convertToScreen(anchor), display: true)
        let origin = objectWindow.frame.origin
        controlsWindow.setFrame(NSRect(x: origin.x, y: origin.y - 116, width: 300, height: 100), display: true)
    }

    func refresh(_ state: ProbeState) {
        let label = "Clics reçus : \(mouseDowns) · halo : \(state.effectEnabled ? "oui" : "non")"
        if status.stringValue != label { status.stringValue = label }
        pauseButton.title = state.paused ? "Reprendre" : "Pause"
        if state.panelOpen {
            if !controlsWindow.isVisible { controlsWindow.orderFrontRegardless() }
        } else if controlsWindow.isVisible { controlsWindow.orderOut(nil) }
    }

    func show() { objectWindow.orderFrontRegardless() }
    func hide() { objectWindow.orderOut(nil); controlsWindow.orderOut(nil) }
}

@MainActor
final class FirstClickButton: NSButton {
    private(set) var mouseDowns = 0
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        mouseDowns += 1
        super.mouseDown(with: event)
    }
}

@MainActor
final class InputProbePanel: NSPanel {
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
        backgroundColor = ProbeStyle.surface
    }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
