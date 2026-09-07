import AppKit
import ProbeCore

/// Explicit controls outside the click-through desktop surface.
@MainActor
final class DesktopMenu: NSObject, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let pauseItem: NSMenuItem
    let animationItem: NSMenuItem
    let effectItem: NSMenuItem
    let readState: () -> ProbeState

    init(target: AnyObject, pause: Selector, animation: Selector, effect: Selector,
         quit: Selector, duration: TimeInterval, readState: @escaping () -> ProbeState) {
        self.readState = readState
        pauseItem = NSMenuItem(title: "Pause", action: pause, keyEquivalent: "")
        animationItem = NSMenuItem(title: "Animation", action: animation, keyEquivalent: "")
        effectItem = NSMenuItem(title: "Halo", action: effect, keyEquivalent: "")
        super.init()
        item.button?.title = "WP"
        item.button?.toolTip = "Contrôles du fond de test"
        item.button?.setAccessibilityLabel("Contrôles Wallpaper")
        let menu = NSMenu(title: "Wallpaper")
        menu.autoenablesItems = false
        menu.delegate = self
        let heading = NSMenuItem(title: "Fond de test · arrêt après \(Int(duration)) s", action: nil, keyEquivalent: "")
        heading.isEnabled = false
        menu.addItem(heading)
        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "Arrêter le fond", action: quit, keyEquivalent: "")
        for control in [pauseItem, animationItem, effectItem, quitItem] {
            control.target = target
            menu.addItem(control)
        }
        item.menu = menu
    }

    func menuWillOpen(_ menu: NSMenu) {
        let state = readState()
        pauseItem.title = state.paused ? "Reprendre" : "Pause"
        animationItem.state = state.animationRequested ? .on : .off
        effectItem.state = state.effectEnabled ? .on : .off
    }

    func remove() { NSStatusBar.system.removeStatusItem(item) }
}
