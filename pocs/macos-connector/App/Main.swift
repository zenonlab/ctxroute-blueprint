import AppKit
import ImageIO
import UniformTypeIdentifiers

@main @MainActor enum ConnectorMain {
    static func main() throws {
        if CommandLine.arguments.contains("--check") || CommandLine.arguments.contains("--probe-mailbox") {
            _ = try Theme.catalog()
            print("transport-mode=\(Mailbox.developmentEnabled ? "local-ad-hoc" : "strict")")
            do {
                let mailbox = try Mailbox.shared()
                if CommandLine.arguments.contains("--probe-mailbox") {
                    try mailbox.verifyAccess()
                    print("local-process-access=read-write provider=unconfirmed")
                }
                print("manifest=valid transport=unconfirmed (provider receipt required)")
            }
            catch { print("manifest=valid transport=unavailable: \(error.localizedDescription)"); exit(2) }
            return
        }
        if CommandLine.arguments.count == 3, ["--thumbnail", "--thumbnails"].contains(CommandLine.arguments[1]) {
            let all = CommandLine.arguments[1] == "--thumbnails"
            for theme in try all ? Theme.catalog() : [Theme.load()] {
                let destinationURL = all
                    ? URL(fileURLWithPath: CommandLine.arguments[2]).appendingPathComponent(theme.theme_id + ".png")
                    : URL(fileURLWithPath: CommandLine.arguments[2])
                let scene = Scene(theme: theme); scene.resize(CGSize(width: 480, height: 270))
                guard let context = CGContext(data: nil, width: 480, height: 270, bitsPerComponent: 8,
                    bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
                    let destination = CGImageDestinationCreateWithURL(destinationURL as CFURL,
                        UTType.png.identifier as CFString, 1, nil) else { throw ModelError.invalid("thumbnail") }
                scene.root.render(in: context)
                guard let image = context.makeImage() else { throw ModelError.invalid("image") }
                CGImageDestinationAddImage(destination, image, nil)
                guard CGImageDestinationFinalize(destination) else { throw ModelError.invalid("PNG") }
            }
            return
        }
        if CommandLine.arguments.contains("--preflight-install") {
            do { try Preflight.check(installing: true); print("preflight=passed") }
            catch { print(error.localizedDescription); exit(2) }
            return
        }
        let app = NSApplication.shared
        if let id = Bundle.main.bundleIdentifier,
           let existing = NSRunningApplication.runningApplications(withBundleIdentifier: id)
            .first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            guard existing.bundleURL?.standardizedFileURL == Bundle.main.bundleURL.standardizedFileURL else {
                print("Lancement refusé : une autre version du connecteur est déjà ouverte. Aucun processus arrêté."); exit(2)
            }
            existing.activate(options: []); return
        }
        app.setActivationPolicy(.regular)
        do { try Preflight.check(installing: false) }
        catch {
            let alert = NSAlert(); alert.messageText = "Lancement refusé"
            alert.informativeText = error.localizedDescription
            alert.runModal(); return
        }
        let delegate = try ConnectorApp(themes: Theme.catalog()); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor final class ConnectorApp: NSObject, NSApplicationDelegate {
    let themes: [Theme]
    var theme: Theme { themes[themePicker.indexOfSelectedItem >= 0 ? themePicker.indexOfSelectedItem : 0] }
    let themePicker = NSPopUpButton()
    let mailbox: Mailbox?
    let transportFailure: String?
    var window: NSWindow!
    var signal: WakeSignal?
    var observed: ProviderStatus?
    var pending: Command?
    var timeout: Task<Void, Never>?
    let statusLabel = NSTextField(wrappingLabelWithString: "Le provider doit être sélectionné dans les réglages Fond d’écran.")
    var pauseButton: NSButton!
    var effectButton: NSButton!
    init(themes: [Theme]) {
        self.themes = themes
        do { mailbox = try Mailbox.shared(); transportFailure = nil }
        catch { mailbox = nil; transportFailure = error.localizedDescription }
        super.init()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 560),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Wallpaper Connector · PoC 2"
        window.isReleasedWhenClosed = false
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 18
        stack.edgeInsets = NSEdgeInsets(top: 28, left: 28, bottom: 28, right: 28)
        let title = NSTextField(labelWithString: "Wallpaper Connector"); title.font = .systemFont(ofSize: 26, weight: .semibold)
        let subtitle = NSTextField(wrappingLabelWithString: "Une scène native. Un seul panneau de contrôle.")
        subtitle.textColor = .secondaryLabelColor
        stack.addArrangedSubview(title); stack.addArrangedSubview(subtitle)
        themePicker.addItems(withTitles: themes.map(\.display_name))
        themePicker.target = self; themePicker.action = #selector(changeControlTheme)
        stack.addArrangedSubview(NSTextField(labelWithString: "Thème à contrôler (le fond se choisit dans macOS)"))
        stack.addArrangedSubview(themePicker)
        let controls = NSStackView(); controls.orientation = .horizontal; controls.spacing = 12
        pauseButton = NSButton(title: "Suspendre", target: self, action: #selector(pause))
        effectButton = NSButton(title: "Accentuer", target: self, action: #selector(effect))
        for button in [pauseButton!, effectButton!] { button.bezelStyle = .rounded; controls.addArrangedSubview(button) }
        stack.addArrangedSubview(controls)
        statusLabel.font = .systemFont(ofSize: 13); stack.addArrangedSubview(statusLabel)
        let capabilities = NSTextField(wrappingLabelWithString:
            "Audio : scène silencieuse\nEntrée bureau : passive, aucune interception\nFichiers du bureau : réglage macOS, automatisation non qualifiée")
        capabilities.textColor = .secondaryLabelColor; stack.addArrangedSubview(capabilities)
        stack.addArrangedSubview(NSButton(title: "Choisir ce fond dans macOS…", target: self, action: #selector(wallpaperSettings)))
        stack.addArrangedSubview(NSButton(title: "Afficher / masquer les fichiers dans Réglages…", target: self, action: #selector(desktopSettings)))
        stack.addArrangedSubview(NSButton(title: "Vérifier la connexion", target: self, action: #selector(check)))
        window.contentView = stack; window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        let menu = NSMenu(); let appMenu = NSMenuItem(); menu.addItem(appMenu)
        let submenu = NSMenu(); submenu.addItem(withTitle: "Quitter", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenu.submenu = submenu; NSApp.mainMenu = menu
        if mailbox != nil { signal = WakeSignal(Mailbox.statusSignal) { [weak self] in self?.receive() } }
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshAndProbe() }
        }
        refreshAndProbe()
        // Finite UI smoke: captures this app's content only, never the desktop.
        if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--smoke" {
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1))
                guard let view = window.contentView,
                      let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
                    print("smoke=failed: view unavailable"); NSApp.terminate(nil); return
                }
                view.cacheDisplay(in: view.bounds, to: bitmap)
                do {
                    guard let png = bitmap.representation(using: .png, properties: [:]) else { throw ModelError.invalid("PNG") }
                    try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), options: .atomic)
                    print("smoke=passed windows=\(NSApp.windows.filter { $0.isVisible }.count) panel=\(theme.panel_id)")
                } catch { print("smoke=failed: capture") }
                NSApp.terminate(nil)
            }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    @objc func wallpaperSettings() { open("x-apple.systempreferences:com.apple.Wallpaper-Settings.extension") }
    @objc func desktopSettings() { open("x-apple.systempreferences:com.apple.Desktop-Settings.extension") }
    private func open(_ value: String) {
        if let url = URL(string: value), !NSWorkspace.shared.open(url) { statusLabel.stringValue = "Impossible d’ouvrir les Réglages macOS." }
    }
    @objc func pause() { send(observed?.state.paused == true ? .resume : .pause) }
    @objc func effect() { send(observed?.state.highlighted == true ? .unhighlight : .highlight) }
    @objc func check() { refreshAndProbe() }
    @objc func changeControlTheme() {
        pending = nil; timeout?.cancel(); observed = nil; refreshAndProbe()
    }
    func refreshAndProbe() {
        guard pending == nil else { return }
        do { observed = try mailbox?.status()?.theme(theme.theme_id) } catch { observed = nil }
        setEnabled(false)
        if observed?.theme_id == theme.theme_id { send(.inspect) }
        else { statusLabel.stringValue = transportFailure ?? "Aucun état reçu. Provider absent ou publication inaccessible : vérifier le diagnostic avant de changer le fond." }
    }
    func send(_ action: ThemeAction) {
        guard pending == nil, let mailbox, let observed, observed.theme_id == theme.theme_id else { return }
        let command = Command(theme: theme.theme_id, instance: observed.instance,
            generation: observed.generation, action: action)
        pending = command; setEnabled(false); statusLabel.stringValue = "En attente du provider…"
        do { try mailbox.write(command) }
        catch { pending = nil; statusLabel.stringValue = "Échec du transport. Aucun succès confirmé."; return }
        timeout?.cancel()
        timeout = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(6)) } catch { return }
            guard let self, self.pending?.command_id == command.command_id else { return }
            receive()
            if pending != nil { pending = nil; setEnabled(false); statusLabel.stringValue = "Provider sans réponse. État inconnu — vérifier la connexion." }
        }
    }
    func receive() {
        guard let result = try? mailbox?.status()?.theme(theme.theme_id) else { return }
        observed = result
        guard let pending else {
            // A status publication alone does not prove current liveness.
            refreshAndProbe(); return
        }
        guard let receipt = result.receipt, receipt.command == pending else { return }
        self.pending = nil; timeout?.cancel()
        guard receipt.status == .applied, result.instance == pending.scene_instance_id else {
            setEnabled(false); statusLabel.stringValue = "Requête refusée : vérifier la connexion."; return
        }
        pauseButton.title = result.state.paused ? "Reprendre" : "Suspendre"
        effectButton.title = result.state.highlighted ? "Atténuer" : "Accentuer"
        setEnabled(result.surfaces > 0)
        statusLabel.stringValue = "Confirmé par le provider · \(result.surfaces) surface(s) · révision \(result.generation)"
    }
    func setEnabled(_ enabled: Bool) {
        pauseButton?.isEnabled = enabled && theme.motion_path != "still"
        effectButton?.isEnabled = enabled
    }
}
