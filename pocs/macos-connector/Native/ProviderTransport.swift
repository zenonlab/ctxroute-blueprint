import Foundation

private final class ProviderPeer: NSObject, ConnectorProviderXPC, @unchecked Sendable {
    let execute: @MainActor (Command) -> CatalogStatus?
    init(execute: @escaping @MainActor (Command) -> CatalogStatus?) { self.execute = execute }
    func perform(_ data: Data, reply: @escaping @Sendable (Data?) -> Void) {
        guard let command = try? NativeWire.decode(Command.self, from: data) else { reply(nil); return }
        Task { @MainActor in
            guard let result = execute(command) else { reply(nil); return }
            reply(try? NativeWire.encode(result))
        }
    }
}

@MainActor final class ProviderTransport {
    private var connection: NSXPCConnection?
    private var connectionID: UUID?
    private var retry: Task<Void, Never>?
    private let execute: @MainActor (Command) -> CatalogStatus?
    private let snapshot: @MainActor () -> CatalogStatus?
    init(execute: @escaping @MainActor (Command) -> CatalogStatus?, snapshot: @escaping @MainActor () -> CatalogStatus?) {
        self.execute = execute; self.snapshot = snapshot; connect()
    }
    private func connect() {
        guard connection == nil else { return }
        let requirement: String
        do { requirement = try NativeWire.embeddedAgentRequirement() }
        catch { extensionLog("XPC unavailable: \(error)"); return }
        let incoming = NSXPCConnection(machServiceName: NativeWire.service)
        let id = UUID()
        incoming.setCodeSigningRequirement(requirement)
        incoming.remoteObjectInterface = NSXPCInterface(with: ConnectorAgentXPC.self)
        incoming.exportedInterface = NSXPCInterface(with: ConnectorProviderXPC.self)
        incoming.exportedObject = ProviderPeer(execute: execute)
        incoming.invalidationHandler = { [weak self] in
            Task { @MainActor in
                guard let self, self.connectionID == id else { return }
                self.connection = nil; self.connectionID = nil
                self.retry?.cancel()
                self.retry = Task { @MainActor [weak self] in
                    do { try await Task.sleep(for: .seconds(30)) } catch { return }
                    self?.connect()
                }
            }
        }
        incoming.interruptionHandler = { [weak incoming] in incoming?.invalidate() }
        connection = incoming; connectionID = id; incoming.resume()
        if let status = snapshot() { publish(status) }
    }
    func publish(_ status: CatalogStatus) {
        guard let connection, let data = try? NativeWire.encode(status) else { return }
        let remote = connection.remoteObjectProxyWithErrorHandler { [weak connection] _ in connection?.invalidate() }
        (remote as? ConnectorAgentXPC)?.publish(data)
    }
}
