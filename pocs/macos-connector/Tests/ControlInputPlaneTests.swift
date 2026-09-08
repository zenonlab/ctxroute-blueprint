import Foundation

func testDesktopInputSnapshot(theme: Theme) throws {
    let layout = SurfaceLayout(id: UUID(), theme: theme.theme_id, display: 7,
        width: 1512, height: 982, capturedAt: 10, elapsed: 2, running: false, interactive: true)
    let snapshot = DesktopInputSnapshot(surfaces: [DesktopInputSurface(theme: theme, layout: layout,
        quartzBounds: CGRect(x: 0, y: 0, width: 1512, height: 982))], finderPID: 42)
    guard let (resolvedTheme, resolvedLayout, point) = snapshot.target(at: CGPoint(x: 44, y: 76), now: 12),
          resolvedTheme == theme, resolvedLayout.id == layout.id,
          point == ScenePoint(x: 44, y: 76),
          ThemeLayout.hit(point, theme: theme, width: layout.width, height: layout.height,
            elapsed: layout.time(at: 12)) == .control(.audio),
          snapshot.target(at: CGPoint(x: 1513, y: 76), now: 12) == nil else {
        throw ModelError.invalid("desktop input snapshot projection")
    }
    print("desktop-input-snapshot=PASS cases=2 (pure geometry; no window shown)")
}
