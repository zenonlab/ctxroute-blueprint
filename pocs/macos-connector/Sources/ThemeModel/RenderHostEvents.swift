import Foundation

public struct RenderHostHitSnapshot: Codable, Equatable, Sendable {
    public struct Target: Codable, Equatable, Sendable {
        public enum Kind: String, Codable, Sendable { case control, target }
        public let kind: Kind
        public let id: String
        public let x: Double
        public let y: Double
        public let width: Double
        public let height: Double

        public func contains(x pointX: Double, y pointY: Double) -> Bool {
            pointX >= x && pointY >= y && pointX < x + width && pointY < y + height
        }
    }
    public let schema_version: Int
    public let sequence: UInt64
    public let width: Double
    public let height: Double
    public let targets: [Target]

    public var isValid: Bool {
        schema_version == 1 && width.isFinite && height.isFinite
            && (1...16_384).contains(width) && (1...16_384).contains(height)
            && targets.count <= 32 && targets.allSatisfy { target in
                target.id.range(of: "^[a-zA-Z][a-zA-Z0-9._-]{0,95}$",
                    options: .regularExpression) != nil
                    && [target.x, target.y, target.width, target.height].allSatisfy(\.isFinite)
                    && target.width > 0 && target.height > 0
                    && target.x >= 0 && target.y >= 0
                    && target.x + target.width <= width + 1
                    && target.y + target.height <= height + 1
            }
    }

    public func hit(x: Double, y: Double) -> Target? {
        targets.reversed().first { $0.contains(x: x, y: y) }
    }
}

final class RenderHostOutputReader: @unchecked Sendable {
    private let lock = NSLock()
    private var buffer = Data()
    private var lastSequence: UInt64?
    private let receive: @Sendable (RenderHostHitSnapshot) -> Void

    init(receive: @escaping @Sendable (RenderHostHitSnapshot) -> Void) { self.receive = receive }

    func consume(_ data: Data) {
        guard !data.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        guard buffer.count + data.count <= 1_048_576 else { buffer.removeAll(); return }
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0a) {
            let line = buffer[..<newline]
            buffer.removeSubrange(...newline)
            let prefix = Data("ORBITE_EVENT ".utf8)
            guard line.starts(with: prefix), line.count - prefix.count <= 65_535,
                  let snapshot = try? JSONDecoder().decode(RenderHostHitSnapshot.self,
                    from: Data(line.dropFirst(prefix.count))), snapshot.isValid,
                  lastSequence.map({ snapshot.sequence > $0 }) ?? true else { continue }
            lastSequence = snapshot.sequence
            receive(snapshot)
        }
    }
}
