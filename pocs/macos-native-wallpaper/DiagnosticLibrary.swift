import Foundation

// Compatibility surface for the pinned upstream renderer. No imports, migration,
// deletion, video decoding, or recovery notification in this diagnostic library.
struct VideoEntry: Codable {
    let id: String
    var name: String
    var filename: String
    var duration: Double
    var fps: Double
    var resolution: CGSize
    var dateAdded: Date
    var variants: [VideoVariant]?
}

final class VideoLibrary: Sendable {
    static let shared = VideoLibrary()
    let entries: [VideoEntry]
    private init() {
        if let theme = try? DiagnosticTheme.load() {
            entries = [VideoEntry(id: theme.sceneID.uuidString.lowercased(),
                name: theme.displayName, filename: "diagnostic.png", duration: 5,
                fps: 0, resolution: CGSize(width: 480, height: 270),
                dateAdded: Date(timeIntervalSince1970: 0), variants: nil)]
        } else {
            entries = []
        }
    }
    func scan() {}
    func entry(for id: String) -> VideoEntry? { entries.first { $0.id == id } }
    func videoURL(for entry: VideoEntry) -> URL {
        Bundle.main.url(forResource: "diagnostic", withExtension: "png")!
    }
    func videoURL(for id: String) -> URL? { nil }
    func variantURL(for entryId: String, variant: VideoVariant) -> URL? { nil }
    func bestVariantURL(for id: String, policy: PlaybackPolicy) -> URL? { nil }
    func updateVariants(for id: String, variants: [VideoVariant]) {}
    func addVideo(from sourceURL: URL, name: String? = nil) -> String? { nil }
    func removeVideo(id: String) {}
    func updateMetadata(for id: String, duration: Double, fps: Double, resolution: CGSize) {}
    func generateThumbnail(for entry: VideoEntry) async -> URL? {
        Bundle.main.url(forResource: "diagnostic", withExtension: "png")
    }
}

enum SpiralRecovery {
    static func noteHealthyConnection() {}
    static func noteEmptyConnection(pid: Int32) {}
}
