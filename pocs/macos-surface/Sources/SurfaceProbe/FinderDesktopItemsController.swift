import AppKit
import CoreFoundation
import Darwin

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
        restartFinder()
        return true
    }

    private func restartFinder() {
        NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first?.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            process.arguments = ["kickstart", "-k", "gui/\(getuid())/com.apple.Finder"]
            do { try process.run() } catch { NSSound.beep() }
        }
    }
}
