import Foundation

public enum RenderHostRegistry {
    public static let defaultsKey = "RenderHostExecutables"

    public static func register(renderer: String, executable: URL,
                                defaults: UserDefaults = .standard,
                                fileManager: FileManager = .default) throws {
        guard validID(renderer) else { throw ModelError.invalid("invalid renderer capability") }
        let candidate = executable.standardizedFileURL
        let candidateValues = try candidate.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard candidate.isFileURL, candidate.path.hasPrefix("/"), candidateValues.isRegularFile == true,
              candidateValues.isSymbolicLink != true, fileManager.isExecutableFile(atPath: candidate.path)
        else { throw ModelError.invalid("ordinary executable RenderHost required") }
        let executable = candidate.resolvingSymlinksInPath()
        var registrations = defaults.dictionary(forKey: defaultsKey) as? [String: String] ?? [:]
        registrations[renderer] = executable.path
        defaults.set(registrations, forKey: defaultsKey)
    }

    public static func resolve(renderer: String, defaults: UserDefaults = .standard,
                               fileManager: FileManager = .default) throws -> URL {
        guard validID(renderer),
              let registrations = defaults.dictionary(forKey: defaultsKey) as? [String: String],
              let path = registrations[renderer], path.hasPrefix("/"), !path.contains("\0")
        else { throw ModelError.invalid("no approved RenderHost for \(renderer)") }
        let executable = URL(fileURLWithPath: path).standardizedFileURL
        let values = try executable.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              fileManager.isExecutableFile(atPath: executable.path)
        else { throw ModelError.invalid("approved RenderHost is unavailable") }
        return executable
    }

    private static func validID(_ value: String) -> Bool {
        value.range(of: "^[a-zA-Z][a-zA-Z0-9._-]{0,95}$", options: .regularExpression) != nil
    }
}

public struct RenderHostLaunchRequest: Equatable, Sendable {
    public let executable: URL
    public let arguments: [String]
    public let themeID: String

    public static func desktop(theme: DiscoveredTheme, defaults: UserDefaults = .standard,
                               fileManager: FileManager = .default) throws -> Self {
        let executable = try RenderHostRegistry.resolve(renderer: theme.package.renderer,
                                                        defaults: defaults, fileManager: fileManager)
        return Self(executable: executable, arguments: [theme.entry.path, "--desktop"],
                    themeID: theme.package.id)
    }
}

@MainActor public final class RenderHostController {
    private var process: Process?
    private var activeRequest: RenderHostLaunchRequest?
    public private(set) var themeID: String?

    public init() {}

    @discardableResult
    public func activate(_ request: RenderHostLaunchRequest) throws -> Bool {
        if process?.isRunning == true, activeRequest == request { return false }
        stop()
        let process = Process()
        process.executableURL = request.executable
        process.arguments = request.arguments
        try process.run()
        self.process = process
        activeRequest = request
        themeID = request.themeID
        return true
    }

    public func stop() {
        if process?.isRunning == true {
            process?.terminate()
            process?.waitUntilExit()
        }
        process = nil
        activeRequest = nil
        themeID = nil
    }
}
