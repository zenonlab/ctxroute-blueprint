import Foundation
import QuartzCore

private final class DiagnosticRoot {
    weak var layer: CALayer?
    init(_ layer: CALayer) { self.layer = layer }
}

// All state and layer access is confined to the existing Lifecycle.queue.
enum InteractiveDiagnostic {
    nonisolated(unsafe) private static var observing = false
    nonisolated(unsafe) private static var roots: [DiagnosticRoot] = []
    nonisolated(unsafe) private static var state = DiagnosticState()

    static func attach(to root: CALayer) {
        roots.removeAll { $0.layer == nil }
        if !roots.contains(where: { $0.layer === root }) { roots.append(DiagnosticRoot(root)) }
        if !observing {
            observing = true
            for command in DiagnosticCommand.allCases {
                CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil,
                    { _, _, name, _, _ in
                        guard let name, let command = DiagnosticCommand(notification: name.rawValue as String) else { return }
                        Lifecycle.queue.async { InteractiveDiagnostic.receive(command) }
                    }, command.notification as CFString, nil, .coalesce)
            }
        }
        render(root)
    }

    static func receive(_ command: DiagnosticCommand) {
        state.apply(command)
        roots.removeAll { $0.layer == nil }
        for root in roots { if let layer = root.layer { render(layer) } }
        extensionLog("[Interaction] applied \(command.rawValue) roots=\(roots.count)")
    }

    private static func render(_ root: CALayer) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if let sweep = root.sublayers?.first(where: { $0.name == "colorDiag.fill" }) {
            if state.paused && sweep.speed != 0 {
                let time = sweep.convertTime(CACurrentMediaTime(), from: nil)
                sweep.speed = 0
                sweep.timeOffset = time
            } else if !state.paused && sweep.speed == 0 {
                let time = sweep.timeOffset
                sweep.speed = 1
                sweep.timeOffset = 0
                sweep.beginTime = 0
                sweep.beginTime = sweep.convertTime(CACurrentMediaTime(), from: nil) - time
            }
            sweep.borderWidth = state.effectEnabled ? 12 : 0
            sweep.borderColor = CGColor(red: 1, green: 0.85, blue: 0.1, alpha: 1)
        }
        let panel: CALayer
        if let existing = root.sublayers?.first(where: { $0.name == "interactive.panel" }) {
            panel = existing
        } else {
            panel = CALayer()
            panel.name = "interactive.panel"
            panel.cornerRadius = 18
            panel.backgroundColor = CGColor(red: 0.04, green: 0.07, blue: 0.12, alpha: 0.95)
            let text = CATextLayer()
            text.name = "interactive.text"
            text.fontSize = 20
            text.contentsScale = 2
            text.foregroundColor = CGColor(gray: 1, alpha: 1)
            text.isWrapped = true
            panel.addSublayer(text)
            root.addSublayer(panel)
        }
        let width = max(0, min(360, root.bounds.width - 32))
        panel.frame = CGRect(x: root.bounds.midX - width / 2,
            y: root.bounds.midY - 80, width: width, height: 160)
        panel.isHidden = !state.panelOpen
        if let text = panel.sublayers?.first as? CATextLayer {
            text.frame = panel.bounds.insetBy(dx: 20, dy: 20)
            text.string = "Panneau du décor\nAnimation : \(state.paused ? "pause" : "active")\nEffet : \(state.effectEnabled ? "actif" : "inactif")\nCommandes via le compagnon"
        }
        CATransaction.commit()
        CATransaction.flush()
    }
}
