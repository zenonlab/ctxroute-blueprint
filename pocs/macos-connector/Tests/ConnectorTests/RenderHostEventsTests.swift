import Foundation
import XCTest
@testable import ThemeModel

final class RenderHostEventsTests: XCTestCase {
    private final class SnapshotBox: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [RenderHostHitSnapshot] = []

        func append(_ value: RenderHostHitSnapshot) { lock.withLock { values.append(value) } }
        func sequences() -> [UInt64] { lock.withLock { values.map(\.sequence) } }
    }

    func testFramedSnapshotsAreBoundedMonotoneAndHitTestTopmostFirst() throws {
        let target = RenderHostHitSnapshot.Target(kind: .target, id: "vehicle-0", x: 10, y: 20,
                                                  width: 100, height: 80)
        let control = RenderHostHitSnapshot.Target(kind: .control, id: "theme.audio", x: 20, y: 30,
                                                   width: 40, height: 40)
        let first = RenderHostHitSnapshot(schema_version: 1, sequence: 1, width: 800, height: 500,
                                          targets: [target, control])
        let second = RenderHostHitSnapshot(schema_version: 1, sequence: 2, width: 800, height: 500,
                                           targets: [target])
        let received = SnapshotBox()
        let reader = RenderHostOutputReader { received.append($0) }
        let line = { (value: RenderHostHitSnapshot) -> Data in
            var data = Data("ORBITE_EVENT ".utf8)
            data.append(try! JSONEncoder().encode(value))
            data.append(0x0a)
            return data
        }
        let bytes = line(first) + line(first) + Data("noise\n".utf8) + line(second)
        reader.consume(bytes.prefix(17))
        reader.consume(bytes.dropFirst(17))
        XCTAssertEqual(received.sequences(), [1, 2])
        XCTAssertEqual(first.hit(x: 25, y: 35)?.id, "theme.audio")
        XCTAssertNil(first.hit(x: 799, y: 499))
    }
}
