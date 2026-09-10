import Foundation

private struct AcceptedConnection: @unchecked Sendable {
    let value: NSXPCConnection
}

private final class AgentPeer: NSObject, ConnectorAgentXPC, @unchecked Sendable {
    let handle: @MainActor (ProviderRequest) -> ProviderResponse

    init(handle: @escaping @MainActor (ProviderRequest) -> ProviderResponse) {
        self.handle = handle
    }

    func perform(_ data: Data, reply: @escaping @Sendable (Data?) -> Void) {
        guard let request = try? NativeWire.decode(ProviderRequest.self, from: data), request.isValid else {
            reply(nil)
            return
        }
        Task { @MainActor in
            reply(try? NativeWire.encode(handle(request)))
        }
    }
}

@MainActor final class AgentTransport: NSObject, NSXPCListenerDelegate {
    private let listener = NSXPCListener(machServiceName: ProductIdentity.service)
    private let handle: @MainActor (ProviderRequest) -> ProviderResponse
    private var connections: [ObjectIdentifier: NSXPCConnection] = [:]

    init(handle: @escaping @MainActor (ProviderRequest) -> ProviderResponse) {
        self.handle = handle
        super.init()
        listener.delegate = self
        listener.resume()
    }

    nonisolated func listener(_ listener: NSXPCListener,
                              shouldAcceptNewConnection incoming: NSXPCConnection) -> Bool {
        let accepted = AcceptedConnection(value: incoming)
        Task { @MainActor [weak self] in
            let incoming = accepted.value
            guard let self else { incoming.invalidate(); return }
            let app = ProductIdentity.appBundle
            let provider = app.appendingPathComponent("Contents/Extensions/WallpaperProvider.appex")
            guard NativeWire.accepts(incoming, bundles: [app, provider]) else {
                incoming.invalidate()
                return
            }
            let id = ObjectIdentifier(incoming)
            incoming.exportedInterface = NSXPCInterface(with: ConnectorAgentXPC.self)
            incoming.exportedObject = AgentPeer(handle: self.handle)
            incoming.invalidationHandler = { [weak self, weak incoming] in
                Task { @MainActor in
                    guard let self, let incoming else { return }
                    self.connections[ObjectIdentifier(incoming)] = nil
                }
            }
            self.connections[id] = accepted.value
            incoming.resume()
        }
        return true
    }
}

private final class LockedAgentReply: @unchecked Sendable {
    private let lock = NSLock()
    private var value: ProviderResponse?

    func store(_ value: ProviderResponse?) {
        lock.lock()
        self.value = value
        lock.unlock()
    }

    func load() -> ProviderResponse? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

enum AgentClient {
    static func perform(_ request: ProviderRequest, agentBundle: URL,
                        timeout: TimeInterval = 3) -> ProviderResponse? {
        guard let requirement = try? NativeWire.requirement(for: agentBundle),
              let data = try? NativeWire.encode(request) else { return nil }
        let connection = NSXPCConnection(machServiceName: ProductIdentity.service)
        connection.setCodeSigningRequirement(requirement)
        connection.remoteObjectInterface = NSXPCInterface(with: ConnectorAgentXPC.self)
        connection.resume()
        defer { connection.invalidate() }

        let semaphore = DispatchSemaphore(value: 0)
        let result = LockedAgentReply()
        let remote = connection.remoteObjectProxyWithErrorHandler { _ in semaphore.signal() }
        guard let agent = remote as? ConnectorAgentXPC else { return nil }
        agent.perform(data) { data in
            if let data, let response = try? NativeWire.decode(ProviderResponse.self, from: data),
               response.isValid {
                result.store(response)
            }
            semaphore.signal()
        }
        guard semaphore.wait(timeout: .now() + timeout) == .success else { return nil }
        return result.load()
    }

    static func show(agentBundle: URL, timeout: TimeInterval = 3) -> Bool {
        perform(ProviderRequest(action: .show), agentBundle: agentBundle,
            timeout: timeout)?.accepted == true
    }
}
