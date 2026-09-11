import CryptoKit
import Foundation

public struct ThemeInterfaceManifest: Codable, Equatable, Sendable {
    public struct Asset: Codable, Equatable, Sendable {
        public let id: String
        public let path: String
        public let sha256: String
    }
    public struct Choice: Codable, Equatable, Sendable {
        public enum Kind: String, Codable, Sendable { case character, vehicle }
        public struct Appearance: Codable, Equatable, Sendable {
            public let part: String
            public let material: String
            public let tint: [Double]

            public init(part: String, material: String, tint: [Double]) {
                self.part = part
                self.material = material
                self.tint = tint
            }
        }
        public let id: String
        public let label: String
        public let kind: Kind
        public let preview: String
        public let appearance: Appearance?

        public init(id: String, label: String, kind: Kind, preview: String,
                    appearance: Appearance? = nil) {
            self.id = id
            self.label = label
            self.kind = kind
            self.preview = preview
            self.appearance = appearance
        }
    }
    public struct Target: Codable, Equatable, Sendable {
        public let id: String
        public let label: String
        public let session_id: String?
    }

    public let format: String
    public let assets: [Asset]
    public let slots: [String: String]
    public let choices: [Choice]
    public let targets: [Target]

    public init(format: String, assets: [Asset], slots: [String: String], choices: [Choice],
                targets: [Target] = []) {
        self.format = format
        self.assets = assets
        self.slots = slots
        self.choices = choices
        self.targets = targets
    }
}

public struct ResolvedThemeInterface: Codable, Equatable, Sendable {
    public let manifest: ThemeInterfaceManifest
    public let manifestURL: URL
    public let assets: [String: URL]

    public func asset(for slot: String) -> URL? {
        manifest.slots[slot].flatMap { assets[$0] }
    }
}

public enum ThemeInterfaceLoader {
    public static let requiredSlots = Set([
        "theme.audio.muted", "theme.audio.unmuted",
        "desktop.files.visible", "desktop.files.hidden",
        "display.brightness", "slider.track", "slider.thumb", "customizer.panel"
    ])

    public static func load(_ manifestURL: URL) throws -> ResolvedThemeInterface {
        let data = try boundedRegularFile(manifestURL, maximum: 65_536)
        let manifest = try JSONDecoder().decode(ThemeInterfaceManifest.self, from: data)
        guard manifest.format == "orbite.theme-interface/1",
              (requiredSlots.isSubset(of: Set(manifest.slots.keys))),
              (1...64).contains(manifest.assets.count), manifest.choices.count <= 64,
              manifest.targets.count <= 16,
              Set(manifest.assets.map(\.id)).count == manifest.assets.count,
              Set(manifest.choices.map { "\($0.kind.rawValue):\($0.id)" }).count == manifest.choices.count,
              Set(manifest.targets.map(\.id)).count == manifest.targets.count
        else { throw ModelError.invalid("invalid theme interface manifest") }

        let root = manifestURL.deletingLastPathComponent().resolvingSymlinksInPath()
        var resolved: [String: URL] = [:]
        for asset in manifest.assets {
            guard validID(asset.id), validDigest(asset.sha256) else {
                throw ModelError.invalid("invalid interface asset")
            }
            let url = try contained(asset.path, root: root)
            let bytes = try boundedRegularFile(url, maximum: 16_777_216)
            guard bytes.starts(with: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                  SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == asset.sha256
            else { throw ModelError.invalid("interface PNG digest mismatch") }
            resolved[asset.id] = url
        }
        guard manifest.slots.values.allSatisfy({ resolved[$0] != nil }),
              manifest.choices.allSatisfy({ validID($0.id) && (1...80).contains($0.label.count)
                  && !$0.label.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
                  && resolved[$0.preview] != nil
                  && ($0.appearance.map { appearance in
                      validID(appearance.part) && validID(appearance.material)
                          && appearance.tint.count == 4
                          && appearance.tint.allSatisfy { $0.isFinite && (0...2).contains($0) }
                  } ?? true) }),
              manifest.targets.allSatisfy({ validID($0.id) && (1...80).contains($0.label.count)
                  && !$0.label.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
                  && ($0.session_id.map(validID) ?? true) })
        else { throw ModelError.invalid("unresolved interface slot") }
        return ResolvedThemeInterface(manifest: manifest, manifestURL: manifestURL, assets: resolved)
    }

    private static func boundedRegularFile(_ url: URL, maximum: Int) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size > 0, size <= maximum else {
            throw ModelError.invalid("bounded ordinary file required")
        }
        return try Data(contentsOf: url, options: .mappedIfSafe)
    }

    private static func contained(_ path: String, root: URL) throws -> URL {
        guard !path.isEmpty, path.utf8.count <= 240, !path.hasPrefix("/"), !path.contains("\\"),
              !path.contains(":"), !path.split(separator: "/").contains(".."),
              path.lowercased().hasSuffix(".png") else { throw ModelError.invalid("relative PNG required") }
        let candidate = root.appendingPathComponent(path).resolvingSymlinksInPath()
        let prefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
        guard candidate.path.hasPrefix(prefix) else { throw ModelError.invalid("interface asset escapes package") }
        return candidate
    }

    private static func validID(_ value: String) -> Bool {
        value.range(of: "^[a-zA-Z][a-zA-Z0-9._-]{0,95}$", options: .regularExpression) != nil
    }
    private static func validDigest(_ value: String) -> Bool {
        value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
    }
}
