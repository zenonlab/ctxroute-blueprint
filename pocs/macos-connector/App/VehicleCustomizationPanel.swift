import AppKit

@MainActor private final class GameChoiceStrip: NSView {
    private let stack = NSStackView()
    private var entries: [(button: NSButton, cursor: NSImageView)] = []
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

    func configure(entries choices: [(String, String, NSImage?)], selected: String?,
                   selectionImage: NSImage?) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        entries = choices.map { id, label, image in
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
            let cursor = NSImageView(image: selectionImage ?? NSImage())
            cursor.imageScaling = .scaleProportionallyDown
            cursor.isHidden = true
            cursor.setAccessibilityElement(false)
            cursor.translatesAutoresizingMaskIntoConstraints = false
            let card = NSView()
            card.addSubview(button)
            card.addSubview(cursor)
            button.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                card.widthAnchor.constraint(equalToConstant: 96),
                card.heightAnchor.constraint(equalToConstant: 104),
                button.leadingAnchor.constraint(equalTo: card.leadingAnchor),
                button.trailingAnchor.constraint(equalTo: card.trailingAnchor),
                button.topAnchor.constraint(equalTo: card.topAnchor),
                button.bottomAnchor.constraint(equalTo: card.bottomAnchor),
                cursor.widthAnchor.constraint(equalToConstant: 30),
                cursor.heightAnchor.constraint(equalToConstant: 30),
                cursor.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: 5),
                cursor.topAnchor.constraint(equalTo: card.topAnchor, constant: -5)
            ])
            stack.addArrangedSubview(card)
            return (button, cursor)
        }
        select(id: selected)
    }

    func select(id: String?) {
        selectedID = id
        for entry in entries {
            let button = entry.button
            let active = button.identifier?.rawValue == (id ?? "")
            button.state = active ? .on : .off
            entry.cursor.isHidden = !active
        }
    }

    func setImage(_ image: NSImage?, for id: String) {
        entries.first { $0.button.identifier?.rawValue == id }?.button.image = image
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
    private var editingTargetID: String?
    private let target = GameChoiceStrip()
    private let character = GameChoiceStrip()
    private let vehicle = GameChoiceStrip()
    private let session = GameChoiceStrip()
    private let sessionStatus = NSTextField(wrappingLabelWithString: "")
    private let focusSession = NSButton(title: "Focaliser", target: nil, action: nil)
    private let openSession = NSButton(title: "Ouvrir", target: nil, action: nil)
    private let cancel = NSButton(title: "Annuler", target: nil, action: nil)
    private let resetButton = NSButton(title: "Réinitialiser", target: nil, action: nil)
    private let save = NSButton(title: "Enregistrer", target: nil, action: nil)
    private let preview = NSImageView()
    private let error = NSTextField(wrappingLabelWithString: "")
    var onSave: ((ThemeInterfaceOverrides) -> Void)?
    var onReset: (() -> Void)?
    var onSessionIntent: ((TerminalSessionIntent) -> String)?

    func present(themeID: String, interface: ResolvedThemeInterface,
                 overrides: ThemeInterfaceOverrides, sessions: [TerminalSessionSnapshot],
                 targetID: String? = nil) {
        if panel?.isVisible == true, self.themeID == themeID {
            if let targetID { target.select(id: targetID); targetChanged() }
            panel?.makeKeyAndOrderFront(nil)
            return
        }
        panel?.close()
        panel = nil
        self.themeID = themeID
        self.interface = interface
        self.overrides = overrides
        self.sessions = sessions
        editingTargetID = nil
        let targetIcon = interface.asset(for: "customizer.target").flatMap(NSImage.init(contentsOf:))
        let selectionImage = interface.asset(for: "selector.cursor").flatMap(NSImage.init(contentsOf:))
        target.configure(entries: interface.manifest.targets.map { item in
            let choiceID = overrides.targets[item.id]?.vehicle
            let choice = interface.manifest.choices.first { $0.id == choiceID }
            let image = choice.flatMap { interface.assets[$0.preview] }.flatMap(NSImage.init(contentsOf:))
                ?? targetIcon
            return (item.id, item.label, image)
        }, selected: targetID ?? interface.manifest.targets.first?.id,
                         selectionImage: selectionImage)
        let fallback = interface.asset(for: "customizer.panel").flatMap(NSImage.init(contentsOf:))
        character.configure(entries: choices(.character, in: interface, fallback: fallback),
                            selected: nil, selectionImage: selectionImage)
        vehicle.configure(entries: choices(.vehicle, in: interface, fallback: fallback),
                          selected: nil, selectionImage: selectionImage)
        session.configure(entries: [("", "Aucune session",
                                     icon(for: "session.state.none", in: interface, size: 64))] + sessions.map {
            ($0.id, "\($0.display_name) — \($0.state.rawValue)",
             icon(for: "session.state.\($0.state.rawValue)", in: interface, size: 64))
        }, selected: nil, selectionImage: selectionImage)
        focusSession.target = self
        focusSession.action = #selector(sendSessionIntent(_:))
        focusSession.identifier = NSUserInterfaceItemIdentifier(TerminalSessionIntentKind.focus.rawValue)
        openSession.target = self
        openSession.action = #selector(sendSessionIntent(_:))
        openSession.identifier = NSUserInterfaceItemIdentifier(TerminalSessionIntentKind.open.rawValue)
        skin(focusSession, slot: "session.action.focus", interface: interface)
        skin(openSession, slot: "session.action.open", interface: interface)
        skin(cancel, slot: "customizer.action.cancel", interface: interface)
        skin(resetButton, slot: "customizer.action.reset", interface: interface)
        skin(save, slot: "customizer.action.save", interface: interface)
        character.onChange = { [weak self] in self?.choiceChanged() }
        vehicle.onChange = { [weak self] in self?.choiceChanged() }
        target.onChange = { [weak self] in self?.targetChanged() }
        session.onChange = { [weak self] in self?.sessionChanged() }
        preview.imageScaling = .scaleProportionallyUpOrDown
        preview.widthAnchor.constraint(equalToConstant: 320).isActive = true
        preview.heightAnchor.constraint(equalToConstant: 130).isActive = true
        [target, character, vehicle, session].forEach {
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
        cancel.target = self
        cancel.action = #selector(close)
        resetButton.target = self
        resetButton.action = #selector(reset)
        save.target = self
        save.action = #selector(submit)
        save.keyEquivalent = "\r"
        stack.addArrangedSubview(NSStackView(views: [cancel, resetButton, save]))
        let window = NSPanel(contentRect: .init(x: 0, y: 0, width: 368, height: 880),
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

    private func skin(_ button: NSButton, slot: String, interface: ResolvedThemeInterface) {
        button.image = icon(for: slot, in: interface, size: 22)
        button.imagePosition = button.image == nil ? .noImage : .imageLeading
        button.imageScaling = .scaleProportionallyDown
        button.bezelStyle = .regularSquare
    }

    private func icon(for slot: String, in interface: ResolvedThemeInterface,
                      size: CGFloat) -> NSImage? {
        guard let url = interface.asset(for: slot), let image = NSImage(contentsOf: url) else { return nil }
        image.size = NSSize(width: size, height: size)
        image.isTemplate = false
        return image
    }

    @objc private func targetChanged() {
        captureCurrentSelection()
        guard let interface, let overrides, let id = target.selectedID else { return }
        editingTargetID = id
        let embedded = interface.manifest.targets.first { $0.id == id }
        let value = overrides.targets[id]
        character.select(id: value?.character)
        vehicle.select(id: value?.vehicle)
        session.select(id: value?.session_id ?? embedded?.session_id)
        updatePreview()
        sessionChanged()
    }

    @objc private func choiceChanged() {
        updatePreview()
        updateTargetPreview()
    }

    @objc private func sessionChanged() {
        guard let id = session.selectedID, let snapshot = sessions.first(where: { $0.id == id }) else {
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
        guard let id = session.selectedID,
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

    private func updateTargetPreview() {
        guard let interface, let id = editingTargetID else { return }
        let image = vehicle.selectedID
            .flatMap { selected in interface.manifest.choices.first { $0.id == selected } }
            .flatMap { interface.assets[$0.preview] }
            .flatMap(NSImage.init(contentsOf:))
            ?? interface.asset(for: "customizer.target").flatMap(NSImage.init(contentsOf:))
        target.setImage(image, for: id)
    }

    private func captureCurrentSelection() {
        guard var overrides, let id = editingTargetID else { return }
        overrides.targets[id] = ThemeTargetOverride(character: character.selectedID,
            vehicle: vehicle.selectedID, sessionID: session.selectedID)
        self.overrides = overrides
    }

    @objc private func submit() {
        captureCurrentSelection()
        guard let overrides else { return }
        do {
            guard let interface else { return }
            self.overrides = try overrides.validated(for: themeID, interface: interface.manifest)
            onSave?(self.overrides!)
            close()
        } catch { self.error.stringValue = "Choix invalide : \(error.localizedDescription)" }
    }

    @objc private func reset() { onReset?(); close() }
    @objc private func close() { panel?.close(); panel = nil; editingTargetID = nil }
    func windowWillClose(_ notification: Notification) { panel = nil; editingTargetID = nil }
}
