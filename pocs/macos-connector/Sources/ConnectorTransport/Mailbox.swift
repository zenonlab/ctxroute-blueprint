import Foundation
#if SWIFT_PACKAGE
import ThemeModel
#endif

/// Experimental local transport. Signals are hints; all authority is in bounded files.
public struct Mailbox: Sendable {
    public static let group = "group.org.wallpaperthemes.connectorpoc2"
    public static let commandSignal = "org.wallpaperthemes.connectorpoc2.command"
    public static let statusSignal = "org.wallpaperthemes.connectorpoc2.status"
    public let directory: URL
    public init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
    }
    public static func shared() throws -> Mailbox {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
        else { throw ModelError.invalid("App Group unavailable") }
        return try Mailbox(directory: container.appendingPathComponent("Connector-v1", isDirectory: true))
    }
    public func command() throws -> Command? { try read("command.json") }
    public func status() throws -> CatalogStatus? { try read("status.json") }
    public func write(_ command: Command) throws {
        try write(command, name: "command.json"); Self.signal(Self.commandSignal)
    }
    public func write(_ status: CatalogStatus) throws {
        try write(status, name: "status.json"); Self.signal(Self.statusSignal)
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
