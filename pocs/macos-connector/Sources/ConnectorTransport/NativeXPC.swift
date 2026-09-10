import Foundation
import Security
#if SWIFT_PACKAGE
import ThemeModel
#endif

@objc public protocol ConnectorAgentXPC {
    func perform(_ data: Data, reply: @escaping @Sendable (Data?) -> Void)
}

public enum ProviderAction: String, Codable, Sendable {
    case catalog
    case activate
    case show
}

public struct ProviderRequest: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let action: ProviderAction
    public let themeID: String?

    public init(action: ProviderAction, themeID: String? = nil) {
        schemaVersion = 1
        self.action = action
        self.themeID = themeID
    }

    public var isValid: Bool {
        guard schemaVersion == 1 else { return false }
        switch action {
        case .activate:
            return themeID.map(NativeWire.validID) == true
        case .catalog, .show:
            return themeID == nil
        }
    }
}

public struct ProviderCatalogItem: Codable, Equatable, Sendable {
    public let id: String
    public let displayName: String

    public init(id: String, displayName: String) {
        self.id = id
        self.displayName = displayName
    }

    public var isValid: Bool {
        NativeWire.validID(id) && (1...80).contains(displayName.count) &&
            !displayName.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }
}

public struct ProviderResponse: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let accepted: Bool
    public let catalog: [ProviderCatalogItem]?
    public let message: String?

    public init(accepted: Bool, catalog: [ProviderCatalogItem]? = nil, message: String? = nil) {
        schemaVersion = 1
        self.accepted = accepted
        self.catalog = catalog
        self.message = message.map { String($0.prefix(160)) }
    }

    public var isValid: Bool {
        guard schemaVersion == 1, (message?.count ?? 0) <= 160 else { return false }
        guard let catalog else { return true }
        return catalog.count <= 256 && Set(catalog.map(\.id)).count == catalog.count &&
            catalog.allSatisfy(\.isValid)
    }
}

public enum NativeWire {
    public static let service = ProductIdentity.service
    public static let limit = 65_536

    public static func embeddedAgentRequirement() throws -> String {
        guard let url = Bundle.main.url(forResource: "agent-requirement", withExtension: "txt"),
              let data = try? Data(contentsOf: url), data.count <= 8_192,
              let string = String(data: data, encoding: .utf8) else {
            throw ModelError.invalid("Agent signature pin missing")
        }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(trimmed as CFString, [], &requirement) == errSecSuccess else {
            throw ModelError.invalid("Invalid agent signature pin")
        }
        return trimmed
    }

    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let data = try JSONEncoder().encode(value)
        guard !data.isEmpty, data.count <= limit else { throw ModelError.invalid("XPC payload too large") }
        return data
    }

    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        guard !data.isEmpty, data.count <= limit else { throw ModelError.invalid("XPC payload size") }
        return try JSONDecoder().decode(type, from: data)
    }

    public static func requirement(for bundle: URL) throws -> String {
        var code: SecStaticCode?
        var requirement: SecRequirement?
        var string: CFString?
        let create = SecStaticCodeCreateWithPath(bundle as CFURL, [], &code)
        guard create == errSecSuccess, let code else { throw ModelError.invalid("XPC signature create: \(create)") }
        let validity = SecStaticCodeCheckValidity(code, [], nil)
        guard validity == errSecSuccess else { throw ModelError.invalid("XPC signature validity: \(validity)") }
        let copy = SecCodeCopyDesignatedRequirement(code, [], &requirement)
        guard copy == errSecSuccess, let requirement else {
            throw ModelError.invalid("XPC signature requirement: \(copy)")
        }
        let render = SecRequirementCopyString(requirement, [], &string)
        guard render == errSecSuccess, let string else { throw ModelError.invalid("XPC signature string: \(render)") }
        return string as String
    }

    public static func accepts(_ connection: NSXPCConnection, bundles: [URL]) -> Bool {
        guard connection.effectiveUserIdentifier == getuid(), !bundles.isEmpty,
              let requirements = try? bundles.map(requirement(for:)) else { return false }
        let combined = requirements.map { "(\($0))" }.joined(separator: " or ")
        connection.setCodeSigningRequirement(combined)
        return true
    }

    public static func validID(_ value: String) -> Bool {
        value.range(of: "^[a-zA-Z][a-zA-Z0-9._-]{0,95}$", options: .regularExpression) != nil
    }
}
