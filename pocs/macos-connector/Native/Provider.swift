import AppKit
import ExtensionFoundation
import IOSurface
import os

func extensionLog(_ text: String) {
    Logger(subsystem: ProductIdentity.logSubsystem, category: "provider")
        .notice("\(text, privacy: .public)")
}
func traceLog(_ text: String) { extensionLog(text) }

@main final class ConnectorExtension: NSObject, AppExtension {
    override required init() {
        super.init()
        _ = dlopen("/System/Library/PrivateFrameworks/WallpaperExtensionKit.framework/WallpaperExtensionKit", RTLD_NOW)
        extensionLog("External-catalog provider initialized")
    }
    var configuration: some AppExtensionConfiguration { ProviderConfiguration() }
}

struct Incoming: @unchecked Sendable {
    let id: Any?
    let request: Any?
}

@MainActor final class Provider {
    static let shared = Provider()

    struct Surface {
        let context: CAContext
        let layer: CALayer
        var themeID: String
    }

    private let transport = ProviderTransport()
    private var catalog: [ProviderCatalogItem] = []
    private var surfaces: [UUID: Surface] = [:]

    func settings(completion: @escaping @MainActor (AnyObject?) -> Void) {
        transport.perform(ProviderRequest(action: .catalog)) { [weak self] response in
            guard let self, let response, response.accepted, let items = response.catalog else {
                completion(self.flatMap { makeCatalog(items: $0.catalog) })
                return
            }
            self.catalog = items
            completion(makeCatalog(items: items))
        }
    }

    func acquire(_ incoming: Incoming,
                 completion: @escaping @MainActor (AnyObject?, Error?) -> Void) {
        guard let configuration = named(incoming.request, "configuration") as? Data,
              configuration.count <= 96,
              let themeID = String(data: configuration, encoding: .utf8),
              catalog.contains(where: { $0.id == themeID }),
              let id = field(incoming.id, type: UUID.self),
              let size = named(incoming.request, "size") as? CGSize,
              size.width.isFinite, size.height.isFinite,
              (1...16384).contains(size.width), (1...16384).contains(size.height) else {
            completion(nil, WallpaperXPCHandler.unsupported)
            return
        }
        let scale = (named(incoming.request, "scaleFactor") as? CGFloat) ?? 1
        guard scale.isFinite, (0.5...4).contains(scale),
              let remote = surface(id: id, themeID: themeID, size: size, scale: scale) else {
            completion(nil, WallpaperXPCHandler.unsupported)
            return
        }
        transport.perform(ProviderRequest(action: .activate, themeID: themeID)) { response in
            guard response?.accepted == true else {
                extensionLog("Activation rejected for external theme id=\(themeID)")
                completion(nil, WallpaperXPCHandler.unsupported)
                return
            }
            extensionLog("External theme activated id=\(themeID)")
            completion(remote, nil)
        }
    }

    private func surface(id: UUID, themeID: String, size: CGSize, scale: CGFloat) -> AnyObject? {
        if var existing = surfaces[id] {
            existing.themeID = themeID
            existing.layer.frame = CGRect(origin: .zero, size: size)
            existing.layer.contentsScale = scale
            surfaces[id] = existing
            return createRemoteContextXPC(contextId: existing.context.contextId)
        }
        guard surfaces.count < 16,
              let context = CAContext.remoteContext() as? CAContext, context.contextId != 0 else { return nil }
        let layer = CALayer()
        layer.frame = CGRect(origin: .zero, size: size)
        layer.contentsScale = scale
        layer.backgroundColor = NSColor.clear.cgColor
        context.layer = layer
        surfaces[id] = Surface(context: context, layer: layer, themeID: themeID)
        CATransaction.flush()
        return createRemoteContextXPC(contextId: context.contextId)
    }

    func invalidate(_ incoming: Incoming) {
        guard let id = field(incoming.id, type: UUID.self), let surface = surfaces.removeValue(forKey: id) else { return }
        surface.context.layer = nil
    }

    func snapshot() -> AnyObject? {
        let width = 480
        let height = 270
        guard let surface = IOSurface(properties: [.width: width, .height: height,
            .bytesPerElement: 4, .bytesPerRow: width * 4, .allocSize: width * height * 4,
            .pixelFormat: UInt32(0x42475241)]) else { return nil }
        surface.lock(options: [], seed: nil)
        defer { surface.unlock(options: [], seed: nil) }
        guard let context = CGContext(data: surface.baseAddress, width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue |
                CGImageAlphaInfo.premultipliedFirst.rawValue) else { return nil }
        context.setFillColor(NSColor(calibratedRed: 0.055, green: 0.075, blue: 0.12, alpha: 1).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setStrokeColor(NSColor(calibratedRed: 0.25, green: 0.82, blue: 0.72, alpha: 1).cgColor)
        context.setLineWidth(10)
        context.strokeEllipse(in: CGRect(x: 108, y: 51, width: 264, height: 168))
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
    func acquire(withId id: Any?, request: Any?,
                 reply: @escaping @Sendable (Any?, Error?) -> Void) {
        let incoming = Incoming(id: id, request: request)
        Task { @MainActor in Provider.shared.acquire(incoming) { result, error in reply(result, error) } }
    }
    func update(withId id: Any?, request: Any?, reply: @escaping @Sendable (Error?) -> Void) {
        reply(nil)
    }
    func invalidate(withId id: Any?, reply: @escaping @Sendable (Error?) -> Void) {
        let incoming = Incoming(id: id, request: nil)
        Task { @MainActor in Provider.shared.invalidate(incoming); reply(nil) }
    }
    func snapshot(withId id: Any?, reply: @escaping @Sendable (Any?, Error?) -> Void) {
        Task { @MainActor in
            let result = Provider.shared.snapshot()
            reply(result, result == nil ? Self.unsupported : nil)
        }
    }
    func provideSettingsViewModels(withContentTypes types: Any?,
                                   reply: @escaping @Sendable (Any?, Error?) -> Void) {
        Task { @MainActor in
            Provider.shared.settings { result in reply(result, result == nil ? Self.unsupported : nil) }
        }
    }

    static var unsupported: NSError {
        NSError(domain: "OrbiteWallpaper", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Capability or private runtime unavailable"])
    }
    func addChoiceRequest(withChoiceRequest r: Any?, onBehalfOfProcess p: Any?,
                          reply: @escaping @Sendable (Any?, Error?) -> Void) { reply(nil, Self.unsupported) }
    func removeChoiceRequest(withChoiceRequest r: Any?,
                             reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func selectedChoicesDidChange(for id: Any?,
                                  reply: @escaping @Sendable (Error?) -> Void) { reply(nil) }
    func invokeContextMenuAction(withMenuItemID m: Any?, groupItemID g: Any?,
                                 reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func isChoiceDownloaded(with id: Any?,
                            reply: @escaping @Sendable (NSNumber?, Error?) -> Void) {
        reply(NSNumber(value: true), nil)
    }
    func download(withChoiceID id: Any?, reply: @escaping (Error?) -> Void) -> Any? {
        reply(Self.unsupported)
        return nil
    }
    func pauseDownload(for id: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func cancelDownload(for id: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func resumeDownload(for id: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func removeDownload(for id: Any?, reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func migrateSelectedChoice(for id: Any?,
                               reply: @escaping @Sendable (Any?, Error?) -> Void) { reply(nil, Self.unsupported) }
    func migrate(from f: Any?, to t: Any?,
                 reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func skipShuffledContent(withId id: Any?,
                             reply: @escaping @Sendable (Error?) -> Void) { reply(Self.unsupported) }
    func canSkipShuffledContent(withId id: Any?,
                                reply: @escaping @Sendable (Bool, Error?) -> Void) { reply(false, nil) }
    func handleDebugRequest(for r: Any?,
                            reply: @escaping @Sendable (Any?, Error?) -> Void) { reply(nil, Self.unsupported) }
    func handleNotification(withNamed n: Any?,
                            reply: @escaping @Sendable (Error?) -> Void) { reply(nil) }
}
