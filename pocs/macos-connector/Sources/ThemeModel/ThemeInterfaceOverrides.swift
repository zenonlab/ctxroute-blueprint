import Foundation

public struct ThemeTargetOverride: Codable, Equatable, Sendable {
    public var character: String?
    public var vehicle: String?
    public var session_id: String?

    public init(character: String? = nil, vehicle: String? = nil, sessionID: String? = nil) {
        self.character = character
        self.vehicle = vehicle
        session_id = sessionID
    }
}

public struct ThemeInterfaceOverrides: Codable, Equatable, Sendable {
    public let schema_version: Int
    public let theme_id: String
    public var targets: [String: ThemeTargetOverride]

    public init(themeID: String, targets: [String: ThemeTargetOverride] = [:]) {
        schema_version = 1
        theme_id = themeID
        self.targets = targets
    }

    public func validated(for themeID: String, interface: ThemeInterfaceManifest) throws -> Self {
        let targetIDs = Set(interface.targets.map(\.id))
        let characters = Set(interface.choices.filter { $0.kind == .character }.map(\.id))
        let vehicles = Set(interface.choices.filter { $0.kind == .vehicle }.map(\.id))
        guard schema_version == 1, theme_id == themeID, targets.count <= interface.targets.count,
              Set(targets.keys).isSubset(of: targetIDs), targets.values.allSatisfy({ value in
                  (value.character.map(characters.contains) ?? true)
                      && (value.vehicle.map(vehicles.contains) ?? true)
                      && (value.session_id.map(Self.validID) ?? true)
              }) else { throw ModelError.invalid("invalid theme interface overrides") }
        return self
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
