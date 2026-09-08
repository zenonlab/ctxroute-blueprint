import Foundation

func extensionLog(_ text: String) { FileHandle.standardError.write(Data((text + "\n").utf8)) }

@main @MainActor enum NativeCatalogTest {
    static func main() {
        do { try run() } catch { extensionLog("native-catalog=FAIL \(error)"); exit(EXIT_FAILURE) }
    }
    static func run() throws {
        var recoveryCases = 0
        for trusted in [false, true] {
            for awake in [false, true] {
                for active in [false, true] {
                    for initiallyEnabled in [false, true] {
                        var enabled = initiallyEnabled
                        var calls = 0
                        let result = DesktopInput.restoreExistingTap(trusted: trusted, awake: awake,
                            active: active, isEnabled: { enabled }, enable: { calls += 1; enabled = true })
                        let allowed = trusted && awake && active
                        guard result == allowed, calls == (allowed && !initiallyEnabled ? 1 : 0) else {
                            throw ModelError.invalid("tap recovery bypass or redundant enable")
                        }
                        recoveryCases += 1
                    }
                }
            }
        }
        var attempts = 0
        guard !DesktopInput.restoreExistingTap(trusted: true, awake: true, active: true,
            isEnabled: { false }, enable: { attempts += 1 }), attempts == 1 else {
            throw ModelError.invalid("failed tap recovery reported as success or retried in a loop")
        }
        print("tap-recovery=PASS cases=\(recoveryCases + 1) (injected operations, not native clicks)")
        let executable = "/expected/WallpaperConnector"
        let service = "org.wallpaperthemes.connectorpoc2.agent"
        let valid: [String: Any] = ["Label": service, "ProgramArguments": [executable, "--agent"],
            "LimitLoadToSessionType": "Aqua", "MachServices": [service: true]]
        guard AgentLauncher.matches(valid, executable: executable, service: service) else {
            throw ModelError.invalid("valid launch configuration rejected")
        }
        for (key, value): (String, Any) in [("Label", "foreign"), ("Program", "/bin/sh"),
            ("ProgramArguments", ["/foreign", "--agent"]), ("ProgramArguments", [executable, "--shell"]),
            ("MachServices", ["foreign": true]), ("LimitLoadToSessionType", "System")] {
            var invalid = valid; invalid[key] = value
            guard !AgentLauncher.matches(invalid, executable: executable, service: service) else {
                throw ModelError.invalid("foreign launch configuration accepted")
            }
        }
        print("agent-launch-policy=PASS cases=7 (no job changed)")
        try testDesktopItems()
        try testControlInputPlaneProjection()
        let backgrounds = [
            ["AXGroup", "AXScrollArea", "AXApplication"],
            ["AXGroup", "AXGroup", "AXScrollArea", "AXGroup", "AXApplication"],
            ["AXScrollArea", "AXGroup", "AXApplication"]
        ]
        guard backgrounds.allSatisfy({ FinderBackground.matches(bundle: "com.apple.finder", roles: $0) }) else {
            throw ModelError.invalid("qualified Finder background rejected")
        }
        for (bundle, roles) in [
            ("com.apple.finder", ["AXImage", "AXGroup", "AXScrollArea"]),
            ("com.apple.finder", ["AXGroup", "AXScrollArea", "AXWindow"]),
            ("com.apple.finder", ["AXButton", "AXGroup", "AXScrollArea"]),
            ("com.apple.finder", ["AXStaticText", "AXGroup", "AXScrollArea", "AXApplication"]),
            ("com.apple.finder", ["AXGroup", "AXGroup", "AXApplication"]),
            ("com.apple.finder", ["AXGroup", "AXScrollArea"]),
            ("com.apple.finder", []),
            ("com.example.app", backgrounds[0])
        ] {
            guard !FinderBackground.matches(bundle: bundle, roles: roles) else {
                throw ModelError.invalid("native or unknown target accepted")
            }
        }
        guard !FinderBackground.matches(bundle: nil, roles: backgrounds[0]) else {
            throw ModelError.invalid("unknown process accepted")
        }
        print("finder-hierarchy=PASS cases=12 (pure policy, not desktop qualification)")
        guard CommandLine.arguments.count == 2,
              let bundle = Bundle(path: CommandLine.arguments[1]) else { throw ModelError.invalid("bundle argument") }
        guard dlopen("/System/Library/PrivateFrameworks/WallpaperExtensionKit.framework/WallpaperExtensionKit", RTLD_NOW) != nil
        else { throw ModelError.invalid("private framework") }
        let themes = try Theme.catalog(bundle: bundle)
        guard let result = makeCatalog(bundle: bundle) else { throw ModelError.invalid("Apple catalog decoding") }
        print("native-catalog=PASS themes=\(themes.count) type=\(type(of: result))")
    }
}
