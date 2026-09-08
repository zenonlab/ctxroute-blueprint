import Foundation

func extensionLog(_ text: String) { FileHandle.standardError.write(Data((text + "\n").utf8)) }

@main @MainActor enum NativeCatalogTest {
    static func main() {
        do { try run() } catch { extensionLog("native-catalog=FAIL \(error)"); exit(EXIT_FAILURE) }
    }
    static func run() throws {
        let background = ["AXGroup", "AXScrollArea", "AXApplication"]
        guard FinderBackground.matches(bundle: "com.apple.finder", roles: background) else {
            throw ModelError.invalid("measured Finder background rejected")
        }
        for (bundle, roles) in [
            ("com.apple.finder", ["AXImage", "AXGroup", "AXScrollArea"]),
            ("com.apple.finder", ["AXGroup", "AXScrollArea", "AXWindow"]),
            ("com.apple.finder", ["AXScrollArea", "AXApplication"]),
            ("com.apple.finder", ["AXButton", "AXGroup", "AXScrollArea"]),
            ("com.apple.finder", ["AXGroup", "AXGroup", "AXApplication"]),
            ("com.apple.finder", []),
            ("com.example.app", background)
        ] {
            guard !FinderBackground.matches(bundle: bundle, roles: roles) else {
                throw ModelError.invalid("native or unknown target accepted")
            }
        }
        guard !FinderBackground.matches(bundle: nil, roles: background) else {
            throw ModelError.invalid("unknown process accepted")
        }
        print("finder-hierarchy=PASS cases=9 (pure policy, not desktop qualification)")
        guard CommandLine.arguments.count == 2,
              let bundle = Bundle(path: CommandLine.arguments[1]) else { throw ModelError.invalid("bundle argument") }
        guard dlopen("/System/Library/PrivateFrameworks/WallpaperExtensionKit.framework/WallpaperExtensionKit", RTLD_NOW) != nil
        else { throw ModelError.invalid("private framework") }
        let themes = try Theme.catalog(bundle: bundle)
        guard let result = makeCatalog(bundle: bundle) else { throw ModelError.invalid("Apple catalog decoding") }
        print("native-catalog=PASS themes=\(themes.count) type=\(type(of: result))")
    }
}
