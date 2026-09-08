import Foundation
import CoreFoundation

/// macOS connector only. Preference acknowledgement is not visual confirmation.
@MainActor struct DesktopItems {
    enum Failure: Error { case unavailable, writeFailed, unconfirmed }
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

    func isVisible() throws -> Bool {
        // Do not destroy Finder's desktop or change the user's Stage Manager policy.
        guard read("com.apple.finder", "CreateDesktop") != false,
              read(Self.domain, "GloballyEnabled") != true else { throw Failure.unavailable }
        return !(read(Self.domain, Self.key) ?? false)
    }

    @discardableResult func setVisible(_ visible: Bool) throws -> Bool {
        _ = try isVisible()
        guard write(Self.domain, Self.key, !visible) else { throw Failure.writeFailed }
        guard try isVisible() == visible else { throw Failure.unconfirmed }
        return visible
    }

    @discardableResult func toggle() throws -> Bool { try setVisible(!isVisible()) }
}
