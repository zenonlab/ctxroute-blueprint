import Foundation

/// Private local edits. Embedded signed resources are never modified.
public struct ThemeStore {
    private let directory: URL
    public init(directory: URL) { self.directory = directory }
    public func load(for theme: Theme) throws -> Theme? {
        _ = try Theme.decode(JSONEncoder().encode(theme))
        let url = directory.appendingPathComponent(theme.theme_id + ".json")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= 32_768 else {
            throw ModelError.invalid("Invalid local customization file")
        }
        let saved = try Theme.decode(Data(contentsOf: url))
        guard saved.theme_id == theme.theme_id else { throw ModelError.invalid("Local theme identity mismatch") }
        return saved
    }
    public func save(_ theme: Theme) throws {
        let data = try JSONEncoder().encode(theme)
        _ = try Theme.decode(data)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let url = directory.appendingPathComponent(theme.theme_id + ".json")
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
