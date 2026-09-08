import Foundation

enum AgentLauncher {
    static func matches(_ configuration: [String: Any], executable: String, service: String) -> Bool {
        let allowed: Set<String> = ["Label", "ProgramArguments", "MachServices", "LimitLoadToSessionType",
                                    "RunAtLoad", "KeepAlive", "ThrottleInterval"]
        guard Set(configuration.keys).isSubset(of: allowed),
              configuration["Label"] as? String == service,
              configuration["LimitLoadToSessionType"] as? String == "Aqua",
              configuration["MachServices"] as? [String: Bool] == [service: true],
              let arguments = configuration["ProgramArguments"] as? [String] else { return false }
        return arguments == [executable, "--agent"] || arguments == [executable, "--agent", "--diagnostics"]
    }

    static func start(app: URL, service: String) throws -> Bool {
        let domain = "gui/\(getuid())"
        if try run(["kickstart", "\(domain)/\(service)"]) == 0 { return true }
        let job = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(service).plist")
        guard (try? job.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == false,
              let data = try? Data(contentsOf: job), data.count <= 16_384,
              let configuration = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              matches(configuration, executable: app.appendingPathComponent(
                "Contents/Library/LoginItems/Wallpaper Connector Agent.app/Contents/MacOS/WallpaperConnector").path,
                service: service) else { return false }
        guard try run(["bootstrap", domain, job.path]) == 0 else { return false }
        return try run(["kickstart", "\(domain)/\(service)"]) == 0
    }

    private static func run(_ arguments: [String]) throws -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        try process.run(); process.waitUntilExit()
        return process.terminationStatus
    }
}
