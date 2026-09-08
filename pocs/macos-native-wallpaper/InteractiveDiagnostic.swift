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
        guard !roots.isEmpty else { return }
        let receipt = DiagnosticReceipt(command)
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(receipt.notification as CFString), nil, nil, true)
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
            let track = CAShapeLayer()
            track.name = "interactive.race-track"
            track.fillColor = CGColor(gray: 0, alpha: 0)
            track.lineWidth = 8
            track.strokeColor = color(theme.track.color)
            root.addSublayer(track)
            for vehicle in theme.vehicles {
                let object = CALayer()
                object.name = "interactive.vehicle.\(vehicle.id)"
                object.bounds = CGRect(x: 0, y: 0, width: 72, height: 42)
                object.cornerRadius = 13
                object.backgroundColor = color(vehicle.color)
                object.borderColor = CGColor(gray: 1, alpha: 0.82)
                object.borderWidth = 2
                for wheelFrame in [CGRect(x: 5, y: -4, width: 16, height: 9),
                                   CGRect(x: 51, y: -4, width: 16, height: 9),
                                   CGRect(x: 5, y: 37, width: 16, height: 9),
                                   CGRect(x: 51, y: 37, width: 16, height: 9)] {
                    let wheel = CALayer()
                    wheel.frame = wheelFrame
                    wheel.cornerRadius = 3
                    wheel.backgroundColor = CGColor(gray: 0.04, alpha: 0.9)
                    object.addSublayer(wheel)
                }
                let cockpit = CALayer()
                cockpit.frame = CGRect(x: 27, y: 10, width: 22, height: 22)
                cockpit.cornerRadius = 11
                cockpit.backgroundColor = CGColor(gray: 1, alpha: 0.78)
                object.addSublayer(cockpit)
                root.addSublayer(object)
            }
            panel = CALayer()
            panel.name = "interactive.panel"
            panel.cornerRadius = 18
            panel.backgroundColor = color(theme.panel.color)
            let text = CATextLayer()
            text.name = "interactive.text"
            text.fontSize = 16
            text.alignmentMode = .center
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
            for anchor in theme.anchors {
                let object = CALayer()
                object.name = "interactive.anchor.\(anchor.id)"
                object.cornerRadius = 14
                object.borderWidth = 2
                object.borderColor = CGColor(red: 0.3, green: 0.95, blue: 1, alpha: 1)
                object.backgroundColor = CGColor(red: 0.03, green: 0.12, blue: 0.2, alpha: 0.9)
                let label = CATextLayer()
                label.name = "interactive.anchor.label.\(anchor.id)"
                label.alignmentMode = .center
                label.fontSize = 16
                label.contentsScale = 2
                label.foregroundColor = CGColor(gray: 1, alpha: 1)
                label.string = anchor.label
                object.addSublayer(label)
                root.addSublayer(object)
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
            text.string = "\(theme.panel.title)\nAnimation \(state.paused ? "en pause" : "active") · effet \(state.effectEnabled ? "actif" : "inactif")"
        }
        for action in theme.actions {
            guard let button = panel.sublayers?.first(where: { $0.name == "interactive.action.\(action.id)" }) else { continue }
            let actionFrame = action.normalizedFrame
            button.frame = CGRect(x: panel.bounds.width * actionFrame.x, y: panel.bounds.height * actionFrame.y,
                width: panel.bounds.width * actionFrame.width, height: panel.bounds.height * actionFrame.height)
            button.opacity = isSelected(action.command) ? 1 : 0.72
            if let label = button.sublayers?.first as? CATextLayer {
                label.frame = CGRect(x: 4, y: max(0, (button.bounds.height - 18) / 2),
                    width: max(0, button.bounds.width - 8), height: 18)
            }
        }
        for anchor in theme.anchors {
            guard let object = root.sublayers?.first(where: { $0.name == "interactive.anchor.\(anchor.id)" }) else { continue }
            let anchorFrame = anchor.normalizedFrame
            object.frame = CGRect(x: root.bounds.width * anchorFrame.x, y: root.bounds.height * anchorFrame.y,
                width: root.bounds.width * anchorFrame.width, height: root.bounds.height * anchorFrame.height)
            object.opacity = 1
            if let action = theme.action(id: anchor.actionID) {
                object.borderWidth = isSelected(action.command) ? 5 : 2
            }
            if let label = object.sublayers?.first as? CATextLayer {
                label.frame = CGRect(x: 6, y: max(0, (object.bounds.height - 22) / 2),
                    width: max(0, object.bounds.width - 12), height: 22)
            }
        }
        if let track = root.sublayers?.first(where: { $0.name == "interactive.race-track" }) as? CAShapeLayer {
            let rect = trackRect(root: root, laneOffset: 0, theme: theme)
            track.path = CGPath(ellipseIn: rect, transform: nil)
        }
        for vehicle in theme.vehicles {
            guard let object = root.sublayers?.first(where: { $0.name == "interactive.vehicle.\(vehicle.id)" }) else {
                continue
            }
            let path = CGPath(ellipseIn: trackRect(root: root, laneOffset: vehicle.laneOffset, theme: theme),
                              transform: nil)
            let rect = trackRect(root: root, laneOffset: vehicle.laneOffset, theme: theme)
            let angle = -vehicle.trailingOffset
            object.position = CGPoint(x: rect.midX + rect.width / 2 * cos(angle),
                                      y: rect.midY + rect.height / 2 * sin(angle))
            if object.animation(forKey: "interactive.vehicle.motion") == nil {
                let motion = CAKeyframeAnimation(keyPath: "position")
                motion.path = path
                motion.calculationMode = .paced
                motion.rotationMode = .rotateAuto
                motion.duration = theme.track.periodSeconds
                motion.repeatCount = .infinity
                let now = object.convertTime(CACurrentMediaTime(), from: nil)
                let trailingTime = vehicle.trailingOffset / (2 * Double.pi) * theme.track.periodSeconds
                var elapsed = (now - trailingTime).truncatingRemainder(dividingBy: theme.track.periodSeconds)
                if elapsed < 0 { elapsed += theme.track.periodSeconds }
                motion.beginTime = now - elapsed
                motion.isRemovedOnCompletion = false
                object.add(motion, forKey: "interactive.vehicle.motion")
            }
            setPaused(state.paused, layer: object)
            object.borderWidth = state.effectEnabled ? 6 : 2
        }
        CATransaction.commit()
        CATransaction.flush()
    }

    private static func color(_ value: DiagnosticTheme.Color) -> CGColor {
        CGColor(red: value.red, green: value.green, blue: value.blue, alpha: value.alpha)
    }

    private static func trackRect(root: CALayer, laneOffset: Double, theme: DiagnosticTheme) -> CGRect {
        let track = theme.track
        return CGRect(x: root.bounds.width * (track.centerX - track.radiusX - laneOffset),
                      y: root.bounds.height * (track.centerY - track.radiusY - laneOffset * 0.7),
                      width: root.bounds.width * (track.radiusX + laneOffset) * 2,
                      height: root.bounds.height * (track.radiusY + laneOffset * 0.7) * 2)
    }

    private static func setPaused(_ paused: Bool, layer: CALayer) {
        if paused && layer.speed != 0 {
            let time = layer.convertTime(CACurrentMediaTime(), from: nil)
            layer.speed = 0
            layer.timeOffset = time
        } else if !paused && layer.speed == 0 {
            let time = layer.timeOffset
            layer.speed = 1
            layer.timeOffset = 0
            layer.beginTime = 0
            layer.beginTime = layer.convertTime(CACurrentMediaTime(), from: nil) - time
        }
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
