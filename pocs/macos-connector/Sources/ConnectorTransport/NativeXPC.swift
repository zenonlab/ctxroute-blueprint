import Foundation
import Security
#if SWIFT_PACKAGE
import ThemeModel
#endif

@objc public protocol ConnectorAgentXPC {
    func publish(_ data: Data)
}
@objc public protocol ConnectorProviderXPC {
    func perform(_ data: Data, reply: @escaping @Sendable (Data?) -> Void)
}

public enum NativeWire {
    public static let service = "org.wallpaperthemes.connectorpoc2.agent"
    public static let limit = 16_384
    public static var appBundle: URL {
        let bundle = Bundle.main.bundleURL
        guard Bundle.main.bundleIdentifier == "org.wallpaperthemes.connectorpoc2.agent" else { return bundle }
        return bundle.deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }
    public static func embeddedAgentRequirement() throws -> String {
        guard let url = Bundle.main.url(forResource: "agent-requirement", withExtension: "txt"),
              let data = try? Data(contentsOf: url), data.count <= 8192,
              let string = String(data: data, encoding: .utf8) else { throw ModelError.invalid("Agent signature pin missing") }
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(string.trimmingCharacters(in: .whitespacesAndNewlines) as CFString,
            [], &requirement) == errSecSuccess else { throw ModelError.invalid("Invalid agent signature pin") }
        return string.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let data = try JSONEncoder().encode(value)
        guard data.count <= limit else { throw ModelError.invalid("XPC payload too large") }
        return data
    }
    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        guard !data.isEmpty, data.count <= limit else { throw ModelError.invalid("XPC payload size") }
        return try JSONDecoder().decode(type, from: data)
    }
    /// The expected bundle is derived from our own package, never supplied by a peer.
    public static func requirement(for bundle: URL) throws -> String {
        var code: SecStaticCode?
        var requirement: SecRequirement?
        var string: CFString?
        let create = SecStaticCodeCreateWithPath(bundle as CFURL, [], &code)
        guard create == errSecSuccess, let code else { throw ModelError.invalid("XPC signature create: \(create)") }
        let validity = SecStaticCodeCheckValidity(code, [], nil)
        guard validity == errSecSuccess else { throw ModelError.invalid("XPC signature validity: \(validity)") }
        let copy = SecCodeCopyDesignatedRequirement(code, [], &requirement)
        guard copy == errSecSuccess, let requirement else { throw ModelError.invalid("XPC signature requirement: \(copy)") }
        let render = SecRequirementCopyString(requirement, [], &string)
        guard render == errSecSuccess, let string else { throw ModelError.invalid("XPC signature string: \(render)") }
        return string as String
    }
    public static func accepts(_ connection: NSXPCConnection, bundle: URL) -> Bool {
        guard connection.effectiveUserIdentifier == getuid(),
              let text = try? requirement(for: bundle) else { return false }
        // Foundation validates each message against the peer's code identity and
        // invalidates mismatches before invoking exported methods (macOS 13+).
        connection.setCodeSigningRequirement(text)
        return true
    }
}
