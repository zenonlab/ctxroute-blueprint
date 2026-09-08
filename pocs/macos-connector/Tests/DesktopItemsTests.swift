import Foundation

@MainActor func testDesktopItems() throws {
    var preferences: [String: Bool] = [:]
    var writes = 0
    var synchronize = true
    var acceptWrite = true
    let controller = DesktopItems(read: { domain, key in preferences[domain + "/" + key] }, write: { domain, key, value in
        precondition(domain == DesktopItems.domain && key == DesktopItems.key)
        writes += 1
        if acceptWrite { preferences[domain + "/" + key] = value }
        return synchronize
    })
    func require(_ result: Bool) throws {
        if !result { throw ModelError.invalid("desktop items regression") }
    }
    func expect(_ failure: DesktopItems.Failure, _ action: () throws -> Void) throws {
        do { try action(); throw ModelError.invalid("desktop items error not reported") }
        catch let actual as DesktopItems.Failure { try require(actual == failure) }
    }
    try require(controller.isVisible()) // absent key means the standard desktop is shown
    try require(!controller.toggle())
    try require(controller.toggle()) // restoration must not depend on a cached UI state
    preferences[DesktopItems.domain + "/" + DesktopItems.key] = true
    try require(controller.toggle()) // external change is read before the next action
    try require(controller.setVisible(true)) // explicit recovery is idempotent
    synchronize = false
    try expect(.writeFailed) { _ = try controller.setVisible(true) }
    synchronize = true; acceptWrite = false
    try expect(.unconfirmed) { _ = try controller.setVisible(false) }
    let previousWrites = writes
    preferences["com.apple.finder/CreateDesktop"] = false
    try expect(.unavailable) { _ = try controller.toggle() }
    preferences["com.apple.finder/CreateDesktop"] = true
    preferences[DesktopItems.domain + "/GloballyEnabled"] = true
    try expect(.unavailable) { _ = try controller.setVisible(true) }
    try require(writes == previousWrites)
    print("desktop-items=PASS cases=9 (injected preferences; no Finder or user data mutation)")
}
