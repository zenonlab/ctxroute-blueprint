import AppKit

@MainActor
final class HostControls: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private let status = NSTextField(wrappingLabelWithString: "Aucune commande envoyée. Le fond interactif doit être sélectionné séparément.")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 490, height: 420),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Commandes du wallpaper · essai"
        window.isReleasedWhenClosed = false
        let heading = NSTextField(wrappingLabelWithString:
            "Compagnon de contrôle — ce panneau n’est pas le fond d’écran.\nLes clics directement dans le décor ne sont pas encore activés.")
        var views: [NSView] = [heading]
        do {
            for action in try DiagnosticTheme.load().actions {
                let button = NSButton(title: action.label, target: self, action: #selector(send(_:)))
                button.identifier = NSUserInterfaceItemIdentifier(action.command.rawValue)
                views.append(button)
            }
        } catch {
            status.stringValue = "Asset de thème invalide : \(error). Aucune commande disponible."
        }
        let settings = NSButton(title: "Ouvrir les réglages du fond", target: self, action: #selector(openSettings))
        views += [settings, status]
        let stack = NSStackView(views: views)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 20)])
        self.window = window
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    @objc private func send(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue, let command = DiagnosticCommand(rawValue: id) else { return }
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(command.notification as CFString), nil, nil, true)
        status.stringValue = "Demande envoyée : \(sender.title). Réception non confirmée ; vérifier le décor."
    }

    @objc private func openSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Wallpaper-Settings.extension")!)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
