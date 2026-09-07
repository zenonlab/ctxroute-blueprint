import CoreGraphics

enum DiagnosticHitTesting {
    static func command(at point: CGPoint, rootBounds: CGRect, theme: DiagnosticTheme,
        panelOpen: Bool, nativeContentHasPriority: Bool) -> DiagnosticCommand? {
        guard rootBounds.contains(point), !nativeContentHasPriority else { return nil }
        for anchor in theme.anchors {
            if absolute(anchor.normalizedFrame, in: rootBounds).contains(point) {
                return theme.action(id: anchor.actionID)?.command
            }
        }
        guard panelOpen else { return nil }
        let panel = absolute(theme.panel.normalizedFrame, in: rootBounds)
        guard panel.contains(point) else { return nil }
        let local = CGPoint(x: point.x - panel.minX, y: point.y - panel.minY)
        let localBounds = CGRect(origin: .zero, size: panel.size)
        for action in theme.actions where absolute(action.normalizedFrame, in: localBounds).contains(local) {
            return action.command
        }
        return nil
    }

    private static func absolute(_ frame: DiagnosticTheme.NormalizedFrame, in bounds: CGRect) -> CGRect {
        CGRect(x: bounds.minX + bounds.width * frame.x, y: bounds.minY + bounds.height * frame.y,
            width: bounds.width * frame.width, height: bounds.height * frame.height)
    }
}
