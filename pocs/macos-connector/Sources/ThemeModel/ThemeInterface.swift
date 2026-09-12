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
        public let hide_parts: [String]
        public let part_offsets: [String: [Double]]
        public let effect_sockets: [String: [[Double]?]]
        public let footprint: [Double]?

        public init(id: String, path: String, sha256: String, clipIndices: [Int] = [],
                    hideParts: [String] = [], partOffsets: [String: [Double]] = [:],
                    effectSockets: [String: [[Double]?]] = [:], footprint: [Double]? = nil) {
            self.id = id
            self.path = path
            self.sha256 = sha256
            clip_indices = clipIndices
            hide_parts = hideParts
            part_offsets = partOffsets
            effect_sockets = effectSockets
            self.footprint = footprint
        }

        private enum CodingKeys: String, CodingKey {
            case id, path, sha256, clip_indices, hide_parts, part_offsets, effect_sockets, footprint
        }

        public init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            id = try values.decode(String.self, forKey: .id)
            path = try values.decode(String.self, forKey: .path)
            sha256 = try values.decode(String.self, forKey: .sha256)
            clip_indices = try values.decode([Int].self, forKey: .clip_indices)
            hide_parts = try values.decodeIfPresent([String].self, forKey: .hide_parts) ?? []
            part_offsets = try values.decodeIfPresent([String: [Double]].self, forKey: .part_offsets) ?? [:]
            effect_sockets = try values.decodeIfPresent([String: [[Double]?]].self,
                                                         forKey: .effect_sockets) ?? [:]
            footprint = try values.decodeIfPresent([Double].self, forKey: .footprint)
        }
    }
    public struct Choice: Codable, Equatable, Sendable {
        public struct Kind: RawRepresentable, Codable, Equatable, Hashable, Sendable {
            public let rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }
            public init(from decoder: Decoder) throws {
                rawValue = try decoder.singleValueContainer().decode(String.self)
            }
            public func encode(to encoder: Encoder) throws {
                var container = encoder.singleValueContainer()
                try container.encode(rawValue)
            }
        }
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
    public struct Placement: Codable, Equatable, Sendable {
        public let selections: [String: String]
        public let part: String
        public let translation: [Double]
    }
    public struct Pinning: Codable, Equatable, Sendable {
        public struct Limits: Codable, Equatable, Sendable {
            public let size: [Double]
            public let brightness: [Double]
            public let opacity: [Double]
        }
        public let target_ids: [String]
        public let visibility_scope: String
        public let same_instance_and_session: Bool
        public let edit_mode: String
        public let controls: [String]
        public let actions: [String]
        public let limits: Limits
        public let persistent_per_object_settings: Bool
        public let atomic_preview: Bool
    }

    public let format: String
    public let assets: [Asset]
    public let models: [ModelAsset]?
    public let slots: [String: String]
    public let choices: [Choice]
    public let targets: [Target]
    public let selection: Selection?
    public let placements: [Placement]
    public let pinning: Pinning?

    public init(format: String, assets: [Asset], models: [ModelAsset]? = nil,
                slots: [String: String], choices: [Choice], targets: [Target] = [],
                selection: Selection? = nil, placements: [Placement] = [], pinning: Pinning? = nil) {
        self.format = format
        self.assets = assets
        self.models = models
        self.slots = slots
        self.choices = choices
        self.targets = targets
        self.selection = selection
        self.placements = placements
        self.pinning = pinning
    }

    private enum CodingKeys: String, CodingKey {
        case format, assets, models, slots, choices, targets, selection, placements, pinning
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        format = try values.decode(String.self, forKey: .format)
        assets = try values.decode([Asset].self, forKey: .assets)
        models = try values.decodeIfPresent([ModelAsset].self, forKey: .models)
        slots = try values.decode([String: String].self, forKey: .slots)
        choices = try values.decode([Choice].self, forKey: .choices)
        targets = try values.decode([Target].self, forKey: .targets)
        selection = try values.decodeIfPresent(Selection.self, forKey: .selection)
        placements = try values.decodeIfPresent([Placement].self, forKey: .placements) ?? []
        pinning = try values.decodeIfPresent(Pinning.self, forKey: .pinning)
    }

    public func stage(for kind: Choice.Kind) -> Selection.Stage? {
        selection?.stages.first { $0.kind == kind }
    }

    public var effectiveStages: [Selection.Stage] {
        if let selection { return selection.stages }
        var seen = Set<Choice.Kind>()
        return choices.compactMap { choice in
            guard seen.insert(choice.kind).inserted else { return nil }
            return Selection.Stage(id: choice.kind.rawValue, label: choice.kind.rawValue.capitalized,
                                   kind: choice.kind, columns: 6)
        }
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
    // A source-derived relation matrix can contain thousands of combinations;
    // the connector validates its own bounded projection while the renderer owns transforms.
    private static let manifestLimit = 1_048_576
    public static let requiredSlots = Set([
        "theme.audio", "display.brightness", "slider.track", "slider.thumb",
        "desktop.files.visible", "desktop.files.hidden",
        "visual.motion.pause", "visual.motion.resume", "customizer.panel"
    ])

    public static func load(_ manifestURL: URL) throws -> ResolvedThemeInterface {
        let data = try boundedRegularFile(manifestURL, maximum: manifestLimit)
        try validateRootKeys(data)
        let manifest = try JSONDecoder().decode(ThemeInterfaceManifest.self, from: data)
        let models = manifest.models ?? []
        guard manifest.format == "orbite.theme-interface/5",
              requiredSlots.isSubset(of: Set(manifest.slots.keys)),
              (1...128).contains(manifest.assets.count), manifest.choices.count <= 64,
              models.count <= 64,
              manifest.selection != nil,
              manifest.targets.count <= 16,
              manifest.placements.count <= 4096,
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
                  model.clip_indices.allSatisfy({ (0...63).contains($0) }),
                  model.hide_parts.count <= 32, Set(model.hide_parts).count == model.hide_parts.count,
                  model.hide_parts.allSatisfy(validID), model.part_offsets.count <= 32,
                  model.part_offsets.allSatisfy({ validID($0.key) && validVector($0.value, limit: 2_000) }),
                  model.effect_sockets.count <= 32,
                  model.effect_sockets.allSatisfy({ validID($0.key) && $0.value.count == 2
                      && $0.value.allSatisfy({ $0.map { validVector($0, limit: 2_000) } ?? true }) }),
                  model.footprint.map({ $0.count == 5 && $0.allSatisfy(\.isFinite) }) ?? true else {
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
              manifest.choices.allSatisfy({ validID($0.id) && validID($0.kind.rawValue)
                  && (1...80).contains($0.label.count)
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
        try validatePlacements(manifest)
        try validatePinning(manifest)
        return ResolvedThemeInterface(manifest: manifest, manifestURL: manifestURL, assets: resolved)
    }

    private static func validateSelection(_ manifest: ThemeInterfaceManifest) throws {
        guard let selection = manifest.selection else {
            throw ModelError.invalid("selection pipeline required")
        }
        let stages = selection.stages
        let stageIDs = Set(stages.map(\.id))
        let stageKinds = Set(stages.map(\.kind))
        guard (1...8).contains(stages.count), stageIDs.count == stages.count,
              stageKinds.count == stages.count,
              stages.allSatisfy({ validID($0.id) && validID($0.kind.rawValue)
                  && (1...80).contains($0.label.count)
                  && (2...10).contains($0.columns) }),
              selection.compatibility.count <= 16,
              Set(manifest.choices.map(\.kind)) == stageKinds else {
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

    private static func validatePlacements(_ manifest: ThemeInterfaceManifest) throws {
        let choices = Dictionary(uniqueKeysWithValues: manifest.choices.map { ($0.id, $0.kind.rawValue) })
        var keys = Set<String>()
        for placement in manifest.placements {
            let key = placement.selections.sorted { $0.key < $1.key }
                .map { "\($0.key)=\($0.value)" }.joined(separator: "|") + ":\(placement.part)"
            guard (1...8).contains(placement.selections.count), validID(placement.part),
                  placement.selections.allSatisfy({ validID($0.key) && validID($0.value)
                      && choices[$0.value] == $0.key }),
                  validVector(placement.translation, limit: 10_000), keys.insert(key).inserted else {
                throw ModelError.invalid("invalid interface placement")
            }
        }
    }

    private static func validatePinning(_ manifest: ThemeInterfaceManifest) throws {
        if manifest.format == "orbite.theme-interface/5", manifest.pinning == nil {
            throw ModelError.invalid("interface v5 requires pinning")
        }
        guard let pinning = manifest.pinning else { return }
        let targetIDs = Set(manifest.targets.map(\.id))
        let controls = Set(["position", "size", "brightness", "opacity"])
        let actions = Set(["accept", "cancel", "disable"])
        guard (1...16).contains(pinning.target_ids.count),
              Set(pinning.target_ids).count == pinning.target_ids.count,
              pinning.target_ids.allSatisfy(targetIDs.contains),
              pinning.visibility_scope == "workspace-windows",
              pinning.same_instance_and_session, pinning.edit_mode == "transform-frame",
              Set(pinning.controls) == controls, pinning.controls.count == controls.count,
              Set(pinning.actions) == actions, pinning.actions.count == actions.count,
              validRange(pinning.limits.size, positive: true),
              validRange(pinning.limits.brightness), validRange(pinning.limits.opacity),
              pinning.persistent_per_object_settings, pinning.atomic_preview else {
            throw ModelError.invalid("invalid pinning contract")
        }
    }

    private static func validateRootKeys(_ data: Data) throws {
        let value = try JSONSerialization.jsonObject(with: data)
        guard let object = value as? [String: Any] else {
            throw ModelError.invalid("interface manifest object required")
        }
        let allowed = Set(["format", "assets", "models", "slots", "choices", "targets",
                           "selection", "placements", "pinning"])
        guard Set(object.keys).isSubset(of: allowed) else {
            throw ModelError.invalid("unknown interface manifest field")
        }
    }

    private static func validVector(_ value: [Double], limit: Double) -> Bool {
        value.count == 3 && value.allSatisfy { $0.isFinite && abs($0) <= limit }
    }

    private static func validRange(_ value: [Double], positive: Bool = false) -> Bool {
        value.count == 2 && value.allSatisfy { $0.isFinite && (positive ? $0 > 0 : (0...1).contains($0)) }
            && value[0] <= value[1]
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
