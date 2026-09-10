import Foundation

public enum PortableRole: String, Codable, CaseIterable, Sendable {
    case themeAudio = "theme.audio"
    case desktopFiles = "desktop.files"
    case sessionFocus = "session.focus"
    case objectLaunch = "object.launch"
    case themeEdit = "theme.edit"
}

public struct AppearanceOverride: Codable, Equatable, Sendable {
    public var character: String?
    public var vehicle: String?
    public var color: String?
    public var texture: String?
    public var icon: String?
    public var animation: String?
    public init(character: String? = nil, vehicle: String? = nil, color: String? = nil,
                texture: String? = nil, icon: String? = nil, animation: String? = nil) {
        self.character = character; self.vehicle = vehicle; self.color = color
        self.texture = texture; self.icon = icon; self.animation = animation
    }
}

public struct Theme: Codable, Equatable, Sendable {
    public struct Object: Codable, Equatable, Sendable {
        public let id: String
        public var color: String
        public let phase: Double
        public var label: String?
        public var application_bundle_id: String?
        public var x: Double?
        public var y: Double?
        public var size: Double?
        public var character: String?
        public var vehicle: String?
        public var texture: String?
        public var icon: String?
        public var animation: String?
        public var role: PortableRole?
        public init(id: String, color: String, phase: Double, label: String? = nil,
                    application: String? = nil, x: Double? = nil, y: Double? = nil, size: Double? = nil,
                    character: String? = nil, vehicle: String? = nil, texture: String? = nil,
                    icon: String? = nil, animation: String? = nil, role: PortableRole? = nil) {
            self.id = id; self.color = color; self.phase = phase; self.label = label
            application_bundle_id = application; self.x = x; self.y = y; self.size = size
            self.character = character; self.vehicle = vehicle; self.texture = texture
            self.icon = icon; self.animation = animation; self.role = role
        }
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
    public let background_asset: String?
    public let accent: String
    public let motion_path: String?
    public let period_seconds: Double
    public var objects: [Object]
    public let system_controls: Controls

    public static func decode(_ data: Data) throws -> Theme {
        guard data.count <= 32_768 else { throw ModelError.invalid("manifest too large") }
        let theme = try JSONDecoder().decode(Theme.self, from: data)
        guard theme.schema_version == 1,
              validID(theme.theme_id), validID(theme.panel_id),
              (1...80).contains(theme.display_name.count),
              (4...120).contains(theme.period_seconds),
              validColor(theme.background), validColor(theme.accent),
              (theme.background_asset.map { validAssetName($0) } ?? true),
              [nil, "orbit", "wave", "still"].contains(theme.motion_path),
              (1...8).contains(theme.objects.count),
              Set(theme.objects.map(\.id)).count == theme.objects.count,
              theme.objects.allSatisfy({ object in
                  validID(object.id) && validColor(object.color) && (0..<1).contains(object.phase)
                  && (object.label.map { (1...40).contains($0.count) && !$0.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) } ?? true)
                  && (object.application_bundle_id.map { validID($0) } ?? true)
                  && ((object.x == nil && object.y == nil) ||
                      (object.x.map { (0.05...0.95).contains($0) } == true && object.y.map { (0.05...0.95).contains($0) } == true))
                  && (object.size.map { (24...96).contains($0) } ?? true)
                  && [object.character, object.vehicle, object.animation].allSatisfy({ $0.map(validID) ?? true })
                  && [object.texture, object.icon].allSatisfy({ $0.map(validAssetName) ?? true })
              }),
              theme.system_controls.placement == "top_left",
              (1...7).contains(theme.system_controls.items.count),
              Set(theme.system_controls.items).count == theme.system_controls.items.count,
              theme.system_controls.items.allSatisfy({ ["motion", "audio", "interaction", "desktop", "settings", "profile", "overlay"].contains($0) })
        else { throw ModelError.invalid("manifest invariant") }
        return theme
    }

    public func applying(_ appearance: AppearanceOverride, to objectID: String) throws -> Theme {
        guard let index = objects.firstIndex(where: { $0.id == objectID }) else {
            throw ModelError.invalid("unknown object")
        }
        var result = self
        if let value = appearance.character { result.objects[index].character = value }
        if let value = appearance.vehicle { result.objects[index].vehicle = value }
        if let value = appearance.color { result.objects[index].color = value }
        if let value = appearance.texture { result.objects[index].texture = value }
        if let value = appearance.icon { result.objects[index].icon = value }
        if let value = appearance.animation { result.objects[index].animation = value }
        return try Theme.decode(JSONEncoder().encode(result))
    }

    private static func validID(_ value: String) -> Bool {
        value.range(of: "^[a-zA-Z][a-zA-Z0-9._-]{0,95}$", options: .regularExpression) != nil
    }
    private static func validColor(_ value: String) -> Bool {
        value.range(of: "^[0-9A-F]{6}$", options: .regularExpression) != nil
    }
    private static func validAssetName(_ value: String) -> Bool {
        value.range(of: "^[a-z][a-z0-9-]{0,63}\\.png$", options: .regularExpression) != nil
    }
}

public struct ThemeState: Codable, Equatable, Sendable {
    public var paused = false
    public var highlighted = false
    public var muted = true
    public var desktopItemsVisible: Bool?
    public var wallpaperVisible: Bool?
    public init() {}
}

public enum ThemeAction: String, Codable, Sendable {
    case pause, resume, highlight, unhighlight, inspect, configure, mute, unmute
    case desktopItemsVisible, desktopItemsHidden, desktopItemsUnknown
    case wallpaperVisible, wallpaperOccluded, wallpaperVisibilityUnknown
}

public struct Command: Codable, Equatable, Sendable {
    public let schema_version: Int
    public let theme_id: String
    public let scene_instance_id: UUID
    public let command_id: UUID
    public let generation: Int
    public let expires_at: Date
    public let action: ThemeAction
    public let configuration: Theme?
    public init(theme: String, instance: UUID, generation: Int, action: ThemeAction,
                id: UUID = UUID(), now: Date = Date(), configuration: Theme? = nil) {
        schema_version = 1; theme_id = theme; scene_instance_id = instance
        command_id = id; self.generation = generation; self.action = action
        expires_at = now.addingTimeInterval(5)
        self.configuration = configuration
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
    private var lastReceipt: Receipt?
    private var receiptTime: Date?
    public init(themeID: String, instance: UUID = UUID()) {
        self.themeID = themeID; self.instance = instance
    }
    public mutating func apply(_ command: Command, now: Date = Date()) -> Receipt {
        let receipt = evaluate(command, now: now)
        lastReceipt = receipt; receiptTime = now
        return receipt
    }
    public func receipt(now: Date = Date()) -> Receipt? {
        guard let receiptTime, (0...30).contains(now.timeIntervalSince(receiptTime)) else { return nil }
        return lastReceipt
    }
    private mutating func evaluate(_ command: Command, now: Date) -> Receipt {
        if let receipt = recent[command.command_id] {
            return receipt.command == command ? receipt : reject(command, "id conflict")
        }
        guard command.schema_version == 1, command.theme_id == themeID,
              command.scene_instance_id == instance, command.generation == generation,
              command.expires_at >= now, command.expires_at <= now.addingTimeInterval(6)
        else { return reject(command, "stale or invalid command") }
        if command.action == .configure {
            guard let configuration = command.configuration, configuration.theme_id == themeID,
                  let data = try? JSONEncoder().encode(configuration), (try? Theme.decode(data)) != nil
            else { return reject(command, "invalid configuration") }
        } else if command.configuration != nil { return reject(command, "unexpected configuration") }
        switch command.action {
        case .pause: state.paused = true
        case .resume: state.paused = false
        case .highlight: state.highlighted = true
        case .unhighlight: state.highlighted = false
        case .inspect: break
        case .configure: break
        case .mute: state.muted = true
        case .unmute: state.muted = false
        case .desktopItemsVisible: state.desktopItemsVisible = true
        case .desktopItemsHidden: state.desktopItemsVisible = false
        case .desktopItemsUnknown: state.desktopItemsVisible = nil
        case .wallpaperVisible: state.wallpaperVisible = true
        case .wallpaperOccluded: state.wallpaperVisible = false
        case .wallpaperVisibilityUnknown: state.wallpaperVisible = nil
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
    public let configuration: Theme?
    public init(session: Session, surfaces: Int, receipt: Receipt? = nil, now: Date = Date(), configuration: Theme? = nil) {
        theme_id = session.themeID; instance = session.instance; generation = session.generation
        state = session.state; self.surfaces = surfaces; self.receipt = receipt ?? session.receipt(now: now)
        self.configuration = configuration
    }
}

public struct CatalogStatus: Codable, Sendable {
    public let schema_version: Int
    public let themes: [ProviderStatus]
    public let layouts: [SurfaceLayout]?
    public init(themes: [ProviderStatus], layouts: [SurfaceLayout] = []) {
        schema_version = 1; self.themes = themes; self.layouts = layouts
    }
    public func theme(_ id: String) -> ProviderStatus? {
        guard schema_version == 1, themes.count <= 8 else { return nil }
        return themes.first { $0.theme_id == id }
    }
}
