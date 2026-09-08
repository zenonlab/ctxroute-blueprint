import Foundation
import os

/// One-way handoff from the listener queue; configuration continues only on MainActor.
private struct AcceptedConnection: @unchecked Sendable { let value: NSXPCConnection }

private final class AgentPeer: NSObject, ConnectorAgentXPC, @unchecked Sendable {
    let deliver: @Sendable (Data) -> Void
    init(deliver: @escaping @Sendable (Data) -> Void) { self.deliver = deliver }
    func publish(_ data: Data) { guard data.count <= NativeWire.limit else { return }; deliver(data) }
}

@MainActor final class AgentTransport: NSObject, NSXPCListenerDelegate {
    private let listener = NSXPCListener(machServiceName: NativeWire.service)
    private var connection: NSXPCConnection?
    private var connectionID: UUID?
    private(set) var status: CatalogStatus?
    var onChange: (() -> Void)?
    override init() {
        super.init(); listener.delegate = self; listener.resume()
    }
    nonisolated func listener(_ listener: NSXPCListener, shouldAcceptNewConnection incoming: NSXPCConnection) -> Bool {
        let provider = NativeWire.appBundle.appendingPathComponent("Contents/Extensions/WallpaperProvider.appex")
        guard NativeWire.accepts(incoming, bundle: provider) else { return false }
        let accepted = AcceptedConnection(value: incoming)
        Task { @MainActor [weak self] in
            let incoming = accepted.value
            guard let self, connection == nil else { incoming.invalidate(); return }
            let id = UUID()
            connection = incoming; connectionID = id; status = nil
            incoming.exportedInterface = NSXPCInterface(with: ConnectorAgentXPC.self)
            incoming.remoteObjectInterface = NSXPCInterface(with: ConnectorProviderXPC.self)
            incoming.exportedObject = AgentPeer { [weak self] data in
                Task { @MainActor in
                    guard let self, self.connectionID == id else { return }
                    self.accept(data)
                }
            }
            incoming.invalidationHandler = { [weak self] in
                Task { @MainActor in
                    guard let self, self.connectionID == id else { return }
                    self.connection = nil; self.connectionID = nil; self.status = nil; self.onChange?()
                }
            }
            incoming.interruptionHandler = { [weak incoming] in incoming?.invalidate() }
            incoming.resume()
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(5))
                guard let self, self.connectionID == id, self.status == nil else { return }
                self.connection?.invalidate()
            }
        }
        return true
    }
    private func accept(_ data: Data) {
        guard let result = try? NativeWire.decode(CatalogStatus.self, from: data),
              result.schema_version == 1, result.themes.count <= 8,
              Set(result.themes.map(\.theme_id)).count == result.themes.count,
              result.themes.allSatisfy({ state in
                  guard (0...16).contains(state.surfaces), state.generation >= 0,
                        let configuration = state.configuration,
                        configuration.theme_id == state.theme_id,
                        let data = try? JSONEncoder().encode(configuration) else { return false }
                  return (try? Theme.decode(data)) != nil
              }),
              (result.layouts?.count ?? 0) <= 16,
              Set((result.layouts ?? []).map(\.id)).count == (result.layouts?.count ?? 0),
              result.layouts?.allSatisfy(\.valid) != false else { return }
        status = result; onChange?()
    }
    func send(_ command: Command) throws {
        guard let connection, let id = connectionID else { throw ModelError.invalid("Provider XPC absent") }
        let data = try NativeWire.encode(command)
        let remote = connection.remoteObjectProxyWithErrorHandler { [weak connection] _ in connection?.invalidate() }
        guard let provider = remote as? ConnectorProviderXPC else { throw ModelError.invalid("Provider XPC interface") }
        provider.perform(data) { [weak self] reply in
            Task { @MainActor in
                guard let self, self.connectionID == id, let reply else { return }
                self.accept(reply)
            }
        }
    }
}
