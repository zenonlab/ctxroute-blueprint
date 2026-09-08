import AppKit
import ProbeCore

@MainActor
final class SceneView: NSView {
    var state = ProbeState(interactive: false)
    var selectObject: (() -> Void)?
    var isDesktop = false
    var usesFixedAnchor = false
    var formationTheme: FormationTheme?
    var formationSnapshot: FormationSnapshot?
    var fixedAnchor: NSRect { NSRect(x: 80, y: bounds.midY, width: 180, height: 64) }
    private(set) var drawCount = 0

    override var isOpaque: Bool { true }

    private var objectRect: NSRect {
        if usesFixedAnchor { return fixedAnchor }
        let travel = max(0, bounds.width - 4 * ProbeStyle.margin)
        let fraction = (sin(state.phaseSeconds * .pi / 2) + 1) / 2
        return NSRect(x: ProbeStyle.margin + travel * fraction, y: bounds.midY - 20, width: 40, height: 40)
    }

    override func draw(_ dirtyRect: NSRect) {
        drawCount += 1
        ProbeStyle.surface.setFill()
        bounds.fill()
        let routeRect: NSRect
        if let track = formationTheme?.track {
            routeRect = NSRect(x: bounds.width * (track.centerX - track.radiusX),
                               y: bounds.height * (track.centerY - track.radiusY),
                               width: bounds.width * track.radiusX * 2,
                               height: bounds.height * track.radiusY * 2)
        } else {
            routeRect = bounds.insetBy(dx: ProbeStyle.margin, dy: 70)
        }
        let route = usesFixedAnchor ? NSBezierPath(ovalIn: routeRect)
            : NSBezierPath(roundedRect: routeRect, xRadius: 32, yRadius: 32)
        ProbeStyle.track.setStroke()
        route.lineWidth = 2
        route.stroke()
        if usesFixedAnchor, let formationSnapshot {
            NSColor.black.withAlphaComponent(0.16).setFill()
            for object in formationSnapshot.objects {
                let center = NSPoint(x: bounds.width * object.centerX, y: bounds.height * object.centerY)
                NSBezierPath(ovalIn: NSRect(x: center.x - 30, y: center.y - 13,
                                            width: 60, height: 26)).fill()
            }
        } else if state.effectEnabled {
            ProbeStyle.accent.withAlphaComponent(0.15).setFill()
            NSBezierPath(ovalIn: objectRect.insetBy(dx: -14, dy: -14)).fill()
        }
        if !usesFixedAnchor {
            ProbeStyle.accent.setFill()
            NSBezierPath(roundedRect: objectRect, xRadius: ProbeStyle.radius, yRadius: ProbeStyle.radius).fill()
        }
        let label = usesFixedAnchor ? "Fond persistant · véhicules sur plan dynamique · priorité des icônes NON garantie"
            : (isDesktop ? "Fond animé · contrôles dans le menu WP" : "Objet de test · clic ou bouton ci-dessous")
        (label as NSString).draw(at: NSPoint(x: ProbeStyle.margin, y: ProbeStyle.margin),
                                withAttributes: [.font: ProbeStyle.body, .foregroundColor: ProbeStyle.text])
    }

    override func mouseDown(with event: NSEvent) {
        guard !isDesktop, state.interactive,
              objectRect.contains(convert(event.locationInWindow, from: nil)) else { return }
        selectObject?()
    }
}
