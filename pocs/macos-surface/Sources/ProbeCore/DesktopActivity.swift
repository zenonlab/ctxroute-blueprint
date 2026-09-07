/// Scheduling eligibility, deliberately not an assertion of exact occlusion.
public enum DesktopActivity {
    public static func source(ordered: Bool, activeSpace: Bool, appKitVisible: Bool,
                              finderFrontmost: Bool, awake: Bool, sessionActive: Bool) -> String {
        guard awake && sessionActive && ordered && activeSpace else { return "suspended" }
        if appKitVisible { return "appkit-visible" }
        if finderFrontmost { return "finder-frontmost-proxy" }
        return "suspended"
    }
}
