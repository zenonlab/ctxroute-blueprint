import AppKit
import ImageIO
import UniformTypeIdentifiers
import os
import ApplicationServices

@main @MainActor enum ConnectorMain {
    static func main() throws {
        if CommandLine.arguments == [CommandLine.arguments[0], "--probe-visibility"] {
            let displays = NSScreen.screens.compactMap { screen -> CGRect? in
                guard let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value,
                      let area = DesktopVisibilityPolicy.desktopArea(displayID: id) else { return nil }
                return area
            }
            switch DesktopVisibilityPolicy.current(displays: displays) {
            case true: print("wallpaper-visibility=visible")
            case false: print("wallpaper-visibility=occluded")
            case nil: print("wallpaper-visibility=unknown")
            }
            return
        }
        if CommandLine.arguments == [CommandLine.arguments[0], "--check"] {
            _ = try Theme.catalog()
            let app = NativeWire.appBundle
            let agent = app.appendingPathComponent("Contents/Library/LoginItems/Wallpaper Connector Agent.app")
            let provider = app.appendingPathComponent("Contents/Extensions/WallpaperProvider.appex")
            _ = try NativeWire.requirement(for: app)
            let expected = try NativeWire.requirement(for: agent)
            _ = try NativeWire.requirement(for: provider)
            let pin = try String(contentsOf: provider.appendingPathComponent("Contents/Resources/agent-requirement.txt"),
                encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
            guard pin == expected else { throw ModelError.invalid("Packaged agent signature pin mismatch") }
            print("manifest=valid xpc-peers=valid provider=unconfirmed desktop-input=requires-native-qualification")
            return
        }
        if CommandLine.arguments.contains("--probe-mailbox") {
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
        if !CommandLine.arguments.contains("--agent") {
            guard try AgentLauncher.start(app: NativeWire.appBundle, service: NativeWire.service) else {
                print("Agent absent ou configuration refusée : exécuter start-agent.sh sur le paquet installé.")
                exit(2)
            }
            return
        }
        guard Bundle.main.bundleIdentifier == "org.wallpaperthemes.connectorpoc2.agent" else {
            print("Utiliser l’agent embarqué enregistré, pas le lanceur en mode agent."); exit(2)
        }
        let app = NSApplication.shared
        // launchd serializes this job. A LaunchServices activation may briefly register
        // the same bundle while kickstarting it; it is not another running agent.
        guard ProcessInfo.processInfo.environment["XPC_SERVICE_NAME"] == NativeWire.service ||
                CommandLine.arguments.contains("--smoke") else {
            print("Lancer le connecteur via start-agent.sh, pas directement depuis un terminal.")
            exit(2)
        }
        let diagnostics = CommandLine.arguments.contains("--diagnostics") || CommandLine.arguments.contains("--smoke")
        app.setActivationPolicy(diagnostics ? .regular : .accessory)
        do { try Preflight.check(installing: false) }
        catch {
            guard diagnostics else { print("Lancement refusé : \(error.localizedDescription)"); return }
            let alert = NSAlert(); alert.messageText = "Lancement refusé"
            alert.informativeText = error.localizedDescription
            alert.runModal(); return
        }
        let delegate = try ConnectorApp(themes: Theme.catalog()); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor final class ConnectorApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let themes: [Theme]
    var theme: Theme { themes[themePicker.indexOfSelectedItem >= 0 ? themePicker.indexOfSelectedItem : 0] }
    let themePicker = NSPopUpButton()
    let transport: AgentTransport
    var window: NSWindow!
    var statusItem: NSStatusItem?
    var observed: ProviderStatus?
    var pending: Command?
    var timeout: Task<Void, Never>?
    let editor = CustomizationModal()
    let input = DesktopInput()
    let visibility = DesktopVisibility()
    let desktopItems = DesktopItems()
    var desktopItemsMenuItem: NSMenuItem?
    let store = ThemeStore(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("org.wallpaperthemes.connectorpoc2/themes", isDirectory: true))
    var restoredInstances: Set<UUID> = []
    var confirmedInstances: Set<UUID> = []
    var completion: ((Bool) -> Void)?
    let statusLabel = NSTextField(wrappingLabelWithString: "Le provider doit être sélectionné dans les réglages Fond d’écran.")
    let inputStatusLabel = NSTextField(wrappingLabelWithString: "Entrée : diagnostic en attente.")
    var pauseButton: NSButton!
    var effectButton: NSButton!
    init(themes: [Theme]) {
        self.themes = themes
        transport = AgentTransport()
        super.init()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        Logger(subsystem: "org.wallpaperthemes.connectorpoc2", category: "agent").notice(
            "Startup diagnostics=\(CommandLine.arguments.contains("--diagnostics")) accessibility=\(AXIsProcessTrusted()) desktop-input=capability-gated")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 560),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Wallpaper Connector · PoC 2"
        window.isReleasedWhenClosed = false
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 18
        stack.edgeInsets = NSEdgeInsets(top: 28, left: 28, bottom: 28, right: 28)
        let title = NSTextField(labelWithString: "Wallpaper Connector"); title.font = .systemFont(ofSize: 26, weight: .semibold)
        let subtitle = NSTextField(wrappingLabelWithString: "Diagnostic du provider — ce panneau n’est pas l’interface du thème.")
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
        inputStatusLabel.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        inputStatusLabel.textColor = .secondaryLabelColor
        stack.addArrangedSubview(inputStatusLabel)
        let capabilities = NSTextField(wrappingLabelWithString:
            "Clic gauche : ouvrir l’application. Clic droit : personnaliser.\nEntrée : Finder qualifié s’il est visible ; zones natives derrière les apps s’il est masqué.\nAudio : fixtures silencieuses. Fichiers : affichage Finder réversible, jamais suppression.")
        capabilities.textColor = .secondaryLabelColor; stack.addArrangedSubview(capabilities)
        stack.addArrangedSubview(NSButton(title: "Choisir ce fond dans macOS…", target: self, action: #selector(wallpaperSettings)))
        stack.addArrangedSubview(NSButton(title: "Afficher / masquer les fichiers dans Réglages…", target: self, action: #selector(desktopSettings)))
        stack.addArrangedSubview(NSButton(title: "Vérifier la connexion", target: self, action: #selector(check)))
        window.contentView = stack; window.center()
        let menu = NSMenu(); let appMenu = NSMenuItem(); menu.addItem(appMenu)
        let submenu = NSMenu(); submenu.addItem(withTitle: "Quitter", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let customizeMenuItem = submenu.addItem(withTitle: "Personnaliser un objet…", action: #selector(editFirstObject), keyEquivalent: "e")
        customizeMenuItem.target = self
        let inputMenuItem = submenu.addItem(withTitle: "Activer les interactions…", action: #selector(interactionSettings), keyEquivalent: "i")
        inputMenuItem.target = self
        appMenu.submenu = submenu; NSApp.mainMenu = menu
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.image = NSImage(systemSymbolName: "circle.hexagongrid", accessibilityDescription: "Orbite — connecteur")
        statusItem?.button?.toolTip = "Orbite — diagnostic du connecteur"
        let statusMenu = NSMenu()
        let diagnosticItem = statusMenu.addItem(withTitle: "Diagnostic du connecteur…", action: #selector(check), keyEquivalent: "")
        diagnosticItem.target = self
        let interactionItem = statusMenu.addItem(withTitle: "Activer les interactions…", action: #selector(interactionSettings), keyEquivalent: "")
        interactionItem.target = self
        let editItem = statusMenu.addItem(withTitle: "Personnaliser un objet…", action: #selector(editFirstObject), keyEquivalent: "")
        editItem.target = self
        desktopItemsMenuItem = statusMenu.addItem(withTitle: "Afficher / masquer les fichiers du bureau", action: #selector(toggleDesktopItems), keyEquivalent: "")
        desktopItemsMenuItem?.target = self
        let restoreItem = statusMenu.addItem(withTitle: "Réafficher les fichiers du bureau", action: #selector(showDesktopItems), keyEquivalent: "")
        restoreItem.target = self
        statusMenu.delegate = self
        statusMenu.addItem(.separator())
        statusMenu.addItem(withTitle: "Quitter le connecteur", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        statusItem?.menu = statusMenu
        transport.onChange = { [weak self] in self?.receive() }
        input.onIntent = { [weak self] intent, theme, layout in self?.interact(intent, theme: theme, layout: layout) }
        input.onPointerActivity = { [weak self] in self?.visibility.pointerActivity() }
        input.onStatus = { [weak self] state, trusted in self?.showInputStatus(state, trusted: trusted) }
        visibility.onChange = { [weak self] in self?.synchronizeNextVisibility() }
        editor.onSave = { [weak self] configuration in
            guard let self else { return }
            send(.configure, configuration: configuration, target: configuration.theme_id) { [weak self] applied in
                guard let self else { return }
                guard applied else { editor.failed("Le décor n’a pas confirmé. Vérifiez la connexion puis réessayez."); return }
                do { try store.save(configuration); editor.confirmed() }
                catch { editor.failed("Décor mis à jour, mais sauvegarde locale impossible. Réessayez.") }
            }
        }
        input.install()
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.input.install(); self?.refreshAndProbe() }
        }
        refreshAndProbe()
        if CommandLine.arguments.contains("--diagnostics") || CommandLine.arguments.contains("--smoke") {
            check()
        }
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
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        input.stop()
        // Stop the job as well, otherwise the provider would wake the agent again.
        let stop = Process()
        stop.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        stop.arguments = ["bootout", "gui/\(getuid())/\(NativeWire.service)"]
        try? stop.run()
        return .terminateNow
    }
    @objc func wallpaperSettings() { open("x-apple.systempreferences:com.apple.Wallpaper-Settings.extension") }
    @objc func desktopSettings() { open("x-apple.systempreferences:com.apple.Desktop-Settings.extension") }
    func menuWillOpen(_ menu: NSMenu) {
        guard let visible = try? desktopItems.isVisible() else {
            desktopItemsMenuItem?.title = "Fichiers du bureau : réglage indisponible"
            return
        }
        desktopItemsMenuItem?.title = visible ? "Masquer les fichiers du bureau" : "Afficher les fichiers du bureau"
    }
    @objc func toggleDesktopItems() { changeDesktopItems(restore: false, target: nil) }
    @objc func showDesktopItems() { changeDesktopItems(restore: true, target: nil) }
    private func changeDesktopItems(restore: Bool, target: String?) {
        do {
            let visible = try restore ? desktopItems.setVisible(true) : desktopItems.toggle()
            statusLabel.stringValue = visible ? "Réglage enregistré : fichiers affichés." : "Réglage enregistré : fichiers masqués. Réaffichage disponible dans le menu Orbite."
            synchronizeDesktopItems(visible: visible, target: target ?? theme.theme_id)
        } catch {
            // Recovery is accessible without a wallpaper hit-test or a permission prompt.
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            statusLabel.stringValue = "Réglage non confirmé. Vérifiez Bureau et Dock (Stage Manager ou ancien masquage Finder)."
        }
    }
    @objc func interactionSettings() {
        input.requestPermission()
    }
    private func showInputStatus(_ state: DesktopTapState, trusted: Bool) {
        let permission = trusted ? "Accessibilité accordée" : "Accessibilité refusée"
        let runtime: String
        switch state {
        case .active: runtime = "tap \(input.tapLocation ?? "inconnu") actif"
        case .rearmed: runtime = "tap \(input.tapLocation ?? "inconnu") réarmé après interruption"
        case .permissionMissing: runtime = "tap non créé"
        case .creationFailed: runtime = "création du tap refusée"
        case .disabled: runtime = "tap désactivé par macOS"
        case .stopped: runtime = "tap arrêté"
        }
        inputStatusLabel.stringValue = "Entrée : \(permission) · \(runtime)"
        inputStatusLabel.textColor = state == .active || state == .rearmed ? .systemGreen : .systemOrange
    }
    @objc func editFirstObject() {
        guard let current = transport.status?.themes.first(where: { $0.surfaces > 0 })?.configuration,
              let object = current.objects.first else { return }
        editor.present(theme: current, objectID: object.id)
    }
    func interact(_ intent: InteractionIntent, theme: Theme, layout: SurfaceLayout) {
        // An open draft owns only editing, not the whole desktop action router.
        guard transport.status?.theme(theme.theme_id)?.configuration == theme else { return }
        switch intent {
        case .customize(let id): editor.present(theme: theme, objectID: id)
        case .add(let point): editor.present(theme: theme, objectID: nil, point: point, width: layout.width, height: layout.height)
        case .activate(let id):
            guard let object = theme.objects.first(where: { $0.id == id }),
                  let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: object.application_bundle_id ?? "com.apple.Terminal") else { return }
            NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        case .toggle(.audio):
            send(transport.status?.theme(theme.theme_id)?.state.muted == false ? .mute : .unmute, target: theme.theme_id)
        case .toggle(.desktopItems): changeDesktopItems(restore: false, target: theme.theme_id)
        }
    }
    private func open(_ value: String) {
        if let url = URL(string: value), !NSWorkspace.shared.open(url) { statusLabel.stringValue = "Impossible d’ouvrir les Réglages macOS." }
    }
    @objc func pause() { send(observed?.state.paused == true ? .resume : .pause) }
    @objc func effect() { send(observed?.state.highlighted == true ? .unhighlight : .highlight) }
    @objc func check() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refreshAndProbe()
        for layout in transport.status?.layouts ?? [] {
            Logger(subsystem: "org.wallpaperthemes.connectorpoc2", category: "agent").notice(
                "Layout display=\(layout.display_id ?? 0) size=\(layout.width)x\(layout.height) interactive=\(layout.interactive)")
        }
    }
    @objc func changeControlTheme() {
        guard pending == nil else { return }
        observed = nil; refreshAndProbe()
    }
    func refreshAndProbe() {
        guard pending == nil else { return }
        observed = transport.status?.theme(theme.theme_id)
        setEnabled(false)
        if observed?.theme_id == theme.theme_id { send(.inspect) }
        else { statusLabel.stringValue = "Provider XPC absent. Aucune commande confirmée." }
    }
    func send(_ action: ThemeAction, configuration: Theme? = nil, target: String? = nil, completion: ((Bool) -> Void)? = nil) {
        let id = target ?? theme.theme_id
        guard pending == nil, let observed = transport.status?.theme(id) else { completion?(false); return }
        let command = Command(theme: id, instance: observed.instance,
            generation: observed.generation, action: action, configuration: configuration)
        self.completion = completion
        pending = command; setEnabled(false); statusLabel.stringValue = "En attente du provider…"
        do { try transport.send(command) }
        catch { finish(false); statusLabel.stringValue = "Échec du transport. Aucun succès confirmé."; return }
        timeout?.cancel()
        timeout = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(6)) } catch { return }
            guard let self, self.pending?.command_id == command.command_id else { return }
            receive()
            if pending != nil { finish(false); setEnabled(false); statusLabel.stringValue = "Provider sans réponse. État inconnu — vérifier la connexion." }
        }
    }
    func receive() {
        visibility.update(transport.status)
        input.catalog = transport.status
        guard let result = transport.status?.theme(pending?.theme_id ?? theme.theme_id) else {
            observed = nil; finish(false); setEnabled(false)
            statusLabel.stringValue = "Provider XPC déconnecté. État inconnu."; return
        }
        observed = result
        guard let pending else {
            restoreNextTheme()
            if self.pending == nil { synchronizeNextDesktopItems() }
            if self.pending == nil { synchronizeNextVisibility() }
            if self.pending == nil && !confirmedInstances.contains(result.instance) && result.surfaces > 0 { send(.inspect, target: result.theme_id) }
            return
        }
        guard let receipt = result.receipt, receipt.command == pending else { return }
        guard receipt.status == .applied, result.instance == pending.scene_instance_id else {
            finish(false)
            setEnabled(false); statusLabel.stringValue = "Requête refusée : vérifier la connexion."; return
        }
        pauseButton.title = result.state.paused ? "Reprendre" : "Suspendre"
        effectButton.title = result.state.highlighted ? "Atténuer" : "Accentuer"
        setEnabled(result.surfaces > 0)
        if result.surfaces > 0 { confirmedInstances.insert(result.instance) }
        finish(true)
        statusLabel.stringValue = "Confirmé par le provider · \(result.surfaces) surface(s) · révision \(result.generation)"
        Logger(subsystem: "org.wallpaperthemes.connectorpoc2", category: "agent").notice(
            "XPC receipt confirmed action=\(pending.action.rawValue, privacy: .public) surfaces=\(result.surfaces) generation=\(result.generation)")
        restoreNextTheme()
        if self.pending == nil { synchronizeNextDesktopItems() }
        if self.pending == nil { synchronizeNextVisibility() }
    }
    func finish(_ applied: Bool) {
        pending = nil; timeout?.cancel(); themePicker.isEnabled = true
        let handler = completion; completion = nil; handler?(applied)
    }
    func restoreNextTheme() {
        guard pending == nil, let catalog = transport.status else { return }
        for state in catalog.themes where !restoredInstances.contains(state.instance) {
            restoredInstances.insert(state.instance)
            guard let base = themes.first(where: { $0.theme_id == state.theme_id }) else { continue }
            do {
                if let saved = try store.load(for: base), saved != state.configuration {
                    send(.configure, configuration: saved, target: state.theme_id); return
                }
            } catch { statusLabel.stringValue = "Personnalisation locale illisible : original conservé, fichier intact." }
        }
    }
    private func synchronizeDesktopItems(visible: Bool?, target: String) {
        guard pending == nil, let state = transport.status?.theme(target)?.state,
              state.desktopItemsVisible != visible else { return }
        let action: ThemeAction = visible.map { $0 ? .desktopItemsVisible : .desktopItemsHidden }
            ?? .desktopItemsUnknown
        send(action, target: target)
    }
    private func synchronizeNextDesktopItems() {
        let visible = try? desktopItems.isVisible()
        guard let target = transport.status?.themes.first(where: { $0.state.desktopItemsVisible != visible })?.theme_id else { return }
        synchronizeDesktopItems(visible: visible, target: target)
    }
    private func synchronizeNextVisibility() {
        guard pending == nil, let catalog = transport.status else { return }
        for state in catalog.themes where state.surfaces > 0 {
            guard let classification = visibility.classification(for: state.theme_id) else { continue }
            let visible = classification
            guard state.state.wallpaperVisible != visible else { continue }
            let action: ThemeAction = visible.map { $0 ? .wallpaperVisible : .wallpaperOccluded }
                ?? .wallpaperVisibilityUnknown
            send(action, target: state.theme_id)
            return
        }
    }
    func setEnabled(_ enabled: Bool) {
        themePicker.isEnabled = pending == nil
        pauseButton?.isEnabled = enabled && theme.motion_path != "still"
        effectButton?.isEnabled = enabled
    }
}
