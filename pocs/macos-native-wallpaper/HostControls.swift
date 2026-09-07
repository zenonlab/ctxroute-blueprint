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
        let titles: [(DiagnosticCommand, String)] = [(.showPanel, "Ouvrir le panneau dans le décor"),
            (.hidePanel, "Fermer le panneau du décor"), (.pause, "Mettre l’animation en pause"),
            (.resume, "Reprendre l’animation"), (.effectOn, "Activer l’effet lumineux"),
            (.effectOff, "Désactiver l’effet"), (.reset, "Réinitialiser les états visuels")]
        for (command, title) in titles {
            let button = NSButton(title: title, target: self, action: #selector(send(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(command.rawValue)
            views.append(button)
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
