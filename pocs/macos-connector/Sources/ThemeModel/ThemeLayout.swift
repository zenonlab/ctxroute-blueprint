import Foundation

public struct LayoutRect: Equatable, Sendable {
    public let x: Double, y: Double, width: Double, height: Double
    public func contains(_ point: ScenePoint) -> Bool {
        point.x >= x && point.y >= y && point.x < x + width && point.y < y + height
    }
}

/// Coordinates are local top-left points. Renderer and input share this geometry.
public enum ThemeLayout {
    // PoC proxy for sparse scene objects. The production scene contract will
    // supply explicit 2D/3D interaction shapes; tiny visual geometry must not
    // become the only clickable area in the native connector.
    public static let minimumObjectHitWidth = 112.0
    public static let minimumObjectHitHeight = 70.0

    public static func control(_ index: Int) -> LayoutRect {
        LayoutRect(x: 24 + Double(index) * 48, y: 56, width: 40, height: 40)
    }
    public static func position(_ object: Theme.Object, theme: Theme, width: Double, height: Double,
                                elapsed: Double) -> ScenePoint {
        if let x = object.x, let y = object.y { return ScenePoint(x: x * width, y: y * height) }
        let fraction = theme.motion_path == "still" ? 0 : max(0, elapsed).truncatingRemainder(dividingBy: theme.period_seconds) / theme.period_seconds
        let step = fraction * 128, start = floor(step), blend = step - start
        func sample(_ n: Double) -> ScenePoint {
            let angle = (n / 128 + object.phase) * 2 * Double.pi
            return ScenePoint(x: width * (0.5 + cos(angle) * 0.3),
                              y: height * (0.5 - sin(angle * (theme.motion_path == "wave" ? 2 : 1)) * 0.26))
        }
        let a = sample(start), b = sample(start + 1)
        return ScenePoint(x: a.x + (b.x - a.x) * blend, y: a.y + (b.y - a.y) * blend)
    }
    public static func hit(_ point: ScenePoint, theme: Theme, width: Double, height: Double,
                           elapsed: Double) -> SceneHit {
        guard point.isFinite, width > 0, height > 0, elapsed.isFinite,
              point.x >= 0, point.y >= 0, point.x < width, point.y < height else { return .unknown }
        for (index, control) in theme.system_controls.items.enumerated() where Self.control(index).contains(point) {
            if control == "audio" { return .control(.audio) }
            if control == "desktop" { return .control(.desktopItems) }
        }
        let objectHits = theme.objects.enumerated().compactMap { index, object -> (Int, String, Double)? in
            let center = position(object, theme: theme, width: width, height: height, elapsed: elapsed)
            let visualHalfSize = (object.size ?? 44) / 2
            let halfWidth = max(visualHalfSize, minimumObjectHitWidth / 2)
            let halfHeight = max(visualHalfSize, minimumObjectHitHeight / 2)
            let dx = abs(point.x - center.x), dy = abs(point.y - center.y)
            guard dx <= halfWidth, dy <= halfHeight else { return nil }
            return (index, object.id, hypot(dx / halfWidth, dy / halfHeight))
        }
        // Nearest target wins. Equal targets preserve the visual stacking rule:
        // the last object in the manifest is on top.
        if let nearest = objectHits.min(by: {
            $0.2 == $1.2 ? $0.0 > $1.0 : $0.2 < $1.2
        }) { return .object(nearest.1) }
        return .empty
    }
}

public struct SurfaceLayout: Codable, Sendable {
    public let id: UUID, theme_id: String
    public let display_id: UInt32?
    public let width: Double, height: Double, captured_at: Double, elapsed: Double
    public let running: Bool, interactive: Bool
    public init(id: UUID, theme: String, display: UInt32?, width: Double, height: Double,
                capturedAt: Double, elapsed: Double, running: Bool, interactive: Bool) {
        self.id = id; theme_id = theme; display_id = display; self.width = width; self.height = height
        captured_at = capturedAt; self.elapsed = elapsed; self.running = running; self.interactive = interactive
    }
    public func time(at now: Double) -> Double { elapsed + (running ? max(0, now - captured_at) : 0) }
    public var valid: Bool {
        [width, height, captured_at, elapsed].allSatisfy(\.isFinite)
        && (1...16384).contains(width) && (1...16384).contains(height) && elapsed >= 0
    }
    /// macOS can publish two active representations of one desktop. Choose no
    /// arbitrary winner: every candidate must agree on the semantic hit now.
    public static func consensus(_ candidates: [SurfaceLayout], theme: Theme, point: ScenePoint, now: Double) -> SurfaceLayout? {
        guard now.isFinite, let first = candidates.sorted(by: { $0.id.uuidString < $1.id.uuidString }).first,
              first.valid, first.interactive else { return nil }
        let hit = ThemeLayout.hit(point, theme: theme, width: first.width, height: first.height, elapsed: first.time(at: now))
        guard hit != .unknown, candidates.allSatisfy({ candidate in
            candidate.valid && candidate.interactive && candidate.theme_id == theme.theme_id
            && candidate.display_id == first.display_id && candidate.width == first.width && candidate.height == first.height
            && ThemeLayout.hit(point, theme: theme, width: candidate.width, height: candidate.height,
                elapsed: candidate.time(at: now)) == hit
        }) else { return nil }
        return first
    }
}
