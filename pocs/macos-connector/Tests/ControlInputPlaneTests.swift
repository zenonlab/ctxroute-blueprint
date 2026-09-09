import AppKit

@MainActor func testDesktopInputSnapshot(theme: Theme) throws {
    let layout = SurfaceLayout(id: UUID(), theme: theme.theme_id, display: 7,
        width: 1512, height: 982, capturedAt: 10, elapsed: 2, running: false, interactive: true)
    let snapshot = DesktopInputSnapshot(surfaces: [DesktopInputSurface(theme: theme, layout: layout,
        quartzBounds: CGRect(x: 0, y: 0, width: 1512, height: 982), desktopItemsVisible: true)], finderPID: 42)
    guard let target = snapshot.target(at: CGPoint(x: 44, y: 76), now: 12),
          target.theme == theme, target.layout.id == layout.id,
          target.point == ScenePoint(x: 44, y: 76), target.desktopItemsVisible == true,
          ThemeLayout.hit(target.point, theme: theme, width: target.layout.width, height: target.layout.height,
            elapsed: target.layout.time(at: 12)) == .control(.audio),
          snapshot.target(at: CGPoint(x: 1513, y: 76), now: 12) == nil else {
        throw ModelError.invalid("desktop input snapshot projection")
    }
    guard DesktopEventTarget.isDesktop(nil),
          DesktopEventTarget.isDesktop(.init(id: 7, layer: -1)),
          !DesktopEventTarget.isDesktop(.init(id: 8, layer: 0)),
          !DesktopEventTarget.isDesktop(.init(id: 9, layer: 24)) else {
        throw ModelError.invalid("event target authority")
    }
    print("desktop-input-snapshot=PASS cases=6 (projection and event-window authority)")
}
