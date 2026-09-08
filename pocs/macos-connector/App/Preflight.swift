import AppKit

@MainActor enum Preflight {
    static func check(installing: Bool) throws {
        let process = Process(); let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-axo", "pid=,comm="]
        process.standardOutput = output
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw ModelError.invalid("Process inventory unavailable") }
        let paths = String(decoding: data, as: UTF8.self).split(separator: "\n").compactMap { line -> String? in
            let pair = line.trimmingCharacters(in: .whitespaces).split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
            guard pair.count == 2, let pid = Int32(pair[0]), pid != ProcessInfo.processInfo.processIdentifier else { return nil }
            return pair[1].trimmingCharacters(in: .whitespaces)
        }
        let conflicts = LaunchPolicy.conflicts(paths: paths, installing: installing, appPath: Bundle.main.bundlePath)
        guard conflicts.isEmpty else {
            throw NSError(domain: "ConnectorPreflight", code: 1, userInfo: [NSLocalizedDescriptionKey:
                "Prototype concurrent : \(Set(conflicts.map { URL(fileURLWithPath: $0).lastPathComponent }).sorted().joined(separator: ", ")). Quitter les compagnons et choisir un fond macOS avant de retirer les anciens providers. Aucun processus arrêté."])
        }
    }
}
