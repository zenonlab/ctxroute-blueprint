import Foundation
import QuartzCore

// Minimal compatibility fixtures: no XPC host, WallpaperAgent or visible window.
struct DisplayKey: Hashable { let displayID: UInt32 }
enum Lifecycle { static let queue = DispatchQueue(label: "diagnostic.render.tests") }
func extensionLog(_ message: String) {}

@main
enum RenderTests {
    static func main() {
        Lifecycle.queue.sync {
            let root = CALayer()
            root.bounds = CGRect(x: 0, y: 0, width: 1512, height: 982)
            colorDiagInstall(rootLayer: root, for: DisplayKey(displayID: 1))
            InteractiveDiagnostic.attach(to: root)
            let sweep = root.sublayers!.first { $0.name == "colorDiag.fill" }!
            let panel = root.sublayers!.first { $0.name == "interactive.panel" }!
            precondition(sweep.animation(forKey: "colorDiag.sweep") != nil)
            precondition(panel.isHidden)
            InteractiveDiagnostic.receive(.showPanel)
            precondition(!panel.isHidden)
            InteractiveDiagnostic.receive(.pause)
            let pausedTime = sweep.timeOffset
            precondition(sweep.speed == 0)
            InteractiveDiagnostic.receive(.pause)
            precondition(sweep.timeOffset == pausedTime)
            InteractiveDiagnostic.receive(.effectOn)
            precondition(sweep.borderWidth == 12 && sweep.speed == 0)
            InteractiveDiagnostic.receive(.resume)
            precondition(sweep.speed == 1 && sweep.timeOffset == 0)
            let resumedAt = sweep.beginTime
            InteractiveDiagnostic.receive(.resume)
            precondition(sweep.beginTime == resumedAt)
            InteractiveDiagnostic.receive(.reset)
            precondition(panel.isHidden && sweep.borderWidth == 0 && sweep.speed == 1)
            InteractiveDiagnostic.attach(to: root)
            precondition(root.sublayers!.filter { $0.name == "interactive.panel" }.count == 1)
            let small = CALayer()
            small.bounds = CGRect(x: 0, y: 0, width: 16, height: 16)
            InteractiveDiagnostic.attach(to: small)
            precondition(small.sublayers!.first!.bounds.width == 0)
        }
        print("PASS: 11 layer checks; direct dispatch only, no wallpaper registration or UI window")
    }
}
