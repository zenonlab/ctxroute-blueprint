import Foundation

public enum ProbeMode: String, Sendable {
    case window, desktop
}

public struct ProbeOptions: Sendable {
    public let mode: ProbeMode
    public let duration: TimeInterval
    public let smoke: Bool
    public let snapshot: Bool

    public static let usage = """
    SurfaceProbe [--mode window|desktop] [--duration 1...600] [--smoke] [--snapshot]
    Défaut : fenêtre statique, arrêt après 60 s. Smoke : fenêtre, durée minimale 4 s.
    --snapshot : capture de notre vue seule, uniquement avec --smoke.
    Mode desktop : strictement passif, sans focus ni clics ; Ctrl-C pour arrêter.
    """

    public static func parse(_ arguments: [String]) throws -> Self {
        var values: [String: String] = [:]
        var flags = Set<String>()
        var index = 0
        while index < arguments.count {
            let key = arguments[index]
            guard values[key] == nil, !flags.contains(key) else {
                throw OptionError.invalid("Option répétée : \(key)")
            }
            switch key {
            case "--smoke", "--snapshot":
                flags.insert(key)
            case "--mode", "--duration":
                index += 1
                guard index < arguments.count else { throw OptionError.invalid("Valeur manquante : \(key)") }
                values[key] = arguments[index]
            default:
                throw OptionError.invalid("Option inconnue")
            }
            index += 1
        }
        guard let mode = ProbeMode(rawValue: values["--mode"] ?? "window") else {
            throw OptionError.invalid("Mode inconnu")
        }
        guard let duration = Double(values["--duration"] ?? "60"),
              duration.isFinite, (1...600).contains(duration) else {
            throw OptionError.invalid("Durée attendue : nombre fini entre 1 et 600 secondes")
        }
        let smoke = flags.contains("--smoke")
        let snapshot = flags.contains("--snapshot")
        guard !smoke || (mode == .window && duration >= 4) else {
            throw OptionError.invalid("Smoke réservé à la fenêtre avec durée >= 4 secondes")
        }
        guard !snapshot || smoke else { throw OptionError.invalid("Snapshot réservé au smoke") }
        return Self(mode: mode, duration: duration, smoke: smoke, snapshot: snapshot)
    }
}

public enum OptionError: Error, CustomStringConvertible {
    case invalid(String)
    public var description: String {
        switch self { case .invalid(let message): return message }
    }
}
