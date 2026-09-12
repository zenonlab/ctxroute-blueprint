import Foundation

public struct RenderHostControlState: Codable, Equatable, Sendable {
    public let schema_version: Int
    public let generation: UInt64
    public let audio_volume: Double
    public let desktop_items_visible: Bool?
    public let brightness: Double
    public let visual_paused: Bool
    public let overrides: ThemeInterfaceOverrides?

    public init(generation: UInt64, audioVolume: Double, desktopItemsVisible: Bool?, brightness: Double,
                visualPaused: Bool,
                overrides: ThemeInterfaceOverrides? = nil) throws {
        guard audioVolume.isFinite, (0...1).contains(audioVolume),
              brightness.isFinite, (0...1).contains(brightness),
              overrides.map({ $0.schema_version == 2 }) ?? true else {
            throw ModelError.invalid("invalid RenderHost control state")
        }
        schema_version = 2
        self.generation = generation
        audio_volume = audioVolume
        desktop_items_visible = desktopItemsVisible
        self.brightness = brightness
        visual_paused = visualPaused
        self.overrides = overrides
    }
}
