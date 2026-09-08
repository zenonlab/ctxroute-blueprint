import Foundation

func extensionLog(_ text: String) { FileHandle.standardError.write(Data((text + "\n").utf8)) }

@main @MainActor enum NativeCatalogTest {
    static func main() {
        do { try run() } catch { extensionLog("native-catalog=FAIL \(error)"); exit(EXIT_FAILURE) }
    }
    static func run() throws {
        guard CommandLine.arguments.count == 2,
              let bundle = Bundle(path: CommandLine.arguments[1]) else { throw ModelError.invalid("bundle argument") }
        guard dlopen("/System/Library/PrivateFrameworks/WallpaperExtensionKit.framework/WallpaperExtensionKit", RTLD_NOW) != nil
        else { throw ModelError.invalid("private framework") }
        let themes = try Theme.catalog(bundle: bundle)
        guard let result = makeCatalog(bundle: bundle) else { throw ModelError.invalid("Apple catalog decoding") }
        print("native-catalog=PASS themes=\(themes.count) type=\(type(of: result))")
    }
}
