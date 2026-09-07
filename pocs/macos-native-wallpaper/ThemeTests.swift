import Foundation

@main
enum ThemeTests {
    static func main() throws {
        let source = URL(fileURLWithPath: CommandLine.arguments[1])
        let theme = try DiagnosticTheme.load(url: source)
        precondition(theme.schemaVersion == 1)
        precondition(theme.sceneID.uuidString == "22222222-2222-4222-8222-222222222222")
        precondition(theme.actions.count == 7)
        precondition(Set(theme.actions.map(\.command)) == Set(DiagnosticCommand.allCases))
        precondition(theme.actions.allSatisfy { $0.normalizedFrame.x + $0.normalizedFrame.width <= 1 })
        precondition(theme.anchors.count == 3)
        precondition(theme.panel.normalizedFrame.x + theme.panel.normalizedFrame.width <= 1)

        let original = try String(contentsOf: source, encoding: .utf8)
        let cases = [
            original.replacingOccurrences(of: "\"schemaVersion\": 1", with: "\"schemaVersion\": 2"),
            original.replacingOccurrences(of: "\"red\": 0.0", with: "\"red\": 2.0"),
            original.replacingOccurrences(of: "\"width\": 0.36", with: "\"width\": 0.80"),
            original.replacingOccurrences(of: "\"durationSeconds\": 2.5", with: "\"durationSeconds\": 0"),
            original.replacingOccurrences(of: "\"command\": \"reset\"", with: "\"command\": \"pause\""),
            original.replacingOccurrences(of: "\"x\": 0.28, \"y\": 0.01", with: "\"x\": 0.80, \"y\": 0.01"),
            original.replacingOccurrences(of: "\"x\": 0.28, \"y\": 0.01", with: "\"x\": 0.04, \"y\": 0.14"),
            original.replacingOccurrences(of: "\"actionID\": \"reset\"", with: "\"actionID\": \"unknown\"")
        ]
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("wallpaper-theme-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        for (index, invalid) in cases.enumerated() {
            let url = directory.appendingPathComponent("invalid-\(index).json")
            try invalid.write(to: url, atomically: true, encoding: .utf8)
            do {
                _ = try DiagnosticTheme.load(url: url)
                preconditionFailure("Invalid fixture \(index) was accepted")
            } catch {}
        }
        print("PASS: 14 theme asset checks; invalid identity, color, frame, duration, actions and anchors rejected")
    }
}
