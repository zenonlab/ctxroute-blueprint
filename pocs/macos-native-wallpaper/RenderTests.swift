import Foundation
import QuartzCore

// Minimal compatibility fixtures: no XPC host, WallpaperAgent or visible window.
struct DisplayKey: Hashable { let displayID: UInt32 }
enum Lifecycle { static let queue = DispatchQueue(label: "diagnostic.render.tests") }
func extensionLog(_ message: String) {}

@main
enum RenderTests {
    static func main() {
        let theme = try! DiagnosticTheme.load(url: URL(fileURLWithPath: CommandLine.arguments[1]))
        Lifecycle.queue.sync {
            let root = CALayer()
            root.bounds = CGRect(x: 0, y: 0, width: 1512, height: 982)
            colorDiagInstall(rootLayer: root, for: DisplayKey(displayID: 1))
            InteractiveDiagnostic.attach(to: root, theme: theme)
            let sweep = root.sublayers!.first { $0.name == "colorDiag.fill" }!
            let panel = root.sublayers!.first { $0.name == "interactive.panel" }!
            precondition(sweep.animation(forKey: "colorDiag.sweep") != nil)
            precondition(panel.isHidden)
            InteractiveDiagnostic.receive(.showPanel)
            precondition(!panel.isHidden)
            let actionLayers = panel.sublayers!.filter { $0.name?.hasPrefix("interactive.action.") == true && $0.name?.contains("label") == false }
            precondition(actionLayers.count == theme.actions.count)
            precondition(actionLayers.allSatisfy { panel.bounds.contains($0.frame) })
            let anchorLayers = root.sublayers!.filter { $0.name?.hasPrefix("interactive.anchor.") == true && $0.name?.contains("label") == false }
            precondition(anchorLayers.count == theme.anchors.count)
            precondition(anchorLayers.allSatisfy { root.bounds.contains($0.frame) })
            precondition(anchorLayers.allSatisfy { $0.opacity == 1 })
            precondition(anchorLayers.isEmpty)
            let vehicles = root.sublayers!.filter { $0.name?.hasPrefix("interactive.vehicle.") == true }
            precondition(vehicles.count == theme.vehicles.count)
            precondition(vehicles.allSatisfy { $0.animation(forKey: "interactive.vehicle.motion") != nil })
            InteractiveDiagnostic.receive(.pause)
            let pausedTime = sweep.timeOffset
            precondition(sweep.speed == 0)
            precondition(vehicles.allSatisfy { $0.speed == 0 })
            InteractiveDiagnostic.receive(.pause)
            precondition(sweep.timeOffset == pausedTime)
            InteractiveDiagnostic.receive(.effectOn)
            precondition(sweep.borderWidth == theme.sweep.effectWidth && sweep.speed == 0)
            InteractiveDiagnostic.receive(.resume)
            precondition(sweep.speed == 1 && sweep.timeOffset == 0)
            precondition(vehicles.allSatisfy { $0.speed == 1 && $0.timeOffset == 0 })
            let resumedAt = sweep.beginTime
            InteractiveDiagnostic.receive(.resume)
            precondition(sweep.beginTime == resumedAt)
            InteractiveDiagnostic.receive(.reset)
            precondition(panel.isHidden && sweep.borderWidth == 0 && sweep.speed == 1)
            InteractiveDiagnostic.attach(to: root, theme: theme)
            precondition(root.sublayers!.filter { $0.name == "interactive.panel" }.count == 1)
            let small = CALayer()
            small.bounds = CGRect(x: 0, y: 0, width: 16, height: 16)
            InteractiveDiagnostic.attach(to: small, theme: theme)
            let smallPanel = small.sublayers!.first { $0.name == "interactive.panel" }!
            precondition(smallPanel.frame.minX >= 0 && smallPanel.frame.maxX <= small.bounds.maxX)
        }
        print("PASS: 21 layer checks including native vehicles; no wallpaper registration or UI window")
    }
}
