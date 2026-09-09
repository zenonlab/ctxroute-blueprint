import CoreGraphics
import Foundation

func testDesktopVisibilityPolicy() throws {
    let left = CGRect(x: 0, y: 0, width: 1512, height: 982)
    let right = CGRect(x: 1512, y: 0, width: 1920, height: 1080)
    func window(_ bounds: CGRect, pid: pid_t = 50, layer: Int = 0,
                alpha: Double = 1) -> DesktopCoverageWindow {
        DesktopCoverageWindow(ownerPID: pid, layer: layer, alpha: alpha, bounds: bounds)
    }
    guard DesktopVisibilityPolicy.visible(displays: [], windows: [], excludedPIDs: []) == nil,
          DesktopVisibilityPolicy.visible(displays: [left], windows: [], excludedPIDs: []) == true,
          DesktopVisibilityPolicy.visible(displays: [left], windows: [window(left)], excludedPIDs: []) == false,
          DesktopVisibilityPolicy.visible(displays: [left], windows: [window(left, pid: 7)], excludedPIDs: [7]) == true,
          DesktopVisibilityPolicy.visible(displays: [left], windows: [window(left, layer: 1)], excludedPIDs: []) == true,
          DesktopVisibilityPolicy.visible(displays: [left], windows: [window(left, alpha: 0.98)], excludedPIDs: []) == true,
          DesktopVisibilityPolicy.visible(displays: [left], windows: [window(left.insetBy(dx: 20, dy: 20))], excludedPIDs: []) == true,
          DesktopVisibilityPolicy.visible(displays: [left, right], windows: [window(left)], excludedPIDs: []) == true,
          DesktopVisibilityPolicy.visible(displays: [left, right], windows: [window(left), window(right)], excludedPIDs: []) == false,
          DesktopVisibilityPolicy.visible(displays: [left], windows: [
              window(CGRect(x: 0, y: 0, width: 1512, height: 100)),
              window(CGRect(x: 0, y: 100, width: 1512, height: 882))
          ], excludedPIDs: []) == false,
          DesktopVisibilityPolicy.visible(displays: [left], windows: [
              window(CGRect(x: 0, y: 0, width: 1512, height: 400), pid: 50),
              window(CGRect(x: 0, y: 400, width: 1512, height: 582), pid: 51)
          ], excludedPIDs: []) == true
    else { throw ModelError.invalid("desktop visibility policy") }
    print("desktop-visibility=PASS cases=11 (pure policy, no window mutation)")
}
