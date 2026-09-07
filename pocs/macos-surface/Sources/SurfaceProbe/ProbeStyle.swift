import AppKit

@MainActor
enum ProbeStyle {
    static let space: CGFloat = 12
    static let margin: CGFloat = 24
    static let radius: CGFloat = 12
    static let sceneHeight: CGFloat = 230
    static let surface = NSColor.windowBackgroundColor
    static let text = NSColor.labelColor
    static let accent = NSColor.systemTeal
    static let track = NSColor.separatorColor
    static let body = NSFont.systemFont(ofSize: NSFont.systemFontSize)
    static let heading = NSFont.systemFont(ofSize: 22, weight: .semibold)
    static let frameInterval: TimeInterval = 1.0 / 30
}
