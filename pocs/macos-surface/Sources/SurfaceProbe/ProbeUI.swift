import AppKit

@MainActor
final class ProbeUI {
    let root = NSView()
    let scene = SceneView()
    let panel = NSBox()
    let status = NSTextField(labelWithString: "")
    let objectButton = NSButton(title: "Ouvrir l’objet", target: nil, action: nil)
    let animationButton = NSButton(title: "Animer", target: nil, action: nil)
    let effectButton = NSButton(title: "Activer le halo", target: nil, action: nil)
    let pauseButton = NSButton(title: "Pause", target: nil, action: nil)
    let closePanelButton = NSButton(title: "Fermer le panneau", target: nil, action: nil)
    let quitButton = NSButton(title: "Quitter la sonde", target: nil, action: nil)

    init() {
        let title = NSTextField(labelWithString: "Sonde native · macOS")
        title.font = ProbeStyle.heading
        let hint = NSTextField(wrappingLabelWithString: "Objet → panneau → animation / effet. Aucun jeu ni terminal exécuté.")
        let controls = NSStackView(views: [objectButton, pauseButton, quitButton])
        controls.spacing = ProbeStyle.space
        panel.title = "Panneau de l’objet"
        panel.boxType = .primary
        let panelControls = NSStackView(views: [animationButton, effectButton, closePanelButton])
        panelControls.spacing = ProbeStyle.space
        panel.contentView = panelControls
        panel.contentViewMargins = NSSize(width: ProbeStyle.space, height: ProbeStyle.space)
        panel.isHidden = true
        status.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        status.maximumNumberOfLines = 2
        let stack = NSStackView(views: [title, hint, scene, controls, panel, status])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = ProbeStyle.space
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: ProbeStyle.margin),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -ProbeStyle.margin),
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: ProbeStyle.margin),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: root.bottomAnchor, constant: -ProbeStyle.margin),
            scene.widthAnchor.constraint(equalTo: stack.widthAnchor),
            scene.heightAnchor.constraint(equalToConstant: ProbeStyle.sceneHeight),
            panel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            panel.heightAnchor.constraint(equalToConstant: 80)
        ])
        objectButton.keyEquivalent = "o"
        pauseButton.keyEquivalent = "p"
        quitButton.keyEquivalent = "q"
        closePanelButton.keyEquivalent = "\u{1b}"
        closePanelButton.keyEquivalentModifierMask = []
        for button in [objectButton, animationButton, effectButton, pauseButton, closePanelButton, quitButton] {
            button.bezelStyle = .rounded
            button.setAccessibilityLabel(button.title)
        }
        scene.setAccessibilityElement(false)
    }
}

@MainActor
final class PassiveDesktopWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
