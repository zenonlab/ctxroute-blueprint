import AppKit
import Foundation
import os

@main @MainActor enum ConnectorMain {
    static func main() throws {
        if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--activate-theme" {
            let themeID = CommandLine.arguments[2]
            guard NativeWire.validID(themeID),
                  try AgentLauncher.start(app: ProductIdentity.appBundle, service: ProductIdentity.service) else {
                exit(2)
            }
            let agent = ProductIdentity.appBundle.appendingPathComponent(
                "Contents/Library/LoginItems/Orbite Wallpaper Agent.app")
            guard let response = AgentClient.perform(
                    ProviderRequest(action: .activate, themeID: themeID), agentBundle: agent) else {
                print("activation=refused reason=agent-unavailable")
                exit(3)
            }
            guard response.accepted else {
                let reason = response.message ?? "agent-rejected"
                print("activation=refused reason=\(reason)")
                exit(3)
            }
            print("activation=accepted theme=\(themeID)")
            return
        }
        if CommandLine.arguments == [CommandLine.arguments[0], "--provider-catalog"] {
            guard try AgentLauncher.start(app: ProductIdentity.appBundle, service: ProductIdentity.service) else {
                exit(2)
            }
            let agent = ProductIdentity.appBundle.appendingPathComponent(
                "Contents/Library/LoginItems/Orbite Wallpaper Agent.app")
            guard let response = AgentClient.perform(ProviderRequest(action: .catalog), agentBundle: agent),
                  response.accepted, let catalog = response.catalog else { exit(3) }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            let receipt = catalog.map {
                ProviderCatalogDiagnostic(id: $0.id, displayName: $0.displayName,
                    hasCover: $0.coverURL != nil, coverPath: $0.coverURL?.path)
            }
            FileHandle.standardOutput.write(try encoder.encode(receipt))
            FileHandle.standardOutput.write(Data("\n".utf8))
            return
        }
        if CommandLine.arguments.count >= 3, CommandLine.arguments[1] == "--discover-themes" {
            let roots = CommandLine.arguments.dropFirst(2).map { URL(fileURLWithPath: $0, isDirectory: true) }
            let receipt = ThemeDiscovery.discover(roots: roots)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            FileHandle.standardOutput.write(try encoder.encode(receipt))
            FileHandle.standardOutput.write(Data("\n".utf8))
            if receipt.themes.isEmpty { exit(3) }
            return
        }
        if CommandLine.arguments == [CommandLine.arguments[0], "--check"] {
            let app = ProductIdentity.appBundle
            let agent = app.appendingPathComponent(
                "Contents/Library/LoginItems/Orbite Wallpaper Agent.app/Contents/MacOS/WallpaperConnector")
            let provider = app.appendingPathComponent(
                "Contents/Extensions/WallpaperProvider.appex/Contents/MacOS/WallpaperProvider")
            guard FileManager.default.isExecutableFile(atPath: agent.path),
                  FileManager.default.isExecutableFile(atPath: provider.path)
            else { throw ModelError.invalid("external-only package invariant") }
            print("themes=external-only provider=dynamic renderhost=capability-selected")
            return
        }
        if CommandLine.arguments.contains("--preflight-install") {
            do { try Preflight.check(installing: true); print("preflight=passed") }
            catch { print(error.localizedDescription); exit(2) }
            return
        }
        if !CommandLine.arguments.contains("--agent") {
            guard try AgentLauncher.start(app: ProductIdentity.appBundle, service: ProductIdentity.service) else {
                print("Agent absent ou configuration refusée : exécuter start-agent.sh sur le paquet installé.")
                exit(2)
            }
            let agent = ProductIdentity.appBundle.appendingPathComponent(
                "Contents/Library/LoginItems/Orbite Wallpaper Agent.app")
            guard AgentClient.show(agentBundle: agent) else {
                print("Agent démarré, mais son interface ne répond pas.")
                exit(2)
            }
            return
        }
        guard Bundle.main.bundleIdentifier == ProductIdentity.agentBundleID else {
            print("Utiliser l’agent embarqué enregistré, pas le lanceur en mode agent.")
            exit(2)
        }
        guard ProcessInfo.processInfo.environment["XPC_SERVICE_NAME"] == ProductIdentity.service ||
                CommandLine.arguments.contains("--smoke") else {
            print("Lancer le connecteur via start-agent.sh, pas directement depuis un terminal.")
            exit(2)
        }
        let app = NSApplication.shared
        let diagnostics = CommandLine.arguments.contains("--diagnostics") || CommandLine.arguments.contains("--smoke")
        app.setActivationPolicy(diagnostics ? .regular : .accessory)
        do { try Preflight.check(installing: false) }
        catch {
            guard diagnostics else { print("Lancement refusé : \(error.localizedDescription)"); return }
            let alert = NSAlert(); alert.messageText = "Lancement refusé"; alert.informativeText = error.localizedDescription
            alert.runModal(); return
        }
        let delegate = ConnectorApp(); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor final class ConnectorApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let themePicker = NSPopUpButton()
    private let statusLabel = NSTextField(wrappingLabelWithString: "Recherche des packages de thèmes…")
    private let desktopItems = DesktopItems()
    private let renderHost = RenderHostController()
    private let themeControls = ThemeControlsView()
    private let customization = VehicleCustomizationPanel()
    private let desktopInput = RenderHostDesktopInput()
    private let interfaceStore = ThemeInterfaceOverrideStore(directory: FileManager.default.urls(
        for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Orbite/ThemeOverrides", isDirectory: true))
    private var terminalSessions = TerminalSessionSimulator()
    private var themes: [DiscoveredTheme] = []
    private var window: NSWindow!
    private var statusItem: NSStatusItem?
    private var desktopItemsMenuItem: NSMenuItem?
    private var agentTransport: AgentTransport?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Logger(subsystem: ProductIdentity.logSubsystem, category: "agent")
            .notice("Startup catalog=external-only provider=dynamic")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 520),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = ProductIdentity.appName
        window.isReleasedWhenClosed = false
        renderHost.onTermination = { [weak self] status in
            guard let self else { return }
            self.desktopInput.update(snapshot: nil, desktopItemsVisible: nil)
            self.statusLabel.stringValue = "RenderHost terminé (code (status)). Réactivez le thème pour reprendre."
        }

        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 16
        stack.edgeInsets = NSEdgeInsets(top: 28, left: 28, bottom: 28, right: 28)
        let title = NSTextField(labelWithString: ProductIdentity.appName)
        title.font = .systemFont(ofSize: 26, weight: .semibold)
        let subtitle = NSTextField(wrappingLabelWithString:
            "Les thèmes viennent uniquement de vos packages locaux. Aucun thème de démonstration n’est embarqué.")
        subtitle.textColor = .secondaryLabelColor
        stack.addArrangedSubview(title); stack.addArrangedSubview(subtitle)
        stack.addArrangedSubview(NSTextField(labelWithString: "Thèmes détectés"))
        themePicker.target = self
        themePicker.action = #selector(themeSelectionChanged)
        stack.addArrangedSubview(themePicker)
        themeControls.onAudioVolume = { [weak self] value in self?.setThemeAudioVolume(value) }
        themeControls.onDesktop = { [weak self] in self?.toggleDesktopItems() }
        themeControls.onBrightness = { [weak self] value in self?.setThemeBrightness(value) }
        themeControls.onVisualPause = { [weak self] in self?.toggleVisualPause() }
        stack.addArrangedSubview(themeControls)
        statusLabel.textColor = .secondaryLabelColor; stack.addArrangedSubview(statusLabel)

        let libraries = NSStackView(); libraries.orientation = .horizontal; libraries.spacing = 12
        libraries.addArrangedSubview(NSButton(title: "Ajouter une bibliothèque…", target: self, action: #selector(addLibrary)))
        libraries.addArrangedSubview(NSButton(title: "Révéler la recette", target: self, action: #selector(revealRecipe)))
        stack.addArrangedSubview(libraries)

        let runtime = NSStackView(); runtime.orientation = .horizontal; runtime.spacing = 12
        runtime.addArrangedSubview(NSButton(title: "Choisir le RenderHost…", target: self, action: #selector(chooseRenderHost)))
        runtime.addArrangedSubview(NSButton(title: "Activer sur le bureau", target: self, action: #selector(activateTheme)))
        runtime.addArrangedSubview(NSButton(title: "Arrêter", target: self, action: #selector(stopTheme)))
        stack.addArrangedSubview(runtime)
        stack.addArrangedSubview(NSButton(title: "Personnaliser les véhicules…", target: self,
                                          action: #selector(customizeVehicles)))
        stack.addArrangedSubview(NSButton(title: "Activer les clics du wallpaper…", target: self,
                                          action: #selector(enableWallpaperInput)))
        stack.addArrangedSubview(NSButton(title: "Ouvrir Réglages Fond d’écran…", target: self,
                                          action: #selector(openWallpaperSettings)))
        stack.addArrangedSubview(NSButton(title: "Afficher / masquer les fichiers du bureau", target: self,
                                          action: #selector(toggleDesktopItems)))
        window.contentView = stack; window.center()

        let menu = NSMenu(); let root = NSMenuItem(); menu.addItem(root)
        let submenu = NSMenu(); submenu.addItem(withTitle: "Quitter", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        root.submenu = submenu; NSApp.mainMenu = menu
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "Orbite"
        let statusMenu = NSMenu(); statusMenu.delegate = self
        let open = statusMenu.addItem(withTitle: "Ouvrir Orbite Wallpaper…", action: #selector(showWindow), keyEquivalent: "")
        open.target = self
        desktopItemsMenuItem = statusMenu.addItem(withTitle: "Afficher / masquer les fichiers du bureau",
            action: #selector(toggleDesktopItems), keyEquivalent: "")
        desktopItemsMenuItem?.target = self
        let stop = statusMenu.addItem(withTitle: "Arrêter le thème", action: #selector(stopTheme), keyEquivalent: "")
        stop.target = self
        statusMenu.addItem(.separator())
        statusMenu.addItem(withTitle: "Quitter Orbite Wallpaper", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        statusItem?.menu = statusMenu

        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification,
            object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.refresh() } }
        agentTransport = AgentTransport { [weak self] request in
            self?.handle(request) ?? ProviderResponse(accepted: false, message: "Agent unavailable")
        }
        customization.onSave = { [weak self] overrides in self?.saveInterfaceOverrides(overrides) }
        customization.onReset = { [weak self] in self?.resetInterfaceOverrides() }
        customization.onPreview = { [weak self] overrides in self?.previewInterfaceOverrides(overrides) }
        customization.onCancelPreview = { [weak self] in self?.restorePersistedInterfaceOverrides() }
        customization.onSessionIntent = { [weak self] intent in
            self?.performSessionIntent(intent) ?? "Simulateur de sessions indisponible."
        }
        renderHost.onHitSnapshot = { [weak self] snapshot in
            guard let self else { return }
            self.desktopInput.update(snapshot: snapshot, desktopItemsVisible: try? self.desktopItems.isVisible())
        }
        desktopInput.onAction = { [weak self] action in self?.handleDesktopAction(action) }
        desktopInput.onStatus = { [weak self] state, trusted in
            guard let self, state == .permissionMissing || state == .creationFailed || state == .disabled else { return }
            self.statusLabel.stringValue = trusted
                ? "Entrée wallpaper indisponible (\(state.rawValue))."
                : "Autorisez Orbite Wallpaper Agent dans Accessibilité."
        }
        desktopInput.startIfAuthorized()
        refresh()
        if !desktopInput.installed {
            statusLabel.stringValue = "Autorisez Orbite Wallpaper Agent dans Accessibilité."
        }
        if CommandLine.arguments.contains("--diagnostics") || CommandLine.arguments.contains("--smoke") { showWindow() }
        if let index = CommandLine.arguments.firstIndex(of: "--smoke"),
           CommandLine.arguments.indices.contains(index + 1) {
            captureSmoke(destination: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
        }
    }

    private var selectedTheme: DiscoveredTheme? {
        let index = themePicker.indexOfSelectedItem
        return themes.indices.contains(index) ? themes[index] : nil
    }

    private func refresh() {
        let roots = ThemeLibraries.roots()
        let receipt = ThemeDiscovery.discover(roots: roots)
        let selectedID = selectedTheme?.package.id
        themes = receipt.themes
        themePicker.removeAllItems(); themePicker.addItems(withTitles: themes.map(\.package.display_name))
        if let selectedID, let index = themes.firstIndex(where: { $0.package.id == selectedID }) {
            themePicker.selectItem(at: index)
        }
        themePicker.isEnabled = !themes.isEmpty
        statusLabel.stringValue = themes.isEmpty
            ? "Aucun package valide dans \(roots.count) bibliothèque(s)."
            : "\(themes.count) thème(s) détecté(s), \(receipt.rejected.count) refusé(s)."
        configureThemeControls()
    }

    private func configureThemeControls() {
        let interface = selectedTheme?.interface
        themeControls.setSkin(interface)
        if let image = interface?.asset(for: "customizer.panel").flatMap(NSImage.init(contentsOf:)) {
            image.size = NSSize(width: 18, height: 18)
            image.isTemplate = false
            statusItem?.button?.image = image
            statusItem?.button?.title = ""
            statusItem?.button?.setAccessibilityLabel(ProductIdentity.appName)
        } else {
            statusItem?.button?.image = nil
            statusItem?.button?.title = "Orbite"
        }
        guard let id = selectedTheme?.package.id else { return }
        themeControls.setAudioVolume(themeAudioVolume(id: id))
        themeControls.setDesktopVisible(try? desktopItems.isVisible(), interface: interface)
        themeControls.setBrightness(UserDefaults.standard.object(forKey: "ThemeBrightness.\(id)") as? Double ?? 0.8)
        themeControls.setVisualPaused(UserDefaults.standard.object(forKey: "ThemeVisualPaused.\(id)") as? Bool ?? false,
                                      interface: interface)
    }

    @objc private func themeSelectionChanged() { configureThemeControls() }

    private func themeAudioVolume(id: String) -> Double {
        let key = "ThemeAudioVolume.\(id)"
        if let value = UserDefaults.standard.object(forKey: key) as? Double {
            return min(1, max(0, value))
        }
        let legacyMuted = UserDefaults.standard.object(forKey: "ThemeMuted.\(id)") as? Bool
        return legacyMuted == true ? 0 : 0.8
    }

    private func setThemeAudioVolume(_ value: Double) {
        guard let theme = selectedTheme else { return }
        let bounded = min(1, max(0, value))
        UserDefaults.standard.set(bounded, forKey: "ThemeAudioVolume.\(theme.package.id)")
        themeControls.setAudioVolume(bounded)
        try? pushRuntimeControls(for: theme)
        statusLabel.stringValue = "Volume du thème : \(Int((bounded * 100).rounded())) %."
    }

    private func setThemeBrightness(_ value: Double) {
        guard let id = selectedTheme?.package.id else { return }
        UserDefaults.standard.set(min(1, max(0, value)), forKey: "ThemeBrightness.\(id)")
        if let theme = selectedTheme { try? pushRuntimeControls(for: theme) }
        statusLabel.stringValue = "Luminosité du thème : \(Int((value * 100).rounded())) %."
    }

    @objc private func customizeVehicles() {
        presentCustomization(targetID: nil)
    }

    private func presentCustomization(targetID: String?) {
        guard let theme = selectedTheme, let interface = theme.interface else {
            statusLabel.stringValue = "Ce package ne fournit pas de catalogue UI privé."
            return
        }
        do {
            let overrides = try interfaceStore.load(themeID: theme.package.id,
                                                    interface: interface.manifest)
            customization.present(themeID: theme.package.id, interface: interface,
                overrides: overrides, sessions: terminalSessions.catalog, targetID: targetID)
        } catch { statusLabel.stringValue = "Personnalisation refusée : \(error.localizedDescription)" }
    }

    @objc private func enableWallpaperInput() {
        desktopInput.requestPermissionAndStart()
        statusLabel.stringValue = "Clics du wallpaper activés si Accessibilité est autorisée."
    }

    private func handleDesktopAction(_ action: RenderHostDesktopAction) {
        switch action {
        case .audioVolume(let value):
            setThemeAudioVolume(value)
        case .desktopFiles:
            toggleDesktopItems()
        case .visualPause:
            toggleVisualPause()
        case .brightness(let value):
            themeControls.setBrightness(value)
            setThemeBrightness(value)
        case .target(let id, let context):
            if context {
                presentCustomization(targetID: id)
            } else {
                focusSession(for: id)
            }
        }
    }

    private func focusSession(for targetID: String) {
        guard let theme = selectedTheme, let interface = theme.interface,
              let target = interface.manifest.targets.first(where: { $0.id == targetID }) else { return }
        let overrides = try? interfaceStore.load(themeID: theme.package.id, interface: interface.manifest)
        guard let sessionID = overrides?.targets[targetID]?.session_id ?? target.session_id else {
            statusLabel.stringValue = "Aucune session liée à \(target.label)."
            return
        }
        statusLabel.stringValue = performSessionIntent(
            TerminalSessionIntent(sessionID: sessionID, kind: .focus))
    }

    private func performSessionIntent(_ intent: TerminalSessionIntent) -> String {
        let accepted = terminalSessions.accept(intent)
        let action = intent.kind == .focus ? "Focalisation" : "Ouverture"
        let message = accepted
            ? "\(action) de \(intent.session_id) transmise au simulateur."
            : "\(action) refusée : session indisponible ou intention déjà traitée."
        statusLabel.stringValue = message
        return message
    }

    private func saveInterfaceOverrides(_ overrides: ThemeInterfaceOverrides) {
        guard let interface = selectedTheme?.interface else { return }
        do {
            try interfaceStore.save(overrides, interface: interface.manifest)
            if let theme = selectedTheme { try pushRuntimeControls(for: theme) }
            statusLabel.stringValue = "Apparence et session enregistrées sans changer l’identité de la cible."
        } catch { statusLabel.stringValue = "Enregistrement refusé : \(error.localizedDescription)" }
    }

    private func previewInterfaceOverrides(_ overrides: ThemeInterfaceOverrides) -> String? {
        guard let theme = selectedTheme, let interface = theme.interface else {
            return "Aucun thème actif à prévisualiser."
        }
        do {
            let checked = try overrides.validated(for: theme.package.id, interface: interface.manifest)
            try sendRuntimeControls(for: theme, overrides: checked)
            return nil
        } catch {
            return "Aperçu indisponible : \(error.localizedDescription)"
        }
    }

    private func restorePersistedInterfaceOverrides() {
        guard let theme = selectedTheme else { return }
        try? pushRuntimeControls(for: theme)
    }

    private func resetInterfaceOverrides() {
        guard let theme = selectedTheme, let interface = theme.interface else { return }
        do {
            try interfaceStore.reset(themeID: theme.package.id, interface: interface.manifest)
            try pushRuntimeControls(for: theme)
            statusLabel.stringValue = "Personnalisation réinitialisée aux valeurs du thème."
        } catch { statusLabel.stringValue = "Réinitialisation refusée : \(error.localizedDescription)" }
    }

    private func handle(_ request: ProviderRequest) -> ProviderResponse {
        switch request.action {
        case .catalog:
            refresh()
            let items = themes.prefix(64).map {
                ProviderCatalogItem(id: $0.package.id, displayName: $0.package.display_name,
                    coverURL: ProviderCover.externalURL(from: $0.thumbnail))
            }
            return ProviderResponse(accepted: true, catalog: items)
        case .activate:
            refresh()
            guard let id = request.themeID,
                  let theme = themes.first(where: { $0.package.id == id }) else {
                return ProviderResponse(accepted: false, message: "Unknown external theme")
            }
            do {
                _ = try renderHost.activate(RenderHostLaunchRequest.desktop(theme: theme))
                try pushRuntimeControls(for: theme)
                statusLabel.stringValue = "\(theme.package.display_name) actif depuis Réglages."
                return ProviderResponse(accepted: true)
            } catch {
                statusLabel.stringValue = "Activation depuis Réglages refusée : \(error.localizedDescription)"
                return ProviderResponse(accepted: false, message: error.localizedDescription)
            }
        case .show:
            showWindow()
            return ProviderResponse(accepted: true)
        }
    }

    @objc private func addLibrary() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.allowsMultipleSelection = false; panel.prompt = "Ajouter"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try ThemeLibraries.add(url); refresh() }
        catch { statusLabel.stringValue = "Bibliothèque refusée : \(error.localizedDescription)" }
    }

    @objc private func revealRecipe() {
        guard let theme = selectedTheme else { return }
        NSWorkspace.shared.activateFileViewerSelecting([theme.entry])
    }

    @objc private func chooseRenderHost() {
        guard let theme = selectedTheme else { statusLabel.stringValue = "Sélectionnez d’abord un thème."; return }
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.canChooseFiles = true
        panel.allowsMultipleSelection = false; panel.prompt = "Approuver"
        guard panel.runModal() == .OK, let executable = panel.url else { return }
        do {
            try RenderHostRegistry.register(renderer: theme.package.renderer, executable: executable)
            statusLabel.stringValue = "RenderHost approuvé pour \(theme.package.renderer)."
        } catch { statusLabel.stringValue = "RenderHost refusé : \(error.localizedDescription)" }
    }

    @objc private func activateTheme() {
        guard let theme = selectedTheme else { statusLabel.stringValue = "Aucun thème détecté."; return }
        do {
            let launched = try renderHost.activate(RenderHostLaunchRequest.desktop(theme: theme))
            try pushRuntimeControls(for: theme)
            statusLabel.stringValue = launched ? "\(theme.package.display_name) actif sur le bureau."
                : "\(theme.package.display_name) est déjà actif."
        } catch { statusLabel.stringValue = "Activation refusée : \(error.localizedDescription)" }
    }

    @objc private func stopTheme() {
        renderHost.stop()
        desktopInput.update(snapshot: nil, desktopItemsVisible: nil)
        statusLabel.stringValue = "RenderHost arrêté."
    }

    private func pushRuntimeControls(for theme: DiscoveredTheme) throws {
        let overrides = try theme.interface.map {
            try interfaceStore.load(themeID: theme.package.id, interface: $0.manifest)
        }
        try sendRuntimeControls(for: theme, overrides: overrides)
    }

    private func sendRuntimeControls(for theme: DiscoveredTheme,
                                     overrides: ThemeInterfaceOverrides?) throws {
        guard renderHost.themeID == theme.package.id else { return }
        let audioVolume = themeAudioVolume(id: theme.package.id)
        let brightness = UserDefaults.standard.object(forKey: "ThemeBrightness.\(theme.package.id)") as? Double ?? 0.8
        let visualPaused = UserDefaults.standard.object(forKey: "ThemeVisualPaused.\(theme.package.id)") as? Bool ?? false
        try renderHost.update(audioVolume: audioVolume, desktopItemsVisible: try? desktopItems.isVisible(),
                              brightness: brightness, visualPaused: visualPaused, overrides: overrides)
        desktopInput.setVisualPaused(visualPaused)
    }
    @objc private func openWallpaperSettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.Wallpaper-Settings.extension") else { return }
        NSWorkspace.shared.open(url)
    }
    @objc private func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); refresh() }

    func menuWillOpen(_ menu: NSMenu) {
        desktopItemsMenuItem?.title = (try? desktopItems.isVisible()) == false
            ? "Afficher les fichiers du bureau" : "Masquer les fichiers du bureau"
    }

    @objc private func toggleDesktopItems() {
        do {
            let visible = try desktopItems.toggle()
            themeControls.setDesktopVisible(visible, interface: selectedTheme?.interface)
            if let theme = selectedTheme { try? pushRuntimeControls(for: theme) }
            statusLabel.stringValue = visible ? "Fichiers du bureau affichés." : "Fichiers du bureau masqués."
        } catch { statusLabel.stringValue = "Réglage Finder non confirmé ; aucun fichier n’a été supprimé." }
    }

    private func toggleVisualPause() {
        guard let theme = selectedTheme else { return }
        let key = "ThemeVisualPaused.\(theme.package.id)"
        let paused = !(UserDefaults.standard.object(forKey: key) as? Bool ?? false)
        UserDefaults.standard.set(paused, forKey: key)
        themeControls.setVisualPaused(paused, interface: theme.interface)
        try? pushRuntimeControls(for: theme)
        statusLabel.stringValue = paused ? "Visuel en pause." : "Visuel repris."
    }

    private func captureSmoke(destination: URL) {
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1))
            guard let view = window.contentView, let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
                print("smoke=failed: view unavailable"); NSApp.terminate(nil); return
            }
            view.cacheDisplay(in: view.bounds, to: bitmap)
            do {
                guard let png = bitmap.representation(using: .png, properties: [:]) else {
                    throw ModelError.invalid("PNG")
                }
                try png.write(to: destination, options: .atomic)
                print("smoke=passed themes=\(themes.count) provider=dynamic")
            } catch { print("smoke=failed: capture") }
            NSApp.terminate(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        renderHost.stop()
        desktopInput.stop()
        return .terminateNow
    }
}

private struct ProviderCatalogDiagnostic: Encodable {
    let id: String
    let displayName: String
    let hasCover: Bool
    let coverPath: String?
}
