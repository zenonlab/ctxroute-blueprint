import AppKit

@MainActor private final class ThemePanelContentView: NSView {
    private let pattern: NSImage?

    init(pattern: NSImage?) {
        self.pattern = pattern
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { nil }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.windowBackgroundColor.setFill()
        dirtyRect.fill()
        guard let pattern else { return }
        NSGraphicsContext.saveGraphicsState()
        NSColor(patternImage: pattern).withAlphaComponent(0.22).setFill()
        dirtyRect.fill()
        NSGraphicsContext.restoreGraphicsState()
    }
}

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
                   selectionImage: NSImage?, cellSize: NSSize = .init(width: 96, height: 104)) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        entries = choices.map { id, label, image in
            let button = NSButton(title: label, target: self, action: #selector(chosen(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(id)
            button.image = image
            button.imagePosition = cellSize.height < 80 ? .imageLeading : .imageAbove
            button.imageScaling = .scaleProportionallyDown
            button.bezelStyle = .regularSquare
            button.font = .systemFont(ofSize: 11, weight: .medium)
            button.lineBreakMode = .byTruncatingTail
            button.toolTip = label
            button.setAccessibilityLabel(label)
            button.widthAnchor.constraint(equalToConstant: cellSize.width).isActive = true
            button.heightAnchor.constraint(equalToConstant: cellSize.height).isActive = true
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
                card.widthAnchor.constraint(equalToConstant: cellSize.width),
                card.heightAnchor.constraint(equalToConstant: cellSize.height),
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

@MainActor private final class GameChoiceGrid: NSView {
    struct Entry {
        let id: String
        let label: String
        let image: NSImage?
    }

    private let scroll = NSScrollView()
    private var grid = NSGridView()
    private var entries: [(button: NSButton, card: NSView, cursor: NSImageView)] = []
    private(set) var selectedID: String?
    var onChange: (() -> Void)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        addSubview(scroll)
        scroll.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        installGrid(NSGridView())
    }

    required init?(coder: NSCoder) { nil }

    func configure(_ choices: [Entry], columns: Int, selected: String?,
                   cellSize: NSSize, selectionImage: NSImage?) {
        // Replacing the document grid keeps removed cell constraints from
        // overlapping during rapid staged selection.
        let nextGrid = NSGridView()
        entries.removeAll(keepingCapacity: true)
        let safeColumns = max(2, min(columns, 10))
        for start in stride(from: 0, to: choices.count, by: safeColumns) {
            var cells: [NSView] = []
            for offset in 0..<safeColumns {
                let index = start + offset
                guard index < choices.count else {
                    let spacer = NSView()
                    spacer.widthAnchor.constraint(equalToConstant: cellSize.width).isActive = true
                    spacer.heightAnchor.constraint(equalToConstant: cellSize.height).isActive = true
                    cells.append(spacer)
                    continue
                }
                let choice = choices[index]
                let card = NSView()
                card.wantsLayer = true
                card.layer?.cornerRadius = 9
                card.layer?.borderWidth = 2
                let button = NSButton(image: choice.image ?? NSImage(), target: self,
                                      action: #selector(chosen(_:)))
                button.identifier = NSUserInterfaceItemIdentifier(choice.id)
                button.isBordered = false
                button.imageScaling = .scaleProportionallyDown
                button.toolTip = choice.label
                button.setAccessibilityLabel(choice.label)
                let cursor = NSImageView(image: selectionImage ?? NSImage())
                cursor.imageScaling = .scaleProportionallyDown
                cursor.isHidden = true
                cursor.setAccessibilityElement(false)
                card.addSubview(button)
                card.addSubview(cursor)
                [button, cursor].forEach { $0.translatesAutoresizingMaskIntoConstraints = false }
                NSLayoutConstraint.activate([
                    card.widthAnchor.constraint(equalToConstant: cellSize.width),
                    card.heightAnchor.constraint(equalToConstant: cellSize.height),
                    button.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 4),
                    button.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -4),
                    button.topAnchor.constraint(equalTo: card.topAnchor, constant: 4),
                    button.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -4),
                    cursor.widthAnchor.constraint(equalToConstant: 25),
                    cursor.heightAnchor.constraint(equalToConstant: 25),
                    cursor.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: 4),
                    cursor.topAnchor.constraint(equalTo: card.topAnchor, constant: -4)
                ])
                entries.append((button, card, cursor))
                cells.append(card)
            }
            nextGrid.addRow(with: cells)
        }
        installGrid(nextGrid)
        select(id: selected)
    }

    private func installGrid(_ nextGrid: NSGridView) {
        grid.removeFromSuperview()
        grid = nextGrid
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.rowSpacing = 7
        grid.columnSpacing = 7
        scroll.documentView = grid
        NSLayoutConstraint.activate([
            grid.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            grid.trailingAnchor.constraint(equalTo: scroll.contentView.trailingAnchor),
            grid.topAnchor.constraint(equalTo: scroll.contentView.topAnchor)
        ])
    }

    func select(id: String?) {
        selectedID = id
        for entry in entries {
            let active = entry.button.identifier?.rawValue == id
            entry.button.state = active ? .on : .off
            entry.cursor.isHidden = !active
            entry.card.layer?.borderColor = active
                ? NSColor.systemCyan.cgColor : NSColor.white.withAlphaComponent(0.24).cgColor
            entry.card.layer?.backgroundColor = active
                ? NSColor.systemBlue.withAlphaComponent(0.32).cgColor
                : NSColor.black.withAlphaComponent(0.16).cgColor
        }
    }

    @objc private func chosen(_ sender: NSButton) {
        select(id: sender.identifier?.rawValue)
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
    private let character = GameChoiceGrid()
    private let vehicle = GameChoiceGrid()
    private let characterTitle = NSTextField(labelWithString: "")
    private let vehicleTitle = NSTextField(labelWithString: "")
    private let selectionStack = NSStackView()
    private let session = NSPopUpButton()
    private let sessionStatus = NSTextField(wrappingLabelWithString: "")
    private let focusSession = NSButton(title: "Focaliser", target: nil, action: nil)
    private let openSession = NSButton(title: "Ouvrir", target: nil, action: nil)
    private let cancel = NSButton(title: "Annuler", target: nil, action: nil)
    private let resetButton = NSButton(title: "Réinitialiser", target: nil, action: nil)
    private let save = NSButton(title: "Enregistrer", target: nil, action: nil)
    private let error = NSTextField(wrappingLabelWithString: "")
    private var selectionImage: NSImage?
    private var fixedLayoutInstalled = false
    private var restorePreviewOnClose = false
    var onSave: ((ThemeInterfaceOverrides) -> Void)?
    var onReset: (() -> Void)?
    var onPreview: ((ThemeInterfaceOverrides) -> String?)?
    var onCancelPreview: (() -> Void)?
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
        restorePreviewOnClose = true
        editingTargetID = nil
        let targetIcon = interface.asset(for: "customizer.target").flatMap(NSImage.init(contentsOf:))
        selectionImage = interface.asset(for: "selector.cursor").flatMap(NSImage.init(contentsOf:))
        target.configure(entries: interface.manifest.targets.map { item in
            let choiceID = overrides.targets[item.id]?.vehicle
            let choice = interface.manifest.choices.first { $0.id == choiceID }
            let image = choice.flatMap { interface.assets[$0.preview] }.flatMap(NSImage.init(contentsOf:))
                ?? targetIcon
            return (item.id, item.label, image)
        }, selected: targetID ?? interface.manifest.targets.first?.id,
                         selectionImage: selectionImage,
                         cellSize: .init(width: 190, height: 54))
        configureCharacterGrid(selected: nil)
        configureVehicleGrid(selected: nil)
        configureSelectionStack(interface.manifest)
        configureSessionMenu(selected: nil)
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
        character.onChange = { [weak self] in self?.characterChanged() }
        vehicle.onChange = { [weak self] in self?.vehicleChanged() }
        target.onChange = { [weak self] in self?.targetChanged() }
        session.target = self
        session.action = #selector(sessionChanged)
        if !fixedLayoutInstalled {
            fixedLayoutInstalled = true
            NSLayoutConstraint.activate([
                target.widthAnchor.constraint(equalToConstant: 660),
                target.heightAnchor.constraint(equalToConstant: 60),
                character.widthAnchor.constraint(equalToConstant: 660),
                character.heightAnchor.constraint(equalToConstant: 292),
                vehicle.widthAnchor.constraint(equalToConstant: 660),
                vehicle.heightAnchor.constraint(equalToConstant: 150),
                session.widthAnchor.constraint(equalToConstant: 330)
            ])
        }
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 6
        stack.edgeInsets = .init(top: 20, left: 24, bottom: 20, right: 24)
        stack.addArrangedSubview(NSTextField(labelWithString: "Véhicule dans la scène"))
        stack.addArrangedSubview(target)
        stack.addArrangedSubview(selectionStack)
        stack.addArrangedSubview(NSTextField(labelWithString: "Session terminal / processus (optionnel)"))
        stack.addArrangedSubview(session)
        sessionStatus.textColor = .secondaryLabelColor
        stack.addArrangedSubview(sessionStatus)
        stack.addArrangedSubview(NSStackView(views: [focusSession, openSession]))
        error.textColor = .systemRed
        stack.addArrangedSubview(error)
        cancel.target = self
        cancel.action = #selector(cancelChanges)
        resetButton.target = self
        resetButton.action = #selector(reset)
        save.target = self
        save.action = #selector(submit)
        save.keyEquivalent = "\r"
        stack.addArrangedSubview(NSStackView(views: [cancel, resetButton, save]))
        let window = NSPanel(contentRect: .init(x: 0, y: 0, width: 708, height: 840),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Personnaliser le véhicule"
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.collectionBehavior.insert(.moveToActiveSpace)
        let content = ThemePanelContentView(pattern: interface.asset(for: "customizer.background.pattern")
            .flatMap(NSImage.init(contentsOf:)))
        content.addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor)
        ])
        window.contentView = content
        panel = window
        targetChanged()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func configureCharacterGrid(selected: String?) {
        guard let interface else { return }
        let stage = interface.manifest.stage(for: .character)
        let choices = interface.manifest.compatibleChoices(kind: .character, selected: selectedChoices())
        character.configure(choices.map { choiceEntry($0, in: interface) },
            columns: stage?.columns ?? 6,
            selected: choices.contains(where: { $0.id == selected }) ? selected : nil,
            cellSize: .init(width: 101, height: 66), selectionImage: selectionImage)
        characterTitle.stringValue = stage?.label ?? "Personnage"
    }

    private func configureVehicleGrid(selected: String?) {
        guard let interface else { return }
        let stage = interface.manifest.stage(for: .vehicle)
        let choices = interface.manifest.compatibleChoices(kind: .vehicle,
            selected: character.selectedID.map { [.character: $0] } ?? [:])
        vehicle.configure(choices.map { choiceEntry($0, in: interface) },
            columns: stage?.columns ?? 6, selected: choices.contains(where: { $0.id == selected }) ? selected : nil,
            cellSize: .init(width: 101, height: 64), selectionImage: selectionImage)
        let waitsForPriorChoice = choices.isEmpty && interface.manifest.selection?.compatibility.contains {
            $0.target_stage == stage?.id
        } == true
        let suffix = waitsForPriorChoice ? " — choix précédent requis" : ""
        vehicleTitle.stringValue = (stage?.label ?? "Véhicule") + suffix
    }

    private func configureSelectionStack(_ manifest: ThemeInterfaceManifest) {
        selectionStack.arrangedSubviews.forEach {
            selectionStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        selectionStack.orientation = .vertical
        selectionStack.alignment = .leading
        selectionStack.spacing = 6
        let stages = manifest.selection?.stages ?? [
            .init(id: "character", label: "Personnage", kind: .character, columns: 6),
            .init(id: "vehicle", label: "Véhicule", kind: .vehicle, columns: 6)
        ]
        for stage in stages {
            switch stage.kind {
            case .character:
                selectionStack.addArrangedSubview(characterTitle)
                selectionStack.addArrangedSubview(character)
            case .vehicle:
                selectionStack.addArrangedSubview(vehicleTitle)
                selectionStack.addArrangedSubview(vehicle)
            }
        }
    }

    private func selectedChoices() -> [ThemeInterfaceManifest.Choice.Kind: String] {
        var result: [ThemeInterfaceManifest.Choice.Kind: String] = [:]
        if let id = character.selectedID { result[.character] = id }
        if let id = vehicle.selectedID { result[.vehicle] = id }
        return result
    }

    private func refreshStages(after kind: ThemeInterfaceManifest.Choice.Kind) {
        guard let stages = interface?.manifest.selection?.stages,
              let index = stages.firstIndex(where: { $0.kind == kind }) else { return }
        for stage in stages.dropFirst(index + 1) {
            switch stage.kind {
            case .character: configureCharacterGrid(selected: character.selectedID)
            case .vehicle: configureVehicleGrid(selected: vehicle.selectedID)
            }
        }
    }

    private func choiceEntry(_ choice: ThemeInterfaceManifest.Choice,
                             in interface: ResolvedThemeInterface) -> GameChoiceGrid.Entry {
        .init(id: choice.id, label: choice.label,
              image: interface.assets[choice.preview].flatMap(NSImage.init(contentsOf:)))
    }

    private func configureSessionMenu(selected: String?) {
        guard let interface else { return }
        session.removeAllItems()
        session.addItem(withTitle: "Aucune session")
        session.lastItem?.representedObject = ""
        session.lastItem?.image = icon(for: "session.state.none", in: interface, size: 20)
        for snapshot in sessions {
            session.addItem(withTitle: "\(snapshot.display_name) — \(stateLabel(snapshot.state))")
            session.lastItem?.representedObject = snapshot.id
            session.lastItem?.image = icon(for: "session.state.\(snapshot.state.rawValue)", in: interface, size: 20)
        }
        if let index = session.itemArray.firstIndex(where: { ($0.representedObject as? String) == selected }) {
            session.selectItem(at: index)
        } else {
            session.selectItem(at: 0)
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
        configureVehicleGrid(selected: value?.vehicle)
        configureSessionMenu(selected: value?.session_id ?? embedded?.session_id)
        updateSessionStatus()
    }

    @objc private func characterChanged() {
        refreshStages(after: .character)
        updateTargetPreview()
        previewCurrentSelection()
    }

    @objc private func vehicleChanged() {
        refreshStages(after: .vehicle)
        updateTargetPreview()
        previewCurrentSelection()
    }

    @objc private func sessionChanged() {
        updateSessionStatus()
        previewCurrentSelection()
    }

    private func updateSessionStatus() {
        guard let id = session.selectedItem?.representedObject as? String,
              let snapshot = sessions.first(where: { $0.id == id }) else {
            sessionStatus.stringValue = sessions.isEmpty
                ? "Aucune session publiée par le provider terminal."
                : "Aucune session liée."
            focusSession.isEnabled = false
            openSession.isEnabled = false
            return
        }
        sessionStatus.stringValue = "\(snapshot.display_name) · \(stateLabel(snapshot.state)) · événement \(snapshot.sequence)"
        focusSession.isEnabled = snapshot.state != .disconnected
        openSession.isEnabled = true
    }

    @objc private func sendSessionIntent(_ sender: NSButton) {
        guard let id = session.selectedItem?.representedObject as? String, !id.isEmpty,
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
        let sessionID = session.selectedItem?.representedObject as? String
        overrides.set(ThemeTargetOverride(character: character.selectedID,
            vehicle: vehicle.selectedID, sessionID: sessionID?.isEmpty == true ? nil : sessionID), for: id)
        self.overrides = overrides
    }

    private func previewCurrentSelection() {
        captureCurrentSelection()
        guard let interface, let overrides else { return }
        do {
            let checked = try overrides.validated(for: themeID, interface: interface.manifest)
            if let previewError = onPreview?(checked) {
                error.stringValue = previewError
                return
            }
            let selected = [character.selectedID, vehicle.selectedID].compactMap { $0 }
            let unresolved = interface.manifest.choices.filter {
                selected.contains($0.id) && $0.appearance == nil
            }.map(\.label)
            error.stringValue = unresolved.isEmpty ? ""
                : "Aucun modèle 3D converti pour : \(unresolved.joined(separator: ", "))."
        } catch let previewError {
            error.stringValue = "Aperçu refusé : \(previewError.localizedDescription)"
        }
    }

    @objc private func submit() {
        captureCurrentSelection()
        guard let overrides else { return }
        do {
            guard let interface else { return }
            self.overrides = try overrides.validated(for: themeID, interface: interface.manifest)
            onSave?(self.overrides!)
            restorePreviewOnClose = false
            close()
        } catch { self.error.stringValue = "Choix invalide : \(error.localizedDescription)" }
    }

    @objc private func reset() {
        guard let interface else { return }
        overrides = ThemeInterfaceOverrides(themeID: themeID)
        editingTargetID = nil
        let selected = target.selectedID ?? interface.manifest.targets.first?.id
        let targetIcon = interface.asset(for: "customizer.target").flatMap(NSImage.init(contentsOf:))
        target.configure(entries: interface.manifest.targets.map { ($0.id, $0.label, targetIcon) },
                         selected: selected, selectionImage: selectionImage,
                         cellSize: .init(width: 190, height: 54))
        targetChanged()
        onReset?()
        error.stringValue = ""
    }

    @objc private func cancelChanges() {
        onCancelPreview?()
        restorePreviewOnClose = false
        close()
    }

    @objc private func close() { panel?.close(); panel = nil; editingTargetID = nil }
    func windowWillClose(_ notification: Notification) {
        if restorePreviewOnClose { onCancelPreview?() }
        restorePreviewOnClose = false
        panel = nil
        editingTargetID = nil
    }
}
