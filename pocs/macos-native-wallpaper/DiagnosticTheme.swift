import Foundation

struct DiagnosticTheme: Decodable, Sendable {
    struct Color: Decodable, Sendable {
        let red: Double
        let green: Double
        let blue: Double
        let alpha: Double
        var components: [Double] { [red, green, blue, alpha] }
    }
    struct NormalizedFrame: Decodable, Sendable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }
    struct Sweep: Decodable, Sendable {
        let color: Color
        let durationSeconds: Double
        let effectColor: Color
        let effectWidth: Double
    }
    struct Panel: Decodable, Sendable {
        let title: String
        let normalizedFrame: NormalizedFrame
        let color: Color
    }
    struct Action: Decodable, Sendable {
        let id: String
        let label: String
        let command: DiagnosticCommand
        let normalizedFrame: NormalizedFrame
    }
    struct Anchor: Decodable, Sendable {
        let id: String
        let label: String
        let actionID: String
        let normalizedFrame: NormalizedFrame
    }

    let schemaVersion: Int
    let themeID: String
    let sceneID: UUID
    let displayName: String
    let background: Color
    let sweep: Sweep
    let panel: Panel
    let actions: [Action]
    let anchors: [Anchor]

    static func load(bundle: Bundle = .main) throws -> DiagnosticTheme {
        guard let url = bundle.url(forResource: "interactive-theme", withExtension: "json") else {
            throw ThemeError.missingAsset
        }
        return try load(url: url)
    }

    static func load(url: URL) throws -> DiagnosticTheme {
        let theme = try JSONDecoder().decode(DiagnosticTheme.self, from: Data(contentsOf: url))
        try theme.validate()
        return theme
    }

    func validate() throws {
        guard schemaVersion == 1, !themeID.isEmpty, !displayName.isEmpty else { throw ThemeError.invalidIdentity }
        let colors = [background, sweep.color, sweep.effectColor, panel.color]
        guard colors.allSatisfy({ $0.components.allSatisfy { $0.isFinite && (0...1).contains($0) } }) else {
            throw ThemeError.invalidColor
        }
        let frame = panel.normalizedFrame
        guard [frame.x, frame.y, frame.width, frame.height].allSatisfy(\.isFinite),
              frame.x >= 0, frame.y >= 0, frame.width > 0, frame.height > 0,
              frame.x + frame.width <= 1, frame.y + frame.height <= 1 else { throw ThemeError.invalidFrame }
        guard sweep.durationSeconds.isFinite, sweep.durationSeconds > 0,
              sweep.effectWidth.isFinite, sweep.effectWidth >= 0 else { throw ThemeError.invalidSweep }
        guard actions.count == DiagnosticCommand.allCases.count,
              Set(actions.map(\.id)).count == actions.count,
              Set(actions.map(\.command)) == Set(DiagnosticCommand.allCases),
              actions.allSatisfy({ !$0.id.isEmpty && !$0.label.isEmpty && Self.isValid($0.normalizedFrame) }) else {
            throw ThemeError.invalidActions
        }
        for first in actions.indices {
            for second in actions.indices where second > first {
                guard !Self.intersects(actions[first].normalizedFrame, actions[second].normalizedFrame) else {
                    throw ThemeError.invalidActions
                }
            }
        }
        let actionIDs = Set(actions.map(\.id))
        guard !anchors.isEmpty, Set(anchors.map(\.id)).count == anchors.count,
              anchors.allSatisfy({ !$0.id.isEmpty && !$0.label.isEmpty
                  && actionIDs.contains($0.actionID) && Self.isValid($0.normalizedFrame) }) else {
            throw ThemeError.invalidAnchors
        }
        for first in anchors.indices {
            for second in anchors.indices where second > first {
                guard !Self.intersects(anchors[first].normalizedFrame, anchors[second].normalizedFrame) else {
                    throw ThemeError.invalidAnchors
                }
            }
        }
    }

    private static func isValid(_ frame: NormalizedFrame) -> Bool {
        [frame.x, frame.y, frame.width, frame.height].allSatisfy(\.isFinite)
            && frame.x >= 0 && frame.y >= 0 && frame.width > 0 && frame.height > 0
            && frame.x + frame.width <= 1 && frame.y + frame.height <= 1
    }

    private static func intersects(_ left: NormalizedFrame, _ right: NormalizedFrame) -> Bool {
        left.x < right.x + right.width && right.x < left.x + left.width
            && left.y < right.y + right.height && right.y < left.y + left.height
    }

    func action(id: String) -> Action? { actions.first { $0.id == id } }

    enum ThemeError: Error {
        case missingAsset, invalidIdentity, invalidColor, invalidFrame, invalidSweep, invalidActions, invalidAnchors
    }
}

extension DiagnosticCommand: Codable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        guard let command = DiagnosticCommand(rawValue: value) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                debugDescription: "Unknown diagnostic command: \(value)"))
        }
        self = command
    }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}
