import AppKit
import ExtensionFoundation
import IOSurface
import os

func extensionLog(_ text: String) { Logger(subsystem: "org.wallpaperthemes.connectorpoc2", category: "provider").notice("\(text, privacy: .public)") }
func traceLog(_ text: String) { extensionLog(text) }

@main final class ConnectorExtension: NSObject, AppExtension {
    override required init() {
        super.init()
        _ = dlopen("/System/Library/PrivateFrameworks/WallpaperExtensionKit.framework/WallpaperExtensionKit", RTLD_NOW)
        extensionLog("Provider initialized")
    }
    var configuration: some AppExtensionConfiguration { ProviderConfiguration() }
}

/// XPC arguments are only inspected after dispatching to the main actor.
struct Incoming: @unchecked Sendable { let id: Any?; let request: Any? }

@MainActor final class Provider {
    static let shared = Provider()
    struct Surface {
        let context: CAContext
        var scene: Scene
        var themeID: String
        var suspended: Bool
        var display: UInt32?
    }
    var themes: [Theme]
    var sessions: [String: Session]
    var surfaces: [UUID: Surface] = [:]
    var transport: ProviderTransport?
    var screenSleeping = false
    var sessionInactive = false
    var sleeping: Bool { screenSleeping || sessionInactive }
    var teardown: [UUID: Task<Void, Never>] = [:]
    init() {
        themes = (try? Theme.catalog()) ?? []
        sessions = Dictionary(uniqueKeysWithValues: themes.map { ($0.theme_id, Session(themeID: $0.theme_id)) })
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.screensDidSleepNotification, NSWorkspace.screensDidWakeNotification,
                     NSWorkspace.sessionDidResignActiveNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    switch name {
                    case NSWorkspace.screensDidSleepNotification: self?.screenSleeping = true
                    case NSWorkspace.screensDidWakeNotification: self?.screenSleeping = false
                    case NSWorkspace.sessionDidResignActiveNotification: self?.sessionInactive = true
                    default: self?.sessionInactive = false
                    }
                    self?.apply()
                }
            }
        }
        transport = ProviderTransport(execute: { [weak self] command in self?.receive(command) },
            snapshot: { [weak self] in self?.catalogStatus() })
        publish()
    }
    func catalogStatus() -> CatalogStatus {
        let states = themes.compactMap { theme -> ProviderStatus? in
            guard let session = sessions[theme.theme_id] else { return nil }
            return ProviderStatus(session: session,
                surfaces: surfaces.values.filter { $0.themeID == theme.theme_id }.count, configuration: theme)
        }
        let layouts = surfaces.map { id, surface in
            surface.scene.layout(id: id, display: surface.display, interactive: !sleeping && !surface.suspended)
        }
        return CatalogStatus(themes: states, layouts: layouts)
    }
    func publish() { transport?.publish(catalogStatus()) }
    func receive(_ command: Command) -> CatalogStatus? {
        guard var session = sessions[command.theme_id] else { return nil }
        let previousGeneration = session.generation
        let receipt = session.apply(command)
        // Preflight the complete reply before committing. A valid individual
        // manifest must not make the bounded catalog impossible to transmit.
        var projected = catalogStatus()
        let configuration = receipt.status == .applied ? command.configuration : nil
        let projectedThemes = projected.themes.map { state in
            state.theme_id == command.theme_id
                ? ProviderStatus(session: session, surfaces: state.surfaces, configuration: configuration ?? state.configuration)
                : state
        }
        projected = CatalogStatus(themes: projectedThemes, layouts: projected.layouts ?? [])
        guard (try? NativeWire.encode(projected)) != nil else { return nil }
        sessions[command.theme_id] = session
        if receipt.status == .applied && session.generation != previousGeneration {
            if let configuration = command.configuration, command.action == .configure,
               let index = themes.firstIndex(where: { $0.theme_id == command.theme_id }) {
                themes[index] = configuration
                for id in Array(surfaces.keys) {
                    guard var surface = surfaces[id], surface.themeID == command.theme_id else { continue }
                    let size = surface.scene.root.bounds.size, scale = surface.scene.root.contentsScale
                    let elapsed = surface.scene.layout(id: id, display: surface.display, interactive: false).elapsed
                    surface.scene = Scene(theme: configuration); surface.scene.resize(size, scale: scale, initialElapsed: elapsed)
                    surface.context.layer = surface.scene.root; surfaces[id] = surface
                }
            }
            apply(publishStatus: false)
        }
        extensionLog("XPC command=\(command.action.rawValue) result=\(receipt.status.rawValue) generation=\(session.generation)")
        return catalogStatus()
    }
    func apply(publishStatus: Bool = true) {
        for surface in surfaces.values {
            guard let state = sessions[surface.themeID]?.state else { continue }
            surface.scene.apply(state, suspended: sleeping || surface.suspended)
        }
        CATransaction.flush()
        if publishStatus { publish() }
    }
    func acquire(_ incoming: Incoming) -> AnyObject? {
        guard let configuration = named(incoming.request, "configuration") as? Data,
              let themeID = String(data: configuration, encoding: .utf8),
              let theme = themes.first(where: { $0.theme_id == themeID }),
              let session = sessions[themeID],
              let id = field(incoming.id, type: UUID.self),
              let size = named(incoming.request, "size") as? CGSize,
              size.width.isFinite, size.height.isFinite,
              (1...16384).contains(size.width), (1...16384).contains(size.height)
        else { extensionLog("Unsupported acquire layout"); return nil }
        teardown[id]?.cancel(); teardown[id] = nil
        let scale = (named(incoming.request, "scaleFactor") as? CGFloat) ?? 1
        guard scale.isFinite, (0.5...4).contains(scale) else { return nil }
        if var existing = surfaces[id] {
            if existing.themeID != themeID {
                existing.scene = Scene(theme: theme); existing.themeID = themeID
                existing.scene.resize(size, scale: scale)
                existing.context.layer = existing.scene.root
            }
            existing.suspended = false
            existing.display = named(incoming.request, "directDisplayID") as? UInt32
            surfaces[id] = existing
            existing.scene.resize(size, scale: scale); apply()
            extensionLog("Reused native surface")
            return createRemoteContextXPC(contextId: existing.context.contextId)
        }
        guard surfaces.count < 16 else { return nil }
        let display = named(incoming.request, "directDisplayID") as? UInt32
        let raw: Any? = display.map { CAContext.remoteContext(withOptions: ["displayId": $0]) } ?? CAContext.remoteContext()
        guard let context = raw as? CAContext, context.contextId != 0 else { return nil }
        let scene = Scene(theme: theme); scene.resize(size, scale: scale)
        scene.apply(session.state, suspended: sleeping)
        context.layer = scene.root
        surfaces[id] = Surface(context: context, scene: scene, themeID: themeID, suspended: false, display: display)
        CATransaction.flush(); publish()
        extensionLog("Created native surface count=\(surfaces.count)")
        return createRemoteContextXPC(contextId: context.contextId)
    }
    func update(_ incoming: Incoming) {
        guard let id = field(incoming.id, type: UUID.self), var surface = surfaces[id] else { return }
        // Unknown Apple states do not imply occlusion. Lock/idle are conservative pauses.
        if let activity = named(incoming.request, "activityState") {
            let value = String(describing: activity)
            surface.suspended = value == "idle"
        }
        if let presentation = named(incoming.request, "presentationMode"), String(describing: presentation) == "locked" {
            surface.suspended = true
        }
        surfaces[id] = surface; apply()
        extensionLog("Updated native surface suspended=\(surface.suspended)")
    }
    func invalidate(_ incoming: Incoming) {
        guard let id = field(incoming.id, type: UUID.self), var surface = surfaces[id] else { return }
        surface.suspended = true; surfaces[id] = surface; apply()
        extensionLog("Invalidated native surface; retaining scene for grace period")
        teardown[id]?.cancel()
        teardown[id] = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self else { return }
            surfaces[id]?.context.layer = nil
            surfaces[id] = nil; teardown[id] = nil; publish()
            extensionLog("Released invalidated native surface count=\(surfaces.count)")
        }
    }
    func snapshot(_ incoming: Incoming) -> AnyObject? {
        guard let id = field(incoming.id, type: UUID.self),
              let active = surfaces[id], let theme = themes.first(where: { $0.theme_id == active.themeID }),
              let session = sessions[active.themeID] else { return nil }
        let size = CGSize(width: 480, height: 270)
        guard let surface = IOSurface(properties: [.width: 480, .height: 270,
            .bytesPerElement: 4, .bytesPerRow: 1920, .allocSize: 518400,
            .pixelFormat: UInt32(0x42475241)]) else { return nil }
        surface.lock(options: [], seed: nil); defer { surface.unlock(options: [], seed: nil) }
        guard let context = CGContext(data: surface.baseAddress, width: 480, height: 270,
            bitsPerComponent: 8, bytesPerRow: 1920, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue)
        else { return nil }
        let scene = Scene(theme: theme); scene.resize(size); scene.apply(session.state)
        scene.root.render(in: context)
        return createSnapshotXPC(surface: surface)
    }
}

func named(_ value: Any?, _ name: String, depth: Int = 0) -> Any? {
    guard let value, depth < 7 else { return nil }
    for child in Mirror(reflecting: value).children {
        if child.label == name { return child.value }
        if let found = named(child.value, name, depth: depth + 1) { return found }
    }
    return nil
}
func field<T>(_ value: Any?, type: T.Type, depth: Int = 0) -> T? {
    guard let value, depth < 7 else { return nil }
    if let typed = value as? T { return typed }
    for child in Mirror(reflecting: value).children {
        if let found = field(child.value, type: type, depth: depth + 1) { return found }
    }
    return nil
}

final class WallpaperXPCHandler: NSObject, WallpaperExtensionXPCProtocol {
    func acquire(withId id: Any?, request: Any?, reply: @escaping @Sendable (Any?, Error?) -> Void) {
        let args = Incoming(id: id, request: request)
        Task { @MainActor in
            let result = Provider.shared.acquire(args)
            reply(result, result == nil ? Self.unsupported : nil)
        }
    }
    func update(withId id: Any?, request: Any?, reply: @escaping @Sendable (Error?) -> Void) {
        let args = Incoming(id: id, request: request)
        Task { @MainActor in Provider.shared.update(args); reply(nil) }
    }
    func invalidate(withId id: Any?, reply: @escaping @Sendable (Error?) -> Void) {
        let args = Incoming(id: id, request: nil)
        Task { @MainActor in Provider.shared.invalidate(args); reply(nil) }
    }
    func snapshot(withId id: Any?, reply: @escaping @Sendable (Any?, Error?) -> Void) {
        let args = Incoming(id: id, request: nil)
        Task { @MainActor in
            let result = Provider.shared.snapshot(args); reply(result, result == nil ? Self.unsupported : nil)
        }
    }
    func provideSettingsViewModels(withContentTypes types: Any?, reply: @escaping @Sendable (Any?, Error?) -> Void) {
        Task { @MainActor in
            Provider.shared.publish()
            let result = makeCatalog(); reply(result, result == nil ? Self.unsupported : nil)
        }
    }
    static var unsupported: NSError { NSError(domain: "ConnectorPoC2", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Capability or private runtime unavailable"]) }
    func addChoiceRequest(withChoiceRequest r: Any?, onBehalfOfProcess p: Any?, reply: @escaping @Sendable (Any?, Error?) -> Void) { reply(nil, Self.unsupported) }
    func removeChoiceRequest(withChoiceRequest r: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func selectedChoicesDidChange(for id: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(nil) }
    func invokeContextMenuAction(withMenuItemID m: Any?, groupItemID g: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func isChoiceDownloaded(with id: Any?, reply: @escaping @Sendable (NSNumber?, Error?) -> Void) { reply(NSNumber(value: true), nil) }
    func download(withChoiceID id: Any?, reply: @escaping (Error?) -> Void) -> Any? { reply(Self.unsupported); return nil }
    func pauseDownload(for id: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func cancelDownload(for id: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func resumeDownload(for id: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func removeDownload(for id: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func migrateSelectedChoice(for id: Any?, reply: @escaping @Sendable (Any?, Error?) -> Void) { reply(nil, Self.unsupported) }
    func migrate(from f: Any?, to t: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func skipShuffledContent(withId id: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func canSkipShuffledContent(withId id: Any?, reply: @escaping @Sendable (Bool, Error?) -> Void) { reply(false, nil) }
    func handleDebugRequest(for r: Any?, reply: @escaping @Sendable (Any?, Error?) -> Void) { reply(nil, Self.unsupported) }
    func handleNotification(withNamed n: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(nil) }
}
