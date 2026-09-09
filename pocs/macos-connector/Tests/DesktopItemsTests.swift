import Foundation

@MainActor func testDesktopItems() throws {
    var preferences: [String: Bool] = [:]
    var writes = 0
    var synchronize = true
    var acceptWrite = true
    var refreshes = 0
    var refreshResults: [Bool] = []
    let controller = DesktopItems(read: { domain, key in preferences[domain + "/" + key] }, write: { domain, key, value in
        precondition(domain == DesktopItems.domain && key == DesktopItems.key)
        writes += 1
        if acceptWrite { preferences[domain + "/" + key] = value }
        return synchronize
    }, refresh: {
        refreshes += 1
        return refreshResults.isEmpty ? true : refreshResults.removeFirst()
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
    preferences[DesktopItems.domain + "/" + DesktopItems.key] = false
    try require(controller.toggle()) // external change is read before the next action
    try require(controller.setVisible(true)) // explicit recovery is idempotent
    synchronize = false
    try expect(.writeFailed) { _ = try controller.setVisible(false) }
    preferences[DesktopItems.domain + "/" + DesktopItems.key] = true // failed synchronization is not durable
    synchronize = true; acceptWrite = false
    try expect(.unconfirmed) { _ = try controller.setVisible(false) }
    acceptWrite = true; refreshResults = [false, true]
    try expect(.refreshFailed) { _ = try controller.setVisible(false) }
    try require(controller.isVisible()) // failed refresh rolls the preference back
    try require(refreshes == 5)
    var rollbackPreferences = [DesktopItems.domain + "/" + DesktopItems.key: true]
    var rollbackWrites = 0
    let rollbackFailure = DesktopItems(read: { domain, key in rollbackPreferences[domain + "/" + key] },
        write: { domain, key, value in
            rollbackWrites += 1
            if rollbackWrites == 1 { rollbackPreferences[domain + "/" + key] = value; return true }
            return false
        }, refresh: { false })
    try expect(.rollbackFailed) { _ = try rollbackFailure.setVisible(false) }
    print("desktop-items=PASS cases=9 (injected preferences and refresh; no Finder or user data mutation)")
}
