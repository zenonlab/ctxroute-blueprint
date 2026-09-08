import AppKit

/// Immutable geometry consumed by the active event tap. It deliberately owns no
/// NSWindow: the native wallpaper provider remains the sole desktop pixel plane.
struct DesktopInputSurface: Sendable {
    let theme: Theme
    let layout: SurfaceLayout
    let quartzBounds: CGRect
}

struct DesktopInputSnapshot: Sendable {
    let surfaces: [DesktopInputSurface]
    let finderPID: pid_t?

    static let empty = DesktopInputSnapshot(surfaces: [], finderPID: nil)

    @MainActor static func make(_ catalog: CatalogStatus?) -> DesktopInputSnapshot {
        guard let catalog else { return .empty }
        let finderPID = NSWorkspace.shared.runningApplications
            .first(where: { $0.bundleIdentifier == "com.apple.finder" })?.processIdentifier
        let surfaces = (catalog.layouts ?? []).compactMap { layout -> DesktopInputSurface? in
            guard layout.interactive, layout.valid, let display = layout.display_id,
                  let theme = catalog.theme(layout.theme_id)?.configuration,
                  let screen = NSScreen.screens.first(where: {
                      ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == display
                  }) else { return nil }
            let bounds = CGDisplayBounds(display)
            guard abs(bounds.width - layout.width) < 1, abs(bounds.height - layout.height) < 1,
                  abs(screen.frame.width - layout.width) < 1, abs(screen.frame.height - layout.height) < 1 else {
                return nil
            }
            return DesktopInputSurface(theme: theme, layout: layout, quartzBounds: bounds)
        }
        return DesktopInputSnapshot(surfaces: surfaces, finderPID: finderPID)
    }

    func target(at point: CGPoint, now: Double) -> (Theme, SurfaceLayout, ScenePoint)? {
        let matches = surfaces.compactMap { surface -> (Theme, SurfaceLayout, ScenePoint)? in
            guard surface.quartzBounds.contains(point) else { return nil }
            return (surface.theme, surface.layout,
                ScenePoint(x: point.x - surface.quartzBounds.minX, y: point.y - surface.quartzBounds.minY))
        }
        guard let first = matches.first,
              matches.allSatisfy({ $0.0 == first.0 && $0.2 == first.2 }),
              let layout = SurfaceLayout.consensus(matches.map(\.1), theme: first.0, point: first.2, now: now) else {
            return nil
        }
        return (first.0, layout, first.2)
    }
}
