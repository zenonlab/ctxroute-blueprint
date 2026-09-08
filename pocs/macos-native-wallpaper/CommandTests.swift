import Foundation

@main
enum CommandTests {
    static func main() {
        var state = DiagnosticState()
        for command in DiagnosticCommand.allCases {
            precondition(DiagnosticCommand(notification: command.notification) == command)
            let receipt = DiagnosticReceipt(command)
            precondition(DiagnosticReceipt(notification: receipt.notification) == receipt)
            state.apply(command)
            let once = state
            state.apply(command)
            precondition(state == once, "Commands must be idempotent")
        }
        for invalid in ["", "pause", DiagnosticCommand.prefix + "shell", "other.visual.pause"] {
            precondition(DiagnosticCommand(notification: invalid) == nil)
            precondition(DiagnosticReceipt(notification: invalid) == nil)
        }
        precondition(DiagnosticReceipt(notification: DiagnosticReceipt.prefix + "shell") == nil)
        state.apply(.showPanel); state.apply(.pause); state.apply(.effectOn)
        precondition(state.panelOpen && state.paused && state.effectEnabled)
        state.apply(.hidePanel)
        precondition(!state.panelOpen && state.paused && state.effectEnabled)
        state.apply(.resume); state.apply(.effectOff)
        precondition(state == DiagnosticState())
        state.apply(.pause); state.apply(.reset)
        precondition(state == DiagnosticState())
        print("PASS: 34 command/receipt/state checks; no AppKit, input observation or notifications executed")
    }
}
