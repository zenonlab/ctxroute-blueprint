import Foundation

public struct InstalledTheme: Codable, Equatable, Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        public let format: String
        public let path: String
        public init(format: String, path: String) {
            self.format = format
            self.path = path
        }
    }

    public let format: String
    public let id: String
    public let display_name: String
    public let entry: Entry
    public let renderer: String
    public let thumbnail: String?
    public let interface: String?

    public init(format: String = "orbite.theme-package/1", id: String, displayName: String,
                entry: Entry, renderer: String, thumbnail: String? = nil, interface: String? = nil) {
        self.format = format
        self.id = id
        display_name = displayName
        self.entry = entry
        self.renderer = renderer
        self.thumbnail = thumbnail
        self.interface = interface
    }
}

public struct DiscoveredTheme: Codable, Equatable, Sendable {
    public let package: InstalledTheme
    public let descriptor: URL
    public let entry: URL
    public let thumbnail: URL?
    public let interface: ResolvedThemeInterface?

    public init(package: InstalledTheme, descriptor: URL, entry: URL, thumbnail: URL?,
                interface: ResolvedThemeInterface? = nil) {
        self.package = package
        self.descriptor = descriptor
        self.entry = entry
        self.thumbnail = thumbnail
        self.interface = interface
    }
}

public struct ThemeDiscoveryReceipt: Codable, Equatable, Sendable {
    public struct Rejection: Codable, Equatable, Sendable {
        public let descriptor: URL
        public let reason: String
    }
    public let themes: [DiscoveredTheme]
    public let rejected: [Rejection]
}

public enum ThemeDiscovery {
    public static let descriptorName = "orbite-theme.json"
    private static let maximumRoots = 16
    private static let maximumDescriptors = 256
    private static let maximumDescriptorBytes = 32_768
    private static let maximumEntryBytes = 1_048_576

    public static func discover(roots: [URL], fileManager: FileManager = .default) -> ThemeDiscoveryReceipt {
        guard !roots.isEmpty, roots.count <= maximumRoots else {
            return ThemeDiscoveryReceipt(themes: [], rejected: [])
        }
        var descriptors: [URL] = []
        for root in roots {
            guard root.isFileURL, root.path.hasPrefix("/"), !root.path.contains("\0"),
                  let values = try? root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
                  values.isDirectory == true, values.isSymbolicLink != true,
                  let enumerator = fileManager.enumerator(at: root,
                    includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
                    options: [.skipsHiddenFiles, .skipsPackageDescendants])
            else { continue }
            for case let candidate as URL in enumerator {
                guard descriptors.count < maximumDescriptors else { break }
                guard candidate.lastPathComponent == descriptorName,
                      let candidateValues = try? candidate.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
                      candidateValues.isRegularFile == true, candidateValues.isSymbolicLink != true
                else { continue }
                descriptors.append(candidate)
            }
        }
        var accepted: [DiscoveredTheme] = []
        var rejected: [ThemeDiscoveryReceipt.Rejection] = []
        for descriptor in descriptors.sorted(by: { $0.path < $1.path }) {
            do { accepted.append(try load(descriptor: descriptor)) }
            catch { rejected.append(.init(descriptor: descriptor, reason: String(describing: error))) }
        }
        var ids = Set<String>()
        accepted = accepted.filter { theme in
            guard ids.insert(theme.package.id).inserted else {
                rejected.append(.init(descriptor: theme.descriptor, reason: "duplicate theme id"))
                return false
            }
            return true
        }
        return ThemeDiscoveryReceipt(themes: accepted.sorted {
            ($0.package.display_name, $0.package.id) < ($1.package.display_name, $1.package.id)
        }, rejected: rejected.sorted { $0.descriptor.path < $1.descriptor.path })
    }

    public static func load(descriptor: URL) throws -> DiscoveredTheme {
        let root = descriptor.deletingLastPathComponent().resolvingSymlinksInPath()
        let package = try JSONDecoder().decode(InstalledTheme.self,
            from: bounded(descriptor, maximum: maximumDescriptorBytes))
        guard package.format == "orbite.theme-package/1", validID(package.id),
              (1...80).contains(package.display_name.count), safeText(package.display_name),
              validID(package.renderer), supportedEntryFormats.contains(package.entry.format)
        else { throw ModelError.invalid("invalid theme descriptor") }
        let entry = try contained(package.entry.path, root: root)
        let header = try JSONSerialization.jsonObject(with: bounded(entry, maximum: maximumEntryBytes)) as? [String: Any]
        guard header?["format"] as? String == package.entry.format else {
            throw ModelError.invalid("entry format mismatch")
        }
        let thumbnail = try package.thumbnail.map { try contained($0, root: root) }
        if let thumbnail {
            let values = try thumbnail.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard thumbnail.pathExtension.lowercased() == "png", values.isRegularFile == true,
                  values.isSymbolicLink != true, let size = values.fileSize, (1...16_777_216).contains(size)
            else { throw ModelError.invalid("bounded PNG thumbnail required") }
        }
        let interface = try package.interface.map { path in
            try ThemeInterfaceLoader.load(contained(path, root: root))
        }
        return DiscoveredTheme(package: package, descriptor: descriptor, entry: entry,
                               thumbnail: thumbnail, interface: interface)
    }

    private static let supportedEntryFormats = Set(["orbite.scene-probe/1", "orbite.theme-package/2"])

    private static func bounded(_ url: URL, maximum: Int) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size > 0, size <= maximum
        else { throw ModelError.invalid("ordinary bounded file required") }
        return try Data(contentsOf: url, options: .mappedIfSafe)
    }

    private static func contained(_ path: String, root: URL) throws -> URL {
        guard !path.isEmpty, path.utf8.count <= 240, !path.contains("\\"), !path.contains(":"),
              !path.hasPrefix("/"), !path.split(separator: "/").contains("..")
        else { throw ModelError.invalid("relative package path required") }
        let candidate = root.appendingPathComponent(path).resolvingSymlinksInPath()
        let prefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
        guard candidate.path.hasPrefix(prefix) else { throw ModelError.invalid("path escapes package") }
        return candidate
    }

    private static func validID(_ value: String) -> Bool {
        value.range(of: "^[a-zA-Z][a-zA-Z0-9._-]{0,95}$", options: .regularExpression) != nil
    }
    private static func safeText(_ value: String) -> Bool {
        !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }
}

public enum ThemeLibraries {
    public static let defaultsKey = "ThemeLibraryRoots"
    public static let environmentKey = "ORBITE_THEME_PATHS"

    public static func roots(defaults: UserDefaults = .standard,
                             environment: [String: String] = ProcessInfo.processInfo.environment,
                             fileManager: FileManager = .default) -> [URL] {
        var paths = defaults.stringArray(forKey: defaultsKey) ?? []
        if let configured = environment[environmentKey] {
            paths.append(contentsOf: configured.split(separator: ":").map(String.init))
        }
        let conventional = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Orbite/Themes", isDirectory: true)
        if fileManager.fileExists(atPath: conventional.path) { paths.append(conventional.path) }
        return Array(Set(paths)).sorted().compactMap { path in
            let url = URL(fileURLWithPath: path, isDirectory: true).resolvingSymlinksInPath()
            guard url.path.hasPrefix("/"),
                  let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
                  values.isDirectory == true, values.isSymbolicLink != true else { return nil }
            return url
        }
    }

    public static func add(_ root: URL, defaults: UserDefaults = .standard) throws {
        let root = root.resolvingSymlinksInPath()
        let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard root.isFileURL, root.path.hasPrefix("/"), values.isDirectory == true,
              values.isSymbolicLink != true else { throw ModelError.invalid("ordinary theme library required") }
        var paths = Set(defaults.stringArray(forKey: defaultsKey) ?? [])
        guard paths.count < 16 || paths.contains(root.path) else { throw ModelError.invalid("theme library limit") }
        paths.insert(root.path)
        defaults.set(paths.sorted(), forKey: defaultsKey)
    }
}
