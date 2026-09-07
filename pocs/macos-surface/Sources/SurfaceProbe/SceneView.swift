import AppKit
import ProbeCore

@MainActor
final class SceneView: NSView {
    var state = ProbeState(interactive: false)
    var selectObject: (() -> Void)?
    private(set) var drawCount = 0

    override var isOpaque: Bool { true }

    private var objectRect: NSRect {
        let travel = max(0, bounds.width - 4 * ProbeStyle.margin)
        let fraction = (sin(state.phaseSeconds * .pi / 2) + 1) / 2
        return NSRect(x: ProbeStyle.margin + travel * fraction, y: bounds.midY - 20, width: 40, height: 40)
    }

    override func draw(_ dirtyRect: NSRect) {
        drawCount += 1
        ProbeStyle.surface.setFill()
        bounds.fill()
        let route = NSBezierPath(roundedRect: bounds.insetBy(dx: ProbeStyle.margin, dy: 70),
                                 xRadius: 32, yRadius: 32)
        ProbeStyle.track.setStroke()
        route.lineWidth = 2
        route.stroke()
        if state.effectEnabled {
            ProbeStyle.accent.withAlphaComponent(0.15).setFill()
            NSBezierPath(ovalIn: objectRect.insetBy(dx: -14, dy: -14)).fill()
        }
        ProbeStyle.accent.setFill()
        NSBezierPath(roundedRect: objectRect, xRadius: ProbeStyle.radius, yRadius: ProbeStyle.radius).fill()
        let label = state.interactive ? "Objet de test · clic ou bouton ci-dessous" : "Sonde bureau passive · aucun clic capturé"
        (label as NSString).draw(at: NSPoint(x: ProbeStyle.margin, y: ProbeStyle.margin),
                                withAttributes: [.font: ProbeStyle.body, .foregroundColor: ProbeStyle.text])
    }

    override func mouseDown(with event: NSEvent) {
        guard state.interactive,
              objectRect.contains(convert(event.locationInWindow, from: nil)) else { return }
        selectObject?()
    }
}
