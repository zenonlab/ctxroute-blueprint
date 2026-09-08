import AppKit
import UniformTypeIdentifiers

/// One draft window, opened by a context gesture. Never a docked sidebar.
@MainActor final class CustomizationModal: NSObject, NSWindowDelegate {
    private var panel: NSPanel?
    private var draft: Theme?
    private var objectIndex = 0
    private let name = NSTextField()
    private let color = NSColorWell()
    private let size = NSSlider(value: 44, minValue: 24, maxValue: 96, target: nil, action: nil)
    private let application = NSTextField(labelWithString: "Terminal")
    private let error = NSTextField(wrappingLabelWithString: "")
    private let save = NSButton(title: "Enregistrer", target: nil, action: nil)
    private var applicationID: String?
    var onSave: ((Theme) -> Void)?
    var isVisible: Bool { panel?.isVisible == true }

    func present(theme: Theme, objectID: String?, point: ScenePoint? = nil, width: Double = 1, height: Double = 1) {
        if isVisible { panel?.makeKeyAndOrderFront(nil); return }
        var value = theme
        if let objectID, let index = value.objects.firstIndex(where: { $0.id == objectID }) {
            objectIndex = index
        } else {
            guard value.objects.count < 8, let point, width > 0, height > 0 else { return }
            value.objects.append(Theme.Object(id: "object." + UUID().uuidString, color: value.accent, phase: 0,
                label: "Terminal", application: "com.apple.Terminal",
                x: min(0.95, max(0.05, point.x / width)), y: min(0.95, max(0.05, point.y / height))))
            objectIndex = value.objects.count - 1
        }
        draft = value
        let object = value.objects[objectIndex]
        name.stringValue = object.label ?? "Terminal"
        applicationID = object.application_bundle_id ?? "com.apple.Terminal"
        updateApplicationName()
        color.color = NSColor(cgColor: Scene.color(object.color)) ?? .systemBlue
        size.doubleValue = object.size ?? 44
        error.stringValue = ""; save.isEnabled = true
        let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 390, height: 340),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = objectID == nil ? "Ajouter un objet" : "Personnaliser l’objet"
        window.isReleasedWhenClosed = false; window.delegate = self
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 24, bottom: 20, right: 24)
        name.placeholderString = "Nom"; name.setAccessibilityLabel("Nom de l’objet")
        name.widthAnchor.constraint(equalToConstant: 342).isActive = true
        color.setAccessibilityLabel("Couleur de l’objet"); size.setAccessibilityLabel("Taille de l’objet")
        for (title, field) in [("Nom", name as NSView), ("Couleur", color), ("Taille", size)] {
            stack.addArrangedSubview(NSTextField(labelWithString: title)); stack.addArrangedSubview(field)
        }
        let picker = NSButton(title: "Choisir l’application…", target: self, action: #selector(pickApplication))
        stack.addArrangedSubview(NSStackView(views: [application, picker]))
        error.textColor = .systemRed; error.font = .systemFont(ofSize: 12); stack.addArrangedSubview(error)
        save.target = self; save.action = #selector(submit); save.keyEquivalent = "\r"
        let cancel = NSButton(title: "Annuler", target: self, action: #selector(close)); cancel.keyEquivalent = "\u{1b}"
        stack.addArrangedSubview(NSStackView(views: [cancel, save]))
        window.contentView = stack; panel = window; window.center()
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(name)
    }
    private func updateApplicationName() {
        application.stringValue = applicationID.flatMap { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) }
            .map { $0.deletingPathExtension().lastPathComponent } ?? "Application indisponible"
    }
    @objc private func pickApplication() {
        guard let panel else { return }
        let picker = NSOpenPanel(); picker.allowedContentTypes = [.applicationBundle]
        picker.canChooseDirectories = false; picker.allowsMultipleSelection = false
        picker.directoryURL = URL(fileURLWithPath: "/Applications")
        picker.beginSheetModal(for: panel) { [weak self] result in
            guard result == .OK, let url = picker.url, let id = Bundle(url: url)?.bundleIdentifier else { return }
            self?.applicationID = id; self?.updateApplicationName()
        }
    }
    @objc private func submit() {
        guard var value = draft, let rgb = color.color.usingColorSpace(.sRGB) else { return }
        value.objects[objectIndex].label = name.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        value.objects[objectIndex].color = String(format: "%02X%02X%02X", Int((rgb.redComponent * 255).rounded()),
            Int((rgb.greenComponent * 255).rounded()), Int((rgb.blueComponent * 255).rounded()))
        value.objects[objectIndex].size = size.doubleValue
        value.objects[objectIndex].application_bundle_id = applicationID
        do {
            let checked = try Theme.decode(JSONEncoder().encode(value))
            save.isEnabled = false; error.stringValue = "Application au décor…"; onSave?(checked)
        } catch { failed("Nom : 1 à 40 caractères. Vérifiez les paramètres.") }
    }
    func confirmed() { close() }
    func failed(_ message: String) { save.isEnabled = true; error.stringValue = message }
    @objc private func close() { panel?.close(); draft = nil }
    func windowWillClose(_ notification: Notification) { draft = nil }
}
