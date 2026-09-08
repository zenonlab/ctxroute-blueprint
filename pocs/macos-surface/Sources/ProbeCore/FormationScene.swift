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

    public init(theme: FormationTheme) { self.theme = theme }

    public func snapshot(phaseSeconds: Double) -> FormationSnapshot {
        let safePhase = phaseSeconds.isFinite ? phaseSeconds : 0
        let baseAngle = safePhase / theme.track.periodSeconds * 2 * Double.pi
        let objects = theme.objects.map { object in
            let angle = baseAngle - object.trailingOffset
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
}
