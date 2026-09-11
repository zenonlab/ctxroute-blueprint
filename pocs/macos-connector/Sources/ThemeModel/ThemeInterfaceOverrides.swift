import Foundation

public struct ThemeTargetOverride: Codable, Equatable, Sendable {
    public var selections: [String: String]
    public var session_id: String?

    public init(selections: [String: String] = [:], character: String? = nil,
                vehicle: String? = nil, sessionID: String? = nil) {
        self.selections = selections
        if let character { self.selections["character"] = character }
        if let vehicle { self.selections["vehicle"] = vehicle }
        session_id = sessionID
    }

    public var character: String? {
        get { selections["character"] }
        set { selections["character"] = newValue }
    }
    public var vehicle: String? {
        get { selections["vehicle"] }
        set { selections["vehicle"] = newValue }
    }
    public var isEmpty: Bool { selections.isEmpty && session_id == nil }

    private enum CodingKeys: String, CodingKey { case selections, character, vehicle, session_id }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        selections = try values.decodeIfPresent([String: String].self, forKey: .selections) ?? [:]
        if let character = try values.decodeIfPresent(String.self, forKey: .character) {
            selections["character"] = character
        }
        if let vehicle = try values.decodeIfPresent(String.self, forKey: .vehicle) {
            selections["vehicle"] = vehicle
        }
        session_id = try values.decodeIfPresent(String.self, forKey: .session_id)
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(selections, forKey: .selections)
        try values.encodeIfPresent(session_id, forKey: .session_id)
    }
}

public struct ThemeInterfaceOverrides: Codable, Equatable, Sendable {
    public let schema_version: Int
    public let theme_id: String
    public var targets: [String: ThemeTargetOverride]

    public init(themeID: String, targets: [String: ThemeTargetOverride] = [:]) {
        schema_version = 2
        theme_id = themeID
        self.targets = targets
    }

    public mutating func set(_ value: ThemeTargetOverride, for targetID: String) {
        if value.isEmpty {
            targets.removeValue(forKey: targetID)
        } else {
            targets[targetID] = value
        }
    }

    public func validated(for themeID: String, interface: ThemeInterfaceManifest) throws -> Self {
        let targetIDs = Set(interface.targets.map(\.id))
        let choices = Dictionary(grouping: interface.choices, by: { $0.kind.rawValue })
            .mapValues { Set($0.map(\.id)) }
        guard [1, 2].contains(schema_version), theme_id == themeID,
              targets.count <= interface.targets.count,
              Set(targets.keys).isSubset(of: targetIDs), targets.values.allSatisfy({ value in
                  value.selections.count <= 8
                      && value.selections.allSatisfy { kind, choice in
                          Self.validID(kind) && choices[kind]?.contains(choice) == true
                      }
                      && (value.session_id.map(Self.validID) ?? true)
              }) else { throw ModelError.invalid("invalid theme interface overrides") }
        return ThemeInterfaceOverrides(themeID: themeID, targets: targets)
    }

    private static func validID(_ value: String) -> Bool {
        value.range(of: "^[a-zA-Z][a-zA-Z0-9._-]{0,95}$", options: .regularExpression) != nil
    }
}

public struct ThemeInterfaceOverrideStore {
    private let directory: URL
    public init(directory: URL) { self.directory = directory }

    public func load(themeID: String, interface: ThemeInterfaceManifest) throws -> ThemeInterfaceOverrides {
        let empty = ThemeInterfaceOverrides(themeID: themeID)
        let url = directory.appendingPathComponent(themeID + ".interface.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return empty }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size <= 65_536 else {
            throw ModelError.invalid("invalid interface override file")
        }
        return try JSONDecoder().decode(ThemeInterfaceOverrides.self, from: Data(contentsOf: url))
            .validated(for: themeID, interface: interface)
    }

    public func save(_ overrides: ThemeInterfaceOverrides, interface: ThemeInterfaceManifest) throws {
        let checked = try overrides.validated(for: overrides.theme_id, interface: interface)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let url = directory.appendingPathComponent(checked.theme_id + ".interface.json")
        try JSONEncoder().encode(checked).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    public func reset(themeID: String, interface: ThemeInterfaceManifest) throws {
        try save(ThemeInterfaceOverrides(themeID: themeID), interface: interface)
    }
}
