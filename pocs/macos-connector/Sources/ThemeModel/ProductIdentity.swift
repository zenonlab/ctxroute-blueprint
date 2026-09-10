import Foundation

public enum ProductIdentity {
    public static let appBundleID = "org.orbite.wallpaper"
    public static let agentBundleID = "org.orbite.wallpaper.agent"
    public static let service = "org.orbite.wallpaper.agent"
    public static let logSubsystem = "org.orbite.wallpaper"
    public static let appName = "Orbite Wallpaper"
    public static let agentName = "Orbite Wallpaper Agent"

    public static var appBundle: URL {
        let bundle = Bundle.main.bundleURL
        guard Bundle.main.bundleIdentifier == agentBundleID else { return bundle }
        return bundle.deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }
}
