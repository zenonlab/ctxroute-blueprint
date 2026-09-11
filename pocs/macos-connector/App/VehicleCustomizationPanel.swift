import AppKit

@MainActor private final class GameChoiceStrip: NSView {
    private let stack = NSStackView()
    private var buttons: [NSButton] = []
    private(set) var selectedID: String?
    var onChange: (() -> Void)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        stack.orientation = .horizontal
        stack.alignment = .top
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasHorizontalScroller = true
        scroll.documentView = stack
        addSubview(scroll)
        scroll.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentView.bottomAnchor),
            stack.heightAnchor.constraint(equalTo: scroll.contentView.heightAnchor)
        ])
    }

    required init?(coder: NSCoder) { nil }

    func configure(entries: [(String, String, NSImage?)], selected: String?) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        buttons = entries.map { id, label, image in
            let button = NSButton(title: label, target: self, action: #selector(chosen(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(id)
            button.image = image
            button.imagePosition = .imageAbove
            button.imageScaling = .scaleProportionallyDown
            button.bezelStyle = .regularSquare
            button.font = .systemFont(ofSize: 11, weight: .medium)
            button.lineBreakMode = .byTruncatingTail
            button.toolTip = label
            button.setAccessibilityLabel(label)
            button.widthAnchor.constraint(equalToConstant: 96).isActive = true
            button.heightAnchor.constraint(equalToConstant: 104).isActive = true
            stack.addArrangedSubview(button)
            return button
        }
        select(id: selected)
    }

    func select(id: String?) {
        selectedID = id
        for button in buttons {
            let active = button.identifier?.rawValue == (id ?? "")
            button.state = active ? .on : .off
            button.wantsLayer = true
            button.layer?.borderWidth = active ? 3 : 0
            button.layer?.borderColor = active ? NSColor.systemYellow.cgColor : nil
            button.layer?.cornerRadius = 8
        }
    }

    @objc private func chosen(_ sender: NSButton) {
        let value = sender.identifier?.rawValue ?? ""
        select(id: value.isEmpty ? nil : value)
        onChange?()
    }
}

@MainActor final class VehicleCustomizationPanel: NSObject, NSWindowDelegate {
    private var panel: NSPanel?
    private var themeID = ""
    private var interface: ResolvedThemeInterface?
    private var overrides: ThemeInterfaceOverrides?
    private var sessions: [TerminalSessionSnapshot] = []
    private let target = NSPopUpButton()
    private let character = GameChoiceStrip()
    private let vehicle = GameChoiceStrip()
    private let session = NSPopUpButton()
    private let sessionStatus = NSTextField(wrappingLabelWithString: "")
    private let focusSession = NSButton(title: "Focaliser", target: nil, action: nil)
    private let openSession = NSButton(title: "Ouvrir", target: nil, action: nil)
    private let preview = NSImageView()
    private let error = NSTextField(wrappingLabelWithString: "")
    var onSave: ((ThemeInterfaceOverrides) -> Void)?
    var onReset: (() -> Void)?
    var onSessionIntent: ((TerminalSessionIntent) -> String)?

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
        let fallback = interface.asset(for: "customizer.panel").flatMap(NSImage.init(contentsOf:))
        character.configure(entries: choices(.character, in: interface, fallback: fallback), selected: nil)
        vehicle.configure(entries: choices(.vehicle, in: interface, fallback: fallback), selected: nil)
        fill(session, entries: [("", "Aucune session", nil)] + sessions.map {
            ($0.id, "\($0.display_name) — \($0.state.rawValue)", nil)
        })
        if let targetID { select(target, id: targetID) }
        target.target = self
        target.action = #selector(targetChanged)
        session.target = self
        session.action = #selector(sessionChanged)
        focusSession.target = self
        focusSession.action = #selector(sendSessionIntent(_:))
        focusSession.identifier = NSUserInterfaceItemIdentifier(TerminalSessionIntentKind.focus.rawValue)
        openSession.target = self
        openSession.action = #selector(sendSessionIntent(_:))
        openSession.identifier = NSUserInterfaceItemIdentifier(TerminalSessionIntentKind.open.rawValue)
        character.onChange = { [weak self] in self?.choiceChanged() }
        vehicle.onChange = { [weak self] in self?.choiceChanged() }
        preview.imageScaling = .scaleProportionallyUpOrDown
        preview.widthAnchor.constraint(equalToConstant: 320).isActive = true
        preview.heightAnchor.constraint(equalToConstant: 130).isActive = true
        [target, session].forEach {
            $0.widthAnchor.constraint(equalToConstant: 320).isActive = true
        }
        [character, vehicle].forEach {
            $0.widthAnchor.constraint(equalToConstant: 320).isActive = true
            $0.heightAnchor.constraint(equalToConstant: 112).isActive = true
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
        sessionStatus.textColor = .secondaryLabelColor
        stack.addArrangedSubview(sessionStatus)
        stack.addArrangedSubview(NSStackView(views: [focusSession, openSession]))
        error.textColor = .systemRed
        stack.addArrangedSubview(error)
        let cancel = NSButton(title: "Annuler", target: self, action: #selector(close))
        let reset = NSButton(title: "Réinitialiser", target: self, action: #selector(reset))
        let save = NSButton(title: "Enregistrer", target: self, action: #selector(submit))
        save.keyEquivalent = "\r"
        stack.addArrangedSubview(NSStackView(views: [cancel, reset, save]))
        let window = NSPanel(contentRect: .init(x: 0, y: 0, width: 368, height: 720),
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
                         in interface: ResolvedThemeInterface,
                         fallback: NSImage?) -> [(String, String, NSImage?)] {
        [("", "Thème", fallback)] + interface.manifest.choices.filter { $0.kind == kind }.map {
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
        character.select(id: value?.character)
        vehicle.select(id: value?.vehicle)
        select(session, id: value?.session_id ?? embedded?.session_id)
        updatePreview()
        sessionChanged()
    }

    @objc private func choiceChanged() { updatePreview() }

    @objc private func sessionChanged() {
        guard let id = selectedID(session), let snapshot = sessions.first(where: { $0.id == id }) else {
            sessionStatus.stringValue = "Aucune session liée."
            focusSession.isEnabled = false
            openSession.isEnabled = false
            return
        }
        sessionStatus.stringValue = "\(snapshot.display_name) · \(stateLabel(snapshot.state)) · événement \(snapshot.sequence)"
        focusSession.isEnabled = snapshot.state != .disconnected
        openSession.isEnabled = true
    }

    @objc private func sendSessionIntent(_ sender: NSButton) {
        guard let id = selectedID(session),
              let rawKind = sender.identifier?.rawValue,
              let kind = TerminalSessionIntentKind(rawValue: rawKind) else { return }
        let message = onSessionIntent?(TerminalSessionIntent(sessionID: id, kind: kind))
            ?? "Provider de sessions indisponible."
        sessionStatus.stringValue = message
    }

    private func stateLabel(_ state: TerminalSessionState) -> String {
        switch state {
        case .idle: "en attente"
        case .active: "active"
        case .busy: "occupée"
        case .success: "terminée"
        case .error: "en erreur"
        case .recovering: "récupération"
        case .disconnected: "déconnectée"
        }
    }

    private func updatePreview() {
        guard let interface else { return }
        let selected = vehicle.selectedID ?? character.selectedID
        preview.image = interface.manifest.choices.first { $0.id == selected }
            .flatMap { interface.assets[$0.preview] }.flatMap(NSImage.init(contentsOf:))
            ?? interface.asset(for: "customizer.panel").flatMap(NSImage.init(contentsOf:))
    }

    @objc private func submit() {
        guard var overrides, let id = selectedID(target) else { return }
        overrides.targets[id] = ThemeTargetOverride(character: character.selectedID,
            vehicle: vehicle.selectedID, sessionID: selectedID(session))
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
