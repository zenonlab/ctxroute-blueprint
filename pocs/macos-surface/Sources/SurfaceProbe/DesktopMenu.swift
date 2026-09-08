import AppKit
import ProbeCore

/// Explicit controls outside the click-through desktop surface.
@MainActor
final class DesktopMenu: NSObject, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let pauseItem: NSMenuItem
    let animationItem: NSMenuItem
    let effectItem: NSMenuItem
    let desktopItemsItem: NSMenuItem
    let readState: () -> ProbeState
    let readDesktopItems: () -> Bool

    init(target: AnyObject, pause: Selector, animation: Selector, effect: Selector,
         desktopItems: Selector, quit: Selector, duration: TimeInterval, persistent: Bool,
         readState: @escaping () -> ProbeState, readDesktopItems: @escaping () -> Bool) {
        self.readState = readState
        self.readDesktopItems = readDesktopItems
        pauseItem = NSMenuItem(title: "Pause", action: pause, keyEquivalent: "")
        animationItem = NSMenuItem(title: "Animation", action: animation, keyEquivalent: "")
        effectItem = NSMenuItem(title: "Halo", action: effect, keyEquivalent: "")
        desktopItemsItem = NSMenuItem(title: "Fichiers du bureau", action: desktopItems, keyEquivalent: "")
        super.init()
        item.button?.title = "WP"
        item.button?.toolTip = "Contrôles du fond de test"
        item.button?.setAccessibilityLabel("Contrôles Wallpaper")
        let menu = NSMenu(title: "Wallpaper")
        menu.autoenablesItems = false
        menu.delegate = self
        let headingTitle = persistent ? "Fond interactif · actif jusqu’à l’arrêt" :
            "Fond de test · arrêt après \(Int(duration)) s"
        let heading = NSMenuItem(title: headingTitle, action: nil, keyEquivalent: "")
        heading.isEnabled = false
        menu.addItem(heading)
        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "Arrêter le fond", action: quit, keyEquivalent: "")
        for control in [pauseItem, animationItem, effectItem, desktopItemsItem, quitItem] {
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
        desktopItemsItem.state = readDesktopItems() ? .on : .off
    }

    func remove() { NSStatusBar.system.removeStatusItem(item) }
}
