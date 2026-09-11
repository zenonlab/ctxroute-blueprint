import Foundation

public enum TerminalSessionState: String, Codable, CaseIterable, Sendable {
    case idle, active, busy, success, error, recovering, disconnected
}

public struct TerminalSessionSnapshot: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let display_name: String
    public let state: TerminalSessionState
    public let sequence: UInt64

    public init(id: String, displayName: String, state: TerminalSessionState, sequence: UInt64) {
        self.id = id
        display_name = displayName
        self.state = state
        self.sequence = sequence
    }

    public var isValid: Bool {
        id.range(of: "^[a-zA-Z][a-zA-Z0-9._-]{0,95}$", options: .regularExpression) != nil
            && (1...80).contains(display_name.count)
            && !display_name.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }
}

public struct TerminalSessionEvent: Codable, Equatable, Sendable {
    public let event_id: UUID
    public let snapshot: TerminalSessionSnapshot

    public init(id: UUID = UUID(), snapshot: TerminalSessionSnapshot) {
        event_id = id
        self.snapshot = snapshot
    }
}

public enum TerminalSessionIntentKind: String, Codable, Sendable {
    case focus, open
}

public struct TerminalSessionIntent: Codable, Equatable, Sendable {
    public let intent_id: UUID
    public let session_id: String
    public let kind: TerminalSessionIntentKind

    public init(id: UUID = UUID(), sessionID: String, kind: TerminalSessionIntentKind) {
        intent_id = id
        session_id = sessionID
        self.kind = kind
    }
}

/// Deterministic protocol model for M5. It owns no PTY and stores no terminal text.
public struct TerminalSessionSimulator: Sendable {
    public private(set) var sessions: [String: TerminalSessionSnapshot] = [:]
    public private(set) var lastAcceptedIntent: TerminalSessionIntent?
    private var eventIDs: Set<UUID> = []
    private var intentIDs: Set<UUID> = []

    public init() {}

    /// Adds package-discovered bindings without replacing provider events already received.
    public mutating func seed(_ snapshots: [TerminalSessionSnapshot]) {
        for snapshot in snapshots where snapshot.isValid && sessions[snapshot.id] == nil {
            sessions[snapshot.id] = snapshot
        }
    }

    @discardableResult
    public mutating func receive(_ event: TerminalSessionEvent) -> Bool {
        guard event.snapshot.isValid, !eventIDs.contains(event.event_id) else { return false }
        if let current = sessions[event.snapshot.id], event.snapshot.sequence <= current.sequence {
            return false
        }
        eventIDs.insert(event.event_id)
        sessions[event.snapshot.id] = event.snapshot
        return true
    }

    @discardableResult
    public mutating func accept(_ intent: TerminalSessionIntent) -> Bool {
        guard !intentIDs.contains(intent.intent_id),
              intent.session_id.range(of: "^[a-zA-Z][a-zA-Z0-9._-]{0,95}$",
                                      options: .regularExpression) != nil else { return false }
        switch intent.kind {
        case .focus:
            guard let session = sessions[intent.session_id], session.state != .disconnected else {
                return false
            }
        case .open:
            break
        }
        intentIDs.insert(intent.intent_id)
        lastAcceptedIntent = intent
        return true
    }

    public var catalog: [TerminalSessionSnapshot] {
        sessions.values.sorted { ($0.display_name, $0.id) < ($1.display_name, $1.id) }
    }
}
