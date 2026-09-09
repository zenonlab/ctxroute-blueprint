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
    guard let screen = NSScreen.screens.first,
          let display = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value else {
        throw ModelError.invalid("native screen unavailable")
    }
    let hiddenLayout = SurfaceLayout(id: UUID(), theme: theme.theme_id, display: display,
        width: screen.frame.width, height: screen.frame.height, capturedAt: 10, elapsed: 2,
        running: false, interactive: true)
    let hidden = DesktopInputSnapshot(surfaces: [DesktopInputSurface(theme: theme, layout: hiddenLayout,
        quartzBounds: screen.frame, desktopItemsVisible: false)], finderPID: nil)
    let targets = HiddenDesktopInputPlane.targets(snapshot: hidden, now: 12)
    guard targets.count == theme.system_controls.items.count + theme.objects.count,
          targets.contains(where: { $0.intent == .toggle(.audio) }),
          targets.contains(where: { $0.intent == .toggle(.desktopItems) }),
          targets.contains(where: {
              if case .activate = $0.intent { return true }
              return false
          }) else { throw ModelError.invalid("hidden input proxy plan") }
    print("desktop-input-snapshot=PASS cases=5 (projection and hidden proxy plan; no window shown)")
}
