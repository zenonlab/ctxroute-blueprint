import CoreGraphics
import Foundation

@main
enum HitTestingTests {
    static func main() throws {
        let theme = try DiagnosticTheme.load(url: URL(fileURLWithPath: CommandLine.arguments[1]))
        let bounds = CGRect(x: 0, y: 0, width: 1200, height: 780)
        let terminalPoint = CGPoint(x: 156, y: 109)
        precondition(DiagnosticHitTesting.command(at: terminalPoint, rootBounds: bounds,
            theme: theme, panelOpen: false, nativeContentHasPriority: false) == .showPanel)
        precondition(DiagnosticHitTesting.command(at: terminalPoint, rootBounds: bounds,
            theme: theme, panelOpen: false, nativeContentHasPriority: true) == nil)
        precondition(DiagnosticHitTesting.command(at: CGPoint(x: 600, y: 700), rootBounds: bounds,
            theme: theme, panelOpen: false, nativeContentHasPriority: false) == nil)

        let panel = theme.panel.normalizedFrame
        let pause = theme.actions.first { $0.command == .pause }!.normalizedFrame
        let pausePoint = CGPoint(x: bounds.width * (panel.x + panel.width * (pause.x + pause.width / 2)),
            y: bounds.height * (panel.y + panel.height * (pause.y + pause.height / 2)))
        precondition(DiagnosticHitTesting.command(at: pausePoint, rootBounds: bounds,
            theme: theme, panelOpen: true, nativeContentHasPriority: false) == .pause)
        precondition(DiagnosticHitTesting.command(at: pausePoint, rootBounds: bounds,
            theme: theme, panelOpen: false, nativeContentHasPriority: false) == nil)
        precondition(DiagnosticHitTesting.command(at: CGPoint(x: -1, y: -1), rootBounds: bounds,
            theme: theme, panelOpen: true, nativeContentHasPriority: false) == nil)
        print("PASS: 6 hit-testing checks; native desktop content always suppresses theme intent")
    }
}
