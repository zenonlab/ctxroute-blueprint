import AppKit
import CoreFoundation

/// Reversible adapter around Finder's undocumented CreateDesktop preference.
/// It never moves or deletes a desktop item; Finder alone changes their presentation.
@MainActor
final class FinderDesktopItemsController {
    private let applicationID = "com.apple.finder" as CFString
    private let preferenceKey = "CreateDesktop" as CFString

    var itemsAreVisible: Bool {
        (CFPreferencesCopyAppValue(preferenceKey, applicationID) as? Bool) ?? true
    }

    @discardableResult
    func toggle() -> Bool {
        let target = !itemsAreVisible
        CFPreferencesSetAppValue(preferenceKey, target as CFBoolean, applicationID)
        guard CFPreferencesAppSynchronize(applicationID) else { return false }
        guard let finder = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first else {
            return true
        }
        return finder.terminate()
    }
}
