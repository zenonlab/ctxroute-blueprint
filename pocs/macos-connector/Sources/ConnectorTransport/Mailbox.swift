import Foundation
import Security
#if SWIFT_PACKAGE
import ThemeModel
#endif

/// Experimental local transport. Signals are hints; all authority is in bounded files.
public enum TransportError: Error, LocalizedError {
    case signingRequired, groupMismatch, groupUnavailable
    public var errorDescription: String? {
        switch self {
        case .signingRequired: "Mode strict : signature avec Team ID requise. Pour un essai local sans certificat, reconstruire explicitement avec --development."
        case .groupMismatch: "Signature et App Group incohérents. Reconstruire les deux bundles avec la même identité et le même Team ID."
        case .groupUnavailable: "Accès App Group non accordé par macOS. Une signature ou un mode développement ne garantit pas cet accès."
        }
    }
}

public struct Mailbox: Sendable {
    public static let localGroup = "group.org.wallpaperthemes.connectorpoc2.local"
    #if CONNECTOR_LOCAL_DEVELOPMENT
    public static let developmentEnabled = true
    public static let signalPrefix = "org.wallpaperthemes.connectorpoc2.local"
    #else
    public static let developmentEnabled = false
    public static let signalPrefix = "org.wallpaperthemes.connectorpoc2"
    #endif
    /// Strict mode uses the macOS Team ID convention; local mode requests OS-managed access.
    /// Entitlement consistency is a prerequisite, never proof of sandbox access.
    public static func sharedGroup(team: String, entitlements: [String],
                                   development: Bool = false, adHoc: Bool = false) throws -> String {
        if development {
            guard adHoc, team.isEmpty, entitlements == [localGroup] else { throw TransportError.groupMismatch }
            return localGroup
        }
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil
        else { throw TransportError.signingRequired }
        let group = "\(team).org.wallpaperthemes.connectorpoc2"
        guard entitlements == [group] else { throw TransportError.groupMismatch }
        return group
    }
    public static let commandSignal = signalPrefix + ".command"
    public static let statusSignal = signalPrefix + ".status"
    public let directory: URL
    private let onSignal: @Sendable (String) -> Void
    /// Standalone/test mailboxes have no system-wide side effects.
    public init(directory: URL, onSignal: @escaping @Sendable (String) -> Void = { _ in }) throws {
        self.directory = directory
        self.onSignal = onSignal
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
    }
    public static func shared() throws -> Mailbox {
        var code: SecCode?
        var staticCode: SecStaticCode?
        var information: CFDictionary?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code,
              SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode,
              SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
              let values = information as? [String: Any]
        else { throw TransportError.signingRequired }
        let team = values[kSecCodeInfoTeamIdentifier as String] as? String ?? ""
        let flags = (values[kSecCodeInfoFlags as String] as? NSNumber)?.uint32Value ?? 0
        let entitlements = values[kSecCodeInfoEntitlementsDict as String] as? [String: Any]
        let group = try sharedGroup(team: team,
            entitlements: entitlements?["com.apple.security.application-groups"] as? [String] ?? [],
            development: developmentEnabled, adHoc: SecCodeSignatureFlags(rawValue: flags).contains(.adhoc))
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
        else { throw TransportError.groupUnavailable }
        return try Mailbox(directory: container.appendingPathComponent("Connector-v1", isDirectory: true), onSignal: Self.signal)
    }
    public func command() throws -> Command? { try read("command.json") }
    public func status() throws -> CatalogStatus? { try read("status.json") }
    /// Explicit diagnostic only. Never touches a command/status or emits a wakeup.
    /// This proves this process's access, not the provider's access or liveness.
    public func verifyAccess() throws {
        let nonce = UUID().uuidString
        try write(nonce, name: "access-probe.json")
        let observed: String? = try read("access-probe.json")
        guard observed == nonce else { throw ModelError.invalid("mailbox access probe mismatch") }
    }
    public func write(_ command: Command) throws {
        try write(command, name: "command.json"); onSignal(Self.commandSignal)
    }
    public func write(_ status: CatalogStatus) throws {
        try write(status, name: "status.json"); onSignal(Self.statusSignal)
    }
    private func read<T: Decodable>(_ name: String) throws -> T? {
        let url = directory.appendingPathComponent(name)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink == false,
              let count = values.fileSize, count <= 16_384 else { throw ModelError.invalid("mailbox size or type") }
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        let data = try handle.read(upToCount: 16_385) ?? Data()
        guard data.count <= 16_384 else { throw ModelError.invalid("mailbox too large") }
        return try JSONDecoder().decode(T.self, from: data)
    }
    private func write<T: Encodable>(_ value: T, name: String) throws {
        let data = try JSONEncoder().encode(value)
        guard data.count <= 16_384 else { throw ModelError.invalid("mailbox too large") }
        let url = directory.appendingPathComponent(name)
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    private static func signal(_ name: String) {
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name as CFString), nil, nil, true)
    }
}

@MainActor public final class WakeSignal {
    private let callback: @MainActor () -> Void
    public init(_ name: String, callback: @escaping @MainActor () -> Void) {
        self.callback = callback
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(), { _, pointer, _, _, _ in
                guard let pointer else { return }
                let signal = Unmanaged<WakeSignal>.fromOpaque(pointer).takeUnretainedValue()
                Task { @MainActor [signal] in signal.callback() }
            }, name as CFString, nil, .deliverImmediately)
    }
    deinit {
        CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque())
    }
}
