import AppKit
import Foundation
import os

@main @MainActor enum ConnectorMain {
    static func main() throws {
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
            let extensions = app.appendingPathComponent("Contents/Extensions")
            guard FileManager.default.isExecutableFile(atPath: agent.path),
                  !FileManager.default.fileExists(atPath: extensions.path)
            else { throw ModelError.invalid("external-only package invariant") }
            print("themes=external-only provider=absent renderhost=capability-selected")
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
    private var themes: [DiscoveredTheme] = []
    private var window: NSWindow!
    private var statusItem: NSStatusItem?
    private var desktopItemsMenuItem: NSMenuItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Logger(subsystem: ProductIdentity.logSubsystem, category: "agent")
            .notice("Startup catalog=external-only provider=absent")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 430),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = ProductIdentity.appName
        window.isReleasedWhenClosed = false

        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 16
        stack.edgeInsets = NSEdgeInsets(top: 28, left: 28, bottom: 28, right: 28)
        let title = NSTextField(labelWithString: ProductIdentity.appName)
        title.font = .systemFont(ofSize: 26, weight: .semibold)
        let subtitle = NSTextField(wrappingLabelWithString:
            "Les thèmes viennent uniquement de vos packages locaux. Aucun thème de démonstration n’est embarqué.")
        subtitle.textColor = .secondaryLabelColor
        stack.addArrangedSubview(title); stack.addArrangedSubview(subtitle)
        stack.addArrangedSubview(NSTextField(labelWithString: "Thèmes détectés"))
        stack.addArrangedSubview(themePicker)
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
        stack.addArrangedSubview(NSButton(title: "Afficher / masquer les fichiers du bureau", target: self,
                                          action: #selector(toggleDesktopItems)))
        window.contentView = stack; window.center()

        let menu = NSMenu(); let root = NSMenuItem(); menu.addItem(root)
        let submenu = NSMenu(); submenu.addItem(withTitle: "Quitter", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        root.submenu = submenu; NSApp.mainMenu = menu
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.image = NSImage(systemSymbolName: "circle.hexagongrid", accessibilityDescription: "Orbite")
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
        refresh()
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
            statusLabel.stringValue = launched ? "\(theme.package.display_name) actif sur le bureau."
                : "\(theme.package.display_name) est déjà actif."
        } catch { statusLabel.stringValue = "Activation refusée : \(error.localizedDescription)" }
    }

    @objc private func stopTheme() { renderHost.stop(); statusLabel.stringValue = "RenderHost arrêté." }
    @objc private func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); refresh() }

    func menuWillOpen(_ menu: NSMenu) {
        desktopItemsMenuItem?.title = (try? desktopItems.isVisible()) == false
            ? "Afficher les fichiers du bureau" : "Masquer les fichiers du bureau"
    }

    @objc private func toggleDesktopItems() {
        do {
            let visible = try desktopItems.toggle()
            statusLabel.stringValue = visible ? "Fichiers du bureau affichés." : "Fichiers du bureau masqués."
        } catch { statusLabel.stringValue = "Réglage Finder non confirmé ; aucun fichier n’a été supprimé." }
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
                print("smoke=passed themes=\(themes.count) provider=absent")
            } catch { print("smoke=failed: capture") }
            NSApp.terminate(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        renderHost.stop()
        let stop = Process(); stop.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        stop.arguments = ["bootout", "gui/\(getuid())/\(ProductIdentity.service)"]; try? stop.run()
        return .terminateNow
    }
}
