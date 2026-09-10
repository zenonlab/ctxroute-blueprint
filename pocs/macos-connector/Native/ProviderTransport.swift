import Foundation

@MainActor private final class ProviderReplyGate {
    private var delivered = false
    private let completion: @MainActor (ProviderResponse?) -> Void

    init(completion: @escaping @MainActor (ProviderResponse?) -> Void) {
        self.completion = completion
    }

    func finish(_ response: ProviderResponse?) {
        guard !delivered else { return }
        delivered = true
        completion(response)
    }
}

@MainActor final class ProviderTransport {
    private var connection: NSXPCConnection?

    init() {
        connect()
    }

    private func connect() {
        guard connection == nil else { return }
        do {
            let connection = NSXPCConnection(machServiceName: NativeWire.service)
            connection.setCodeSigningRequirement(try NativeWire.embeddedAgentRequirement())
            connection.remoteObjectInterface = NSXPCInterface(with: ConnectorAgentXPC.self)
            connection.invalidationHandler = { [weak self, weak connection] in
                Task { @MainActor in
                    guard self?.connection === connection else { return }
                    self?.connection = nil
                }
            }
            connection.interruptionHandler = { [weak connection] in connection?.invalidate() }
            self.connection = connection
            connection.resume()
        } catch {
            extensionLog("Agent XPC unavailable: \(error)")
        }
    }

    func perform(_ request: ProviderRequest,
                 completion: @escaping @MainActor (ProviderResponse?) -> Void) {
        connect()
        guard request.isValid, let connection, let data = try? NativeWire.encode(request) else {
            completion(nil)
            return
        }
        let gate = ProviderReplyGate(completion: completion)
        let remote = connection.remoteObjectProxyWithErrorHandler { [weak connection] error in
            extensionLog("Agent XPC failed: \(error)")
            connection?.invalidate()
            Task { @MainActor in gate.finish(nil) }
        }
        guard let agent = remote as? ConnectorAgentXPC else {
            gate.finish(nil)
            return
        }
        agent.perform(data) { data in
            let response = data.flatMap { try? NativeWire.decode(ProviderResponse.self, from: $0) }
            Task { @MainActor in gate.finish(response?.isValid == true ? response : nil) }
        }
    }
}
