import Foundation

public struct Theme: Codable, Equatable, Sendable {
    public struct Object: Codable, Equatable, Sendable {
        public let id: String
        public let color: String
        public let phase: Double
    }
    public struct Controls: Codable, Equatable, Sendable {
        public let placement: String
        public let items: [String]
    }
    public let schema_version: Int
    public let theme_id: String
    public let display_name: String
    public let panel_id: String
    public let background: String
    public let accent: String
    public let motion_path: String?
    public let period_seconds: Double
    public let objects: [Object]
    public let system_controls: Controls

    public static func load(bundle: Bundle? = nil, resource: String = "theme") throws -> Theme {
        #if SWIFT_PACKAGE
        let source = bundle ?? Bundle.module
        #else
        let source = bundle ?? Bundle.main
        #endif
        guard resource.range(of: "^[a-z-]+$", options: .regularExpression) != nil,
              let url = source.url(forResource: resource, withExtension: "json") else {
            throw ModelError.invalid("manifest missing")
        }
        return try decode(Data(contentsOf: url))
    }

    public static func catalog(bundle: Bundle? = nil) throws -> [Theme] {
        #if SWIFT_PACKAGE
        let source = bundle ?? Bundle.module
        #else
        let source = bundle ?? Bundle.main
        #endif
        guard let url = source.url(forResource: "catalog", withExtension: "json") else { throw ModelError.invalid("catalog missing") }
        let data = try Data(contentsOf: url)
        guard data.count <= 4096 else { throw ModelError.invalid("catalog size") }
        let names = try JSONDecoder().decode([String].self, from: data)
        guard (1...8).contains(names.count) else { throw ModelError.invalid("catalog count") }
        let themes = try names.map { try load(bundle: source, resource: $0) }
        guard Set(themes.map(\.theme_id)).count == themes.count else { throw ModelError.invalid("duplicate theme") }
        return themes
    }

    public static func decode(_ data: Data) throws -> Theme {
        guard data.count <= 32_768 else { throw ModelError.invalid("manifest too large") }
        let theme = try JSONDecoder().decode(Theme.self, from: data)
        guard theme.schema_version == 1,
              validID(theme.theme_id), validID(theme.panel_id),
              (1...80).contains(theme.display_name.count),
              (4...120).contains(theme.period_seconds),
              validColor(theme.background), validColor(theme.accent),
              [nil, "orbit", "wave", "still"].contains(theme.motion_path),
              (1...8).contains(theme.objects.count),
              Set(theme.objects.map(\.id)).count == theme.objects.count,
              theme.objects.allSatisfy({ validID($0.id) && validColor($0.color) && (0..<1).contains($0.phase) }),
              theme.system_controls.placement == "top_left",
              theme.system_controls.items == ["motion", "audio", "interaction", "desktop", "settings"]
        else { throw ModelError.invalid("manifest invariant") }
        return theme
    }

    private static func validID(_ value: String) -> Bool {
        value.range(of: "^[a-zA-Z][a-zA-Z0-9._-]{0,95}$", options: .regularExpression) != nil
    }
    private static func validColor(_ value: String) -> Bool {
        value.range(of: "^[0-9A-F]{6}$", options: .regularExpression) != nil
    }
}

public enum ModelError: Error { case invalid(String) }

public struct ThemeState: Codable, Equatable, Sendable {
    public var paused = false
    public var highlighted = false
    public init() {}
}

public enum ThemeAction: String, Codable, Sendable {
    case pause, resume, highlight, unhighlight, inspect
}

public struct Command: Codable, Equatable, Sendable {
    public let schema_version: Int
    public let theme_id: String
    public let scene_instance_id: UUID
    public let command_id: UUID
    public let generation: Int
    public let expires_at: Date
    public let action: ThemeAction
    public init(theme: String, instance: UUID, generation: Int, action: ThemeAction,
                id: UUID = UUID(), now: Date = Date()) {
        schema_version = 1; theme_id = theme; scene_instance_id = instance
        command_id = id; self.generation = generation; self.action = action
        expires_at = now.addingTimeInterval(5)
    }
}

public struct Receipt: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Sendable { case applied, rejected }
    public let command: Command
    public let status: Status
    public let state: ThemeState
    public let reason: String?
}

/// One provider process owns this state for all its native surfaces.
public struct Session: Sendable {
    public let instance: UUID
    public let themeID: String
    public private(set) var generation: Int = 0
    public private(set) var state = ThemeState()
    private var recent: [UUID: Receipt] = [:]
    private var order: [UUID] = []
    public init(themeID: String, instance: UUID = UUID()) {
        self.themeID = themeID; self.instance = instance
    }
    public mutating func apply(_ command: Command, now: Date = Date()) -> Receipt {
        if let receipt = recent[command.command_id] {
            return receipt.command == command ? receipt : reject(command, "id conflict")
        }
        guard command.schema_version == 1, command.theme_id == themeID,
              command.scene_instance_id == instance, command.generation == generation,
              command.expires_at >= now, command.expires_at <= now.addingTimeInterval(6)
        else { return reject(command, "stale or invalid command") }
        switch command.action {
        case .pause: state.paused = true
        case .resume: state.paused = false
        case .highlight: state.highlighted = true
        case .unhighlight: state.highlighted = false
        case .inspect: break
        }
        generation += 1
        let receipt = Receipt(command: command, status: .applied, state: state, reason: nil)
        recent[command.command_id] = receipt; order.append(command.command_id)
        if order.count > 32 { recent.removeValue(forKey: order.removeFirst()) }
        return receipt
    }
    private func reject(_ c: Command, _ reason: String) -> Receipt {
        Receipt(command: c, status: .rejected, state: state, reason: reason)
    }
}

public struct ProviderStatus: Codable, Sendable {
    public let theme_id: String
    public let instance: UUID
    public let generation: Int
    public let state: ThemeState
    public let surfaces: Int
    public let receipt: Receipt?
    public init(session: Session, surfaces: Int, receipt: Receipt? = nil) {
        theme_id = session.themeID; instance = session.instance; generation = session.generation
        state = session.state; self.surfaces = surfaces; self.receipt = receipt
    }
}

public struct CatalogStatus: Codable, Sendable {
    public let schema_version: Int
    public let themes: [ProviderStatus]
    public init(themes: [ProviderStatus]) { schema_version = 1; self.themes = themes }
    public func theme(_ id: String) -> ProviderStatus? {
        guard schema_version == 1, themes.count <= 8 else { return nil }
        return themes.first { $0.theme_id == id }
    }
}
