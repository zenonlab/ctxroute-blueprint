import Foundation

public struct FormationTheme: Codable, Equatable, Sendable {
    public struct Track: Codable, Equatable, Sendable {
        public let centerX: Double
        public let centerY: Double
        public let radiusX: Double
        public let radiusY: Double
        public let periodSeconds: Double
    }

    public struct Object: Codable, Equatable, Sendable {
        public let id: String
        public let label: String
        public let colorHex: String
        public let laneOffset: Double
        public let trailingOffset: Double
    }

    public let schemaVersion: Int
    public let track: Track
    public let objects: [Object]

    public static func decode(_ data: Data) throws -> FormationTheme {
        let theme = try JSONDecoder().decode(FormationTheme.self, from: data)
        try theme.validate()
        return theme
    }

    public func validate() throws {
        guard schemaVersion == 1 else { throw FormationThemeError.unsupportedSchema }
        guard (1...8).contains(objects.count), track.periodSeconds.isFinite,
              track.periodSeconds >= 1, track.centerX.isFinite, track.centerY.isFinite,
              track.radiusX.isFinite, track.radiusY.isFinite,
              track.radiusX > 0, track.radiusY > 0 else {
            throw FormationThemeError.invalidGeometry
        }
        let ids = objects.map(\.id)
        guard Set(ids).count == ids.count, ids.allSatisfy({ !$0.isEmpty }) else {
            throw FormationThemeError.invalidObjectIdentity
        }
        guard objects.allSatisfy({ object in
            object.laneOffset.isFinite && object.trailingOffset.isFinite &&
            abs(object.laneOffset) <= 0.15 && abs(object.trailingOffset) <= 0.35 &&
            object.colorHex.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil
        }) else { throw FormationThemeError.invalidObjectAppearance }
    }
}

public enum FormationThemeError: Error, Equatable {
    case unsupportedSchema
    case invalidGeometry
    case invalidObjectIdentity
    case invalidObjectAppearance
}

public struct FormationObjectSnapshot: Equatable, Sendable {
    public let id: String
    public let label: String
    public let colorHex: String
    public let centerX: Double
    public let centerY: Double
    public let headingRadians: Double
}

public struct FormationSnapshot: Equatable, Sendable {
    public let phaseSeconds: Double
    public let objects: [FormationObjectSnapshot]
}

/// Pure, deterministic formation solver. Render surfaces never run their own simulation.
public struct FormationEngine: Sendable {
    public let theme: FormationTheme
    private let pacedEllipses: [PacedEllipse]

    public init(theme: FormationTheme) {
        self.theme = theme
        self.pacedEllipses = theme.objects.map { object in
            PacedEllipse(radiusX: theme.track.radiusX + object.laneOffset,
                         radiusY: theme.track.radiusY + object.laneOffset * 0.7)
        }
    }

    public func snapshot(phaseSeconds: Double) -> FormationSnapshot {
        let safePhase = phaseSeconds.isFinite ? phaseSeconds : 0
        let baseProgress = safePhase / theme.track.periodSeconds
        let objects = theme.objects.enumerated().map { index, object in
            let trailingProgress = object.trailingOffset / (2 * Double.pi)
            let angle = pacedEllipses[index].angle(at: baseProgress - trailingProgress)
            let radiusX = theme.track.radiusX + object.laneOffset
            let radiusY = theme.track.radiusY + object.laneOffset * 0.7
            let tangentX = -radiusX * sin(angle)
            let tangentY = radiusY * cos(angle)
            return FormationObjectSnapshot(
                id: object.id,
                label: object.label,
                colorHex: object.colorHex,
                centerX: theme.track.centerX + radiusX * cos(angle),
                centerY: theme.track.centerY + radiusY * sin(angle),
                headingRadians: atan2(tangentY, tangentX)
            )
        }
        return FormationSnapshot(phaseSeconds: safePhase, objects: objects)
    }

    public func hitTest(normalizedX: Double, normalizedY: Double,
                        halfWidth: Double, halfHeight: Double,
                        phaseSeconds: Double) -> String? {
        guard normalizedX.isFinite, normalizedY.isFinite,
              halfWidth.isFinite, halfHeight.isFinite,
              halfWidth > 0, halfHeight > 0 else { return nil }
        return snapshot(phaseSeconds: phaseSeconds).objects.compactMap { object -> (String, Double)? in
            let deltaX = abs(object.centerX - normalizedX)
            let deltaY = abs(object.centerY - normalizedY)
            guard deltaX <= halfWidth, deltaY <= halfHeight else { return nil }
            return (object.id, hypot(deltaX / halfWidth, deltaY / halfHeight))
        }.min { $0.1 < $1.1 }?.0
    }
}

/// Mirrors Core Animation's paced traversal of an ellipse without querying its presentation layer.
/// The lookup table is immutable and built once; snapshots only perform a binary search.
private struct PacedEllipse: Sendable {
    private static let segmentCount = 1_024
    private let cumulativeLengths: [Double]

    init(radiusX: Double, radiusY: Double) {
        var lengths = [Double](repeating: 0, count: Self.segmentCount + 1)
        var previous = CGPoint(x: radiusX, y: 0)
        for index in 1...Self.segmentCount {
            let angle = Double(index) / Double(Self.segmentCount) * 2 * Double.pi
            let point = CGPoint(x: radiusX * cos(angle), y: radiusY * sin(angle))
            lengths[index] = lengths[index - 1] + hypot(point.x - previous.x, point.y - previous.y)
            previous = point
        }
        let total = lengths[Self.segmentCount]
        self.cumulativeLengths = lengths.map { $0 / total }
    }

    func angle(at progress: Double) -> Double {
        var normalized = progress.truncatingRemainder(dividingBy: 1)
        if normalized < 0 { normalized += 1 }
        var lower = 0
        var upper = Self.segmentCount
        while lower + 1 < upper {
            let middle = (lower + upper) / 2
            if cumulativeLengths[middle] <= normalized { lower = middle } else { upper = middle }
        }
        let span = cumulativeLengths[upper] - cumulativeLengths[lower]
        let fraction = span > 0 ? (normalized - cumulativeLengths[lower]) / span : 0
        return (Double(lower) + fraction) / Double(Self.segmentCount) * 2 * Double.pi
    }
}
