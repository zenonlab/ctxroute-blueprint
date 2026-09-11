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
        var arguments = [theme.entry.path, "--desktop"]
        if let interface = theme.interface { arguments += ["--interface", interface.manifestURL.path] }
        return Self(executable: executable, arguments: arguments,
                    themeID: theme.package.id)
    }
}

@MainActor public final class RenderHostController {
    private var process: Process?
    private var input: FileHandle?
    private var output: Pipe?
    private var outputReader: RenderHostOutputReader?
    private var activeRequest: RenderHostLaunchRequest?
    private var controlGeneration: UInt64 = 0
    public private(set) var themeID: String?
    public var onHitSnapshot: ((RenderHostHitSnapshot) -> Void)?

    public init() {}

    @discardableResult
    public func activate(_ request: RenderHostLaunchRequest) throws -> Bool {
        if process?.isRunning == true, activeRequest == request { return false }
        stop()
        let process = Process()
        let input = Pipe()
        let output = Pipe()
        process.executableURL = request.executable
        process.arguments = request.arguments
        process.standardInput = input
        process.standardOutput = output
        let reader = RenderHostOutputReader { [weak self] snapshot in
            Task { @MainActor [weak self] in self?.onHitSnapshot?(snapshot) }
        }
        output.fileHandleForReading.readabilityHandler = { handle in
            reader.consume(handle.availableData)
        }
        try process.run()
        Thread.sleep(forTimeInterval: 0.15)
        guard process.isRunning else {
            process.waitUntilExit()
            throw ModelError.invalid("RenderHost exited during startup (status \(process.terminationStatus))")
        }
        self.process = process
        self.input = input.fileHandleForWriting
        self.output = output
        outputReader = reader
        activeRequest = request
        themeID = request.themeID
        return true
    }

    public func update(muted: Bool, desktopItemsVisible: Bool?, brightness: Double,
                       overrides: ThemeInterfaceOverrides? = nil) throws {
        guard process?.isRunning == true, let input else {
            throw ModelError.invalid("RenderHost is not running")
        }
        let state = try RenderHostControlState(generation: controlGeneration, muted: muted,
                                               desktopItemsVisible: desktopItemsVisible,
                                               brightness: brightness, overrides: overrides)
        var data = try JSONEncoder().encode(state)
        guard data.count <= 65_535 else { throw ModelError.invalid("RenderHost control state too large") }
        data.append(0x0a)
        try input.write(contentsOf: data)
        controlGeneration += 1
    }

    public func stop() {
        if process?.isRunning == true {
            process?.terminate()
            process?.waitUntilExit()
        }
        process = nil
        try? input?.close()
        output?.fileHandleForReading.readabilityHandler = nil
        try? output?.fileHandleForReading.close()
        input = nil
        output = nil
        outputReader = nil
        activeRequest = nil
        themeID = nil
        controlGeneration = 0
    }
}
