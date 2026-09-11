import CryptoKit
import Foundation

public struct ThemeInterfaceManifest: Codable, Equatable, Sendable {
    public struct Asset: Codable, Equatable, Sendable {
        public let id: String
        public let path: String
        public let sha256: String
    }
    public struct ModelAsset: Codable, Equatable, Sendable {
        public let id: String
        public let path: String
        public let sha256: String
        public let clip_indices: [Int]

        public init(id: String, path: String, sha256: String, clipIndices: [Int] = []) {
            self.id = id
            self.path = path
            self.sha256 = sha256
            clip_indices = clipIndices
        }
    }
    public struct Choice: Codable, Equatable, Sendable {
        public enum Kind: String, Codable, Sendable { case character, vehicle }
        public struct Appearance: Codable, Equatable, Sendable {
            public let part: String
            public let material: String?
            public let tint: [Double]?
            public let model: String?

            public init(part: String, material: String? = nil, tint: [Double]? = nil,
                        model: String? = nil) {
                self.part = part
                self.material = material
                self.tint = tint
                self.model = model
            }
        }
        public let id: String
        public let label: String
        public let kind: Kind
        public let preview: String
        public let appearance: Appearance?
        public let attributes: [String: String]

        public init(id: String, label: String, kind: Kind, preview: String,
                    appearance: Appearance? = nil, attributes: [String: String] = [:]) {
            self.id = id
            self.label = label
            self.kind = kind
            self.preview = preview
            self.appearance = appearance
            self.attributes = attributes
        }

        private enum CodingKeys: String, CodingKey {
            case id, label, kind, preview, appearance, attributes
        }

        public init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            id = try values.decode(String.self, forKey: .id)
            label = try values.decode(String.self, forKey: .label)
            kind = try values.decode(Kind.self, forKey: .kind)
            preview = try values.decode(String.self, forKey: .preview)
            appearance = try values.decodeIfPresent(Appearance.self, forKey: .appearance)
            attributes = try values.decodeIfPresent([String: String].self, forKey: .attributes) ?? [:]
        }
    }
    public struct Selection: Codable, Equatable, Sendable {
        public struct Stage: Codable, Equatable, Sendable {
            public let id: String
            public let label: String
            public let kind: Choice.Kind
            public let columns: Int

            public init(id: String, label: String, kind: Choice.Kind, columns: Int) {
                self.id = id
                self.label = label
                self.kind = kind
                self.columns = columns
            }
        }
        public struct Compatibility: Codable, Equatable, Sendable {
            public let source_stage: String
            public let target_stage: String
            public let attribute: String

            public init(sourceStage: String, targetStage: String, attribute: String) {
                source_stage = sourceStage
                target_stage = targetStage
                self.attribute = attribute
            }
        }
        public let stages: [Stage]
        public let compatibility: [Compatibility]

        public init(stages: [Stage], compatibility: [Compatibility] = []) {
            self.stages = stages
            self.compatibility = compatibility
        }
    }
    public struct Target: Codable, Equatable, Sendable {
        public let id: String
        public let label: String
        public let session_id: String?
    }

    public let format: String
    public let assets: [Asset]
    public let models: [ModelAsset]?
    public let slots: [String: String]
    public let choices: [Choice]
    public let targets: [Target]
    public let selection: Selection?

    public init(format: String, assets: [Asset], models: [ModelAsset]? = nil,
                slots: [String: String], choices: [Choice], targets: [Target] = [],
                selection: Selection? = nil) {
        self.format = format
        self.assets = assets
        self.models = models
        self.slots = slots
        self.choices = choices
        self.targets = targets
        self.selection = selection
    }

    public func stage(for kind: Choice.Kind) -> Selection.Stage? {
        selection?.stages.first { $0.kind == kind }
    }

    public func compatibleChoices(kind: Choice.Kind, selected: [Choice.Kind: String]) -> [Choice] {
        let candidates = choices.filter { $0.kind == kind }
        guard let selection, let targetStage = stage(for: kind) else { return candidates }
        let rules = selection.compatibility.filter { $0.target_stage == targetStage.id }
        return candidates.filter { candidate in
            rules.allSatisfy { rule in
                guard let sourceStage = selection.stages.first(where: { $0.id == rule.source_stage }),
                      let selectedID = selected[sourceStage.kind],
                      let source = choices.first(where: { $0.kind == sourceStage.kind && $0.id == selectedID }),
                      let sourceValue = source.attributes[rule.attribute] else { return false }
                return candidate.attributes[rule.attribute] == sourceValue
            }
        }
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
    // A placement matrix is still bounded, but can legitimately contain all
    // character × vehicle bindings for a theme (972 entries in the MKW adapter).
    private static let manifestLimit = 1_048_576
    public static let requiredSlots = Set([
        "theme.audio", "display.brightness", "slider.track", "slider.thumb",
        "desktop.files.visible", "desktop.files.hidden",
        "visual.motion.pause", "visual.motion.resume", "customizer.panel"
    ])

    public static func load(_ manifestURL: URL) throws -> ResolvedThemeInterface {
        let data = try boundedRegularFile(manifestURL, maximum: manifestLimit)
        let manifest = try JSONDecoder().decode(ThemeInterfaceManifest.self, from: data)
        let models = manifest.models ?? []
        guard ["orbite.theme-interface/2", "orbite.theme-interface/3", "orbite.theme-interface/4"].contains(manifest.format),
              requiredSlots.isSubset(of: Set(manifest.slots.keys)),
              (1...128).contains(manifest.assets.count), manifest.choices.count <= 64,
              models.count <= 64,
              manifest.format == "orbite.theme-interface/4" || models.isEmpty,
              manifest.targets.count <= 16,
              Set(manifest.assets.map(\.id)).count == manifest.assets.count,
              Set(models.map(\.id)).count == models.count,
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
        var modelIDs = Set<String>()
        var modelBytes = 0
        for model in models {
            guard validID(model.id), validDigest(model.sha256), model.clip_indices.count <= 16,
                  model.clip_indices.allSatisfy({ (0...63).contains($0) }) else {
                throw ModelError.invalid("invalid interface model")
            }
            let url = try contained(model.path, root: root, extension: "glb")
            let bytes = try boundedRegularFile(url, maximum: 67_108_864)
            modelBytes += bytes.count
            guard modelBytes <= 536_870_912 else { throw ModelError.invalid("interface GLB budget") }
            guard bytes.starts(with: [0x67, 0x6c, 0x54, 0x46]),
                  SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == model.sha256
            else { throw ModelError.invalid("interface GLB digest mismatch") }
            modelIDs.insert(model.id)
        }
        guard manifest.slots.values.allSatisfy({ resolved[$0] != nil }),
              manifest.choices.allSatisfy({ validID($0.id) && (1...80).contains($0.label.count)
                  && !$0.label.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
                  && resolved[$0.preview] != nil
                  && $0.attributes.count <= 8
                  && $0.attributes.allSatisfy { validID($0.key) && validID($0.value) }
                  && ($0.appearance.map { appearance in
                      validID(appearance.part)
                          && (appearance.material.map(validID) ?? true)
                          && (appearance.tint.map { $0.count == 4
                              && $0.allSatisfy { $0.isFinite && (0...2).contains($0) } } ?? true)
                          && (appearance.material != nil) == (appearance.tint != nil)
                          && (appearance.model.map(modelIDs.contains) ?? true)
                          && (appearance.material != nil || appearance.model != nil)
                  } ?? true) }),
              manifest.targets.allSatisfy({ validID($0.id) && (1...80).contains($0.label.count)
                  && !$0.label.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
                  && ($0.session_id.map(validID) ?? true) })
        else { throw ModelError.invalid("unresolved interface slot") }
        try validateSelection(manifest)
        return ResolvedThemeInterface(manifest: manifest, manifestURL: manifestURL, assets: resolved)
    }

    private static func validateSelection(_ manifest: ThemeInterfaceManifest) throws {
        guard let selection = manifest.selection else {
            guard manifest.format == "orbite.theme-interface/2" else {
                throw ModelError.invalid("selection pipeline required")
            }
            return
        }
        let stages = selection.stages
        let stageIDs = Set(stages.map(\.id))
        let stageKinds = Set(stages.map(\.kind))
        guard (1...4).contains(stages.count), stageIDs.count == stages.count,
              stageKinds.count == stages.count,
              stages.allSatisfy({ validID($0.id) && (1...80).contains($0.label.count)
                  && (2...10).contains($0.columns) }),
              selection.compatibility.count <= 8 else {
            throw ModelError.invalid("invalid selection pipeline")
        }
        for rule in selection.compatibility {
            guard validID(rule.attribute), rule.source_stage != rule.target_stage,
                  let sourceIndex = stages.firstIndex(where: { $0.id == rule.source_stage }),
                  let targetIndex = stages.firstIndex(where: { $0.id == rule.target_stage }),
                  sourceIndex < targetIndex else {
                throw ModelError.invalid("invalid selection compatibility")
            }
            let relevantKinds = [stages[sourceIndex].kind, stages[targetIndex].kind]
            guard manifest.choices.filter({ relevantKinds.contains($0.kind) })
                .allSatisfy({ $0.attributes[rule.attribute] != nil }) else {
                throw ModelError.invalid("missing selection attribute")
            }
        }
    }

    private static func boundedRegularFile(_ url: URL, maximum: Int) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size > 0, size <= maximum else {
            throw ModelError.invalid("bounded ordinary file required")
        }
        return try Data(contentsOf: url, options: .mappedIfSafe)
    }

    private static func contained(_ path: String, root: URL, extension requiredExtension: String = "png") throws -> URL {
        guard !path.isEmpty, path.utf8.count <= 240, !path.hasPrefix("/"), !path.contains("\\"),
              !path.contains(":"), !path.split(separator: "/").contains(".."),
              path.lowercased().hasSuffix(".\(requiredExtension)") else {
            throw ModelError.invalid("relative \(requiredExtension.uppercased()) required")
        }
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
