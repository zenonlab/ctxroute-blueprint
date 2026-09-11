import AppKit

@MainActor final class VehicleCustomizationPanel: NSObject, NSWindowDelegate {
    private var panel: NSPanel?
    private var themeID = ""
    private var interface: ResolvedThemeInterface?
    private var overrides: ThemeInterfaceOverrides?
    private var sessions: [TerminalSessionSnapshot] = []
    private let target = NSPopUpButton()
    private let character = NSPopUpButton()
    private let vehicle = NSPopUpButton()
    private let session = NSPopUpButton()
    private let preview = NSImageView()
    private let error = NSTextField(wrappingLabelWithString: "")
    var onSave: ((ThemeInterfaceOverrides) -> Void)?
    var onReset: (() -> Void)?

    func present(themeID: String, interface: ResolvedThemeInterface,
                 overrides: ThemeInterfaceOverrides, sessions: [TerminalSessionSnapshot],
                 targetID: String? = nil) {
        if panel?.isVisible == true, self.themeID == themeID {
            if let targetID { select(target, id: targetID); targetChanged() }
            panel?.makeKeyAndOrderFront(nil)
            return
        }
        panel?.close()
        panel = nil
        self.themeID = themeID
        self.interface = interface
        self.overrides = overrides
        self.sessions = sessions
        fill(target, entries: interface.manifest.targets.map { ($0.id, $0.label, nil) })
        fill(character, entries: choices(.character, in: interface))
        fill(vehicle, entries: choices(.vehicle, in: interface))
        fill(session, entries: [("", "Aucune session", nil)] + sessions.map {
            ($0.id, "\($0.display_name) — \($0.state.rawValue)", nil)
        })
        if let targetID { select(target, id: targetID) }
        target.target = self
        target.action = #selector(targetChanged)
        character.target = self
        character.action = #selector(choiceChanged)
        vehicle.target = self
        vehicle.action = #selector(choiceChanged)
        preview.imageScaling = .scaleProportionallyUpOrDown
        preview.widthAnchor.constraint(equalToConstant: 320).isActive = true
        preview.heightAnchor.constraint(equalToConstant: 130).isActive = true
        [target, character, vehicle, session].forEach {
            $0.widthAnchor.constraint(equalToConstant: 320).isActive = true
        }
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.edgeInsets = .init(top: 20, left: 24, bottom: 20, right: 24)
        stack.addArrangedSubview(preview)
        for (title, control) in [("Véhicule dans la scène", target), ("Personnage", character),
                                 ("Kart", vehicle), ("Session terminal", session)] {
            stack.addArrangedSubview(NSTextField(labelWithString: title))
            stack.addArrangedSubview(control)
        }
        error.textColor = .systemRed
        stack.addArrangedSubview(error)
        let cancel = NSButton(title: "Annuler", target: self, action: #selector(close))
        let reset = NSButton(title: "Réinitialiser", target: self, action: #selector(reset))
        let save = NSButton(title: "Enregistrer", target: self, action: #selector(submit))
        save.keyEquivalent = "\r"
        stack.addArrangedSubview(NSStackView(views: [cancel, reset, save]))
        let window = NSPanel(contentRect: .init(x: 0, y: 0, width: 368, height: 530),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Personnaliser le véhicule"
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.collectionBehavior.insert(.moveToActiveSpace)
        window.contentView = stack
        panel = window
        targetChanged()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func choices(_ kind: ThemeInterfaceManifest.Choice.Kind,
                         in interface: ResolvedThemeInterface) -> [(String, String, NSImage?)] {
        [("", "Valeur du thème", nil)] + interface.manifest.choices.filter { $0.kind == kind }.map {
            ($0.id, $0.label, interface.assets[$0.preview].flatMap(NSImage.init(contentsOf:)))
        }
    }

    private func fill(_ popup: NSPopUpButton, entries: [(String, String, NSImage?)]) {
        popup.removeAllItems()
        for (id, label, image) in entries {
            popup.addItem(withTitle: label)
            popup.lastItem?.representedObject = id
            popup.lastItem?.image = image
        }
    }

    private func select(_ popup: NSPopUpButton, id: String?) {
        guard let id, let item = popup.itemArray.first(where: { $0.representedObject as? String == id }) else {
            popup.selectItem(at: 0)
            return
        }
        popup.select(item)
    }

    @objc private func targetChanged() {
        guard let interface, let overrides, let id = selectedID(target) else { return }
        let embedded = interface.manifest.targets.first { $0.id == id }
        let value = overrides.targets[id]
        select(character, id: value?.character)
        select(vehicle, id: value?.vehicle)
        select(session, id: value?.session_id ?? embedded?.session_id)
        updatePreview()
    }

    @objc private func choiceChanged() { updatePreview() }
    private func updatePreview() {
        guard let interface else { return }
        let selected = selectedID(vehicle) ?? selectedID(character)
        preview.image = interface.manifest.choices.first { $0.id == selected }
            .flatMap { interface.assets[$0.preview] }.flatMap(NSImage.init(contentsOf:))
            ?? interface.asset(for: "customizer.panel").flatMap(NSImage.init(contentsOf:))
    }

    @objc private func submit() {
        guard var overrides, let id = selectedID(target) else { return }
        overrides.targets[id] = ThemeTargetOverride(character: selectedID(character),
            vehicle: selectedID(vehicle), sessionID: selectedID(session))
        do {
            guard let interface else { return }
            self.overrides = try overrides.validated(for: themeID, interface: interface.manifest)
            onSave?(self.overrides!)
            close()
        } catch { self.error.stringValue = "Choix invalide : \(error.localizedDescription)" }
    }

    @objc private func reset() { onReset?(); close() }
    @objc private func close() { panel?.close(); panel = nil }
    func windowWillClose(_ notification: Notification) { panel = nil }
    private func selectedID(_ popup: NSPopUpButton) -> String? {
        guard let id = popup.selectedItem?.representedObject as? String, !id.isEmpty else { return nil }
        return id
    }
}
