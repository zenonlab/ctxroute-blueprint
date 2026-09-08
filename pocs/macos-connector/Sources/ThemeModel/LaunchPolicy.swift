import Foundation

/// A process inventory is input, never an instruction to terminate another process.
public enum LaunchPolicy {
    public static func conflicts(paths: [String], installing: Bool, appPath: String) -> [String] {
        paths.filter { path in
            let executable = URL(fileURLWithPath: path).lastPathComponent
            guard path.contains("/Contents/") else { return false }
            switch executable {
            case "SurfaceProbe", "NativeWallpaperProbeHost", "NativeWallpaperProbe": return true
            case "WallpaperConnector": return installing
            case "WallpaperProvider":
                return installing || !path.hasPrefix(appPath + "/Contents/Extensions/")
            default: return false
            }
        }
    }
}
