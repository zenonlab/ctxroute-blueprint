import Foundation
import CoreFoundation
import Darwin
import Dispatch

/// macOS connector only. Preference acknowledgement is not visual confirmation.
@MainActor struct DesktopItems {
    enum Failure: Error { case unavailable, writeFailed, unconfirmed, refreshFailed, rollbackFailed }
    static let domain = "com.apple.WindowManager"
    static let key = "StandardHideDesktopIcons"
    var read: (String, String) -> Bool? = { domain, key in
        CFPreferencesAppSynchronize(domain as CFString)
        return CFPreferencesCopyAppValue(key as CFString, domain as CFString) as? Bool
    }
    var write: (String, String, Bool) -> Bool = { domain, key, value in
        CFPreferencesSetAppValue(key as CFString, value as CFBoolean, domain as CFString)
        return CFPreferencesAppSynchronize(domain as CFString)
    }
    var refresh: () -> Bool = {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["kickstart", "-k", "gui/\(getuid())/com.apple.Finder"]
        do {
            let finished = DispatchSemaphore(value: 0)
            process.terminationHandler = { _ in finished.signal() }
            try process.run()
            guard finished.wait(timeout: .now() + 2) == .success else {
                process.terminate()
                return false
            }
            return process.terminationStatus == 0
        } catch { return false }
    }

    func isVisible() throws -> Bool {
        // Do not destroy Finder's desktop or change the user's Stage Manager policy.
        guard read("com.apple.finder", "CreateDesktop") != false,
              read(Self.domain, "GloballyEnabled") != true else { throw Failure.unavailable }
        return !(read(Self.domain, Self.key) ?? false)
    }

    @discardableResult func setVisible(_ visible: Bool) throws -> Bool {
        let previous = try isVisible()
        guard write(Self.domain, Self.key, !visible) else { throw Failure.writeFailed }
        guard try isVisible() == visible else { throw Failure.unconfirmed }
        guard refresh() else {
            guard write(Self.domain, Self.key, !previous),
                  (try? isVisible()) == previous else { throw Failure.rollbackFailed }
            guard refresh() else { throw Failure.rollbackFailed }
            throw Failure.refreshFailed
        }
        return visible
    }

    @discardableResult func toggle() throws -> Bool { try setVisible(!isVisible()) }
}
