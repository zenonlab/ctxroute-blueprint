import Foundation

// Diagnostic-only messages: no payload, paths, process IDs or shell commands.
// Darwin notifications are not authenticated: never use this channel for privileges.
enum DiagnosticCommand: String, CaseIterable, Sendable {
    case showPanel, hidePanel, pause, resume, effectOn, effectOff, reset
    static let prefix = "org.wallpaperthemes.nativeprobe.controls.visual."
    var notification: String { Self.prefix + rawValue }
    init?(notification: String) {
        guard notification.hasPrefix(Self.prefix) else { return nil }
        self.init(rawValue: String(notification.dropFirst(Self.prefix.count)))
    }
}

// A receipt confirms only that the extension applied the named visual command.
// It carries no user data and is intentionally separate from the request name.
struct DiagnosticReceipt: Equatable, Sendable {
    static let prefix = "org.wallpaperthemes.nativeprobe.controls.receipt."
    let command: DiagnosticCommand

    init(_ command: DiagnosticCommand) { self.command = command }

    var notification: String { Self.prefix + command.rawValue }

    init?(notification: String) {
        guard notification.hasPrefix(Self.prefix),
              let command = DiagnosticCommand(rawValue: String(notification.dropFirst(Self.prefix.count))) else {
            return nil
        }
        self.command = command
    }
}

struct DiagnosticState: Equatable, Sendable {
    var panelOpen = false
    var paused = false
    var effectEnabled = false

    mutating func apply(_ command: DiagnosticCommand) {
        switch command {
        case .showPanel: panelOpen = true
        case .hidePanel: panelOpen = false
        case .pause: paused = true
        case .resume: paused = false
        case .effectOn: effectEnabled = true
        case .effectOff: effectEnabled = false
        case .reset: self = DiagnosticState()
        }
    }
}
