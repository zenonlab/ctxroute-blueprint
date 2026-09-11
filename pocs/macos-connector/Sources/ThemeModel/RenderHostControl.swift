import Foundation

public struct RenderHostControlState: Codable, Equatable, Sendable {
    public let schema_version: Int
    public let generation: UInt64
    public let muted: Bool
    public let desktop_items_visible: Bool?
    public let brightness: Double
    public let overrides: ThemeInterfaceOverrides?

    public init(generation: UInt64, muted: Bool, desktopItemsVisible: Bool?, brightness: Double,
                overrides: ThemeInterfaceOverrides? = nil) throws {
        guard brightness.isFinite, (0...1).contains(brightness),
              overrides.map({ $0.schema_version == 1 }) ?? true else {
            throw ModelError.invalid("invalid RenderHost control state")
        }
        schema_version = 1
        self.generation = generation
        self.muted = muted
        desktop_items_visible = desktopItemsVisible
        self.brightness = brightness
        self.overrides = overrides
    }
}
