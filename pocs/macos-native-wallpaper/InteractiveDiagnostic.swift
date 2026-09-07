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
    nonisolated(unsafe) private static var theme: DiagnosticTheme?

    static func attach(to root: CALayer, theme suppliedTheme: DiagnosticTheme? = nil) {
        if let suppliedTheme { theme = suppliedTheme }
        if theme == nil {
            do { theme = try DiagnosticTheme.load() }
            catch { extensionLog("[Interaction] theme rejected: \(error)"); return }
        }
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
        guard let theme else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        root.backgroundColor = color(theme.background)
        if let sweep = root.sublayers?.first(where: { $0.name == "colorDiag.fill" }) {
            sweep.backgroundColor = color(theme.sweep.color)
            if let animation = sweep.animation(forKey: "colorDiag.sweep")?.copy() as? CABasicAnimation,
               animation.duration != theme.sweep.durationSeconds {
                animation.duration = theme.sweep.durationSeconds
                sweep.add(animation, forKey: "colorDiag.sweep")
            }
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
            sweep.borderWidth = state.effectEnabled ? theme.sweep.effectWidth : 0
            sweep.borderColor = color(theme.sweep.effectColor)
        }
        let panel: CALayer
        if let existing = root.sublayers?.first(where: { $0.name == "interactive.panel" }) {
            panel = existing
        } else {
            panel = CALayer()
            panel.name = "interactive.panel"
            panel.cornerRadius = 18
            panel.backgroundColor = color(theme.panel.color)
            let text = CATextLayer()
            text.name = "interactive.text"
            text.fontSize = 20
            text.contentsScale = 2
            text.foregroundColor = CGColor(gray: 1, alpha: 1)
            text.isWrapped = true
            panel.addSublayer(text)
            for action in theme.actions {
                let button = CALayer()
                button.name = "interactive.action.\(action.id)"
                button.cornerRadius = 7
                button.backgroundColor = CGColor(red: 0.12, green: 0.2, blue: 0.31, alpha: 1)
                let label = CATextLayer()
                label.name = "interactive.action.label.\(action.id)"
                label.alignmentMode = .center
                label.fontSize = 13
                label.contentsScale = 2
                label.foregroundColor = CGColor(gray: 1, alpha: 1)
                label.string = action.label
                button.addSublayer(label)
                panel.addSublayer(button)
            }
            root.addSublayer(panel)
        }
        let frame = theme.panel.normalizedFrame
        panel.frame = CGRect(x: root.bounds.width * frame.x, y: root.bounds.height * frame.y,
            width: root.bounds.width * frame.width, height: root.bounds.height * frame.height)
        panel.isHidden = !state.panelOpen
        if let text = panel.sublayers?.first(where: { $0.name == "interactive.text" }) as? CATextLayer {
            text.frame = CGRect(x: 20, y: panel.bounds.height * 0.72,
                width: max(0, panel.bounds.width - 40), height: panel.bounds.height * 0.24)
            text.string = "\(theme.panel.title) · animation \(state.paused ? "en pause" : "active") · effet \(state.effectEnabled ? "actif" : "inactif")"
        }
        for action in theme.actions {
            guard let button = panel.sublayers?.first(where: { $0.name == "interactive.action.\(action.id)" }) else { continue }
            let actionFrame = action.normalizedFrame
            button.frame = CGRect(x: panel.bounds.width * actionFrame.x, y: panel.bounds.height * actionFrame.y,
                width: panel.bounds.width * actionFrame.width, height: panel.bounds.height * actionFrame.height)
            button.opacity = isSelected(action.command) ? 1 : 0.72
            if let label = button.sublayers?.first as? CATextLayer { label.frame = button.bounds.insetBy(dx: 4, dy: 2) }
        }
        CATransaction.commit()
        CATransaction.flush()
    }

    private static func color(_ value: DiagnosticTheme.Color) -> CGColor {
        CGColor(red: value.red, green: value.green, blue: value.blue, alpha: value.alpha)
    }

    private static func isSelected(_ command: DiagnosticCommand) -> Bool {
        switch command {
        case .showPanel: state.panelOpen
        case .hidePanel: !state.panelOpen
        case .pause: state.paused
        case .resume: !state.paused
        case .effectOn: state.effectEnabled
        case .effectOff: !state.effectEnabled
        case .reset: false
        }
    }
}
