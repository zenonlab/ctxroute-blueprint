import CoreGraphics
import Foundation
import ImageIO
import QuartzCore

// Minimal compatibility fixtures: no XPC host, WallpaperAgent or visible window.
struct DisplayKey: Hashable { let displayID: UInt32 }
enum Lifecycle { static let queue = DispatchQueue(label: "diagnostic.snapshot.tests") }
func extensionLog(_ message: String) {}

@main
enum SnapshotTests {
    static func main() throws {
        guard CommandLine.arguments.count == 3 else { throw SnapshotError.invalidArguments }
        let theme = try DiagnosticTheme.load(url: URL(fileURLWithPath: CommandLine.arguments[1]))
        let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
        let outputs = [
            outputDirectory.appendingPathComponent("01-idle.png"),
            outputDirectory.appendingPathComponent("02-panel-active.png"),
            outputDirectory.appendingPathComponent("03-panel-paused-effect.png")
        ]
        let states: [([DiagnosticCommand], Bool)] = [
            ([], false),
            ([.showPanel], true),
            ([.showPanel, .pause, .effectOn], true)
        ]
        try Lifecycle.queue.sync {
            let width = 1200
            let height = 780
            for (index, state) in states.enumerated() {
                InteractiveDiagnostic.receive(.reset)
                let root = CALayer()
                root.bounds = CGRect(x: 0, y: 0, width: width, height: height)
                colorDiagInstall(rootLayer: root, for: DisplayKey(displayID: UInt32(index + 7)))
                InteractiveDiagnostic.attach(to: root, theme: theme)
                for command in state.0 { InteractiveDiagnostic.receive(command) }
                guard let sweep = root.sublayers?.first(where: { $0.name == "colorDiag.fill" }),
                      let panel = root.sublayers?.first(where: { $0.name == "interactive.panel" }) else {
                    throw SnapshotError.missingLayer
                }
                let anchors = root.sublayers?.filter {
                    $0.name?.hasPrefix("interactive.anchor.") == true && $0.name?.contains("label") == false
                } ?? []
                guard anchors.count == theme.anchors.count, anchors.allSatisfy({ !$0.isHidden && $0.opacity > 0 }),
                      panel.isHidden == !state.1 else { throw SnapshotError.invalidState }
                sweep.removeAllAnimations()
                sweep.bounds.size.width = CGFloat(width) * 0.58
                try render(root, to: outputs[index], width: width, height: height)
            }
        }
        for output in outputs {
            guard let source = CGImageSourceCreateWithURL(output as CFURL, nil),
                  let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                  properties[kCGImagePropertyPixelWidth] as? Int == 1200,
                  properties[kCGImagePropertyPixelHeight] as? Int == 780 else {
                throw SnapshotError.invalidDimensions
            }
        }
        let bytes = try outputs.map { try Data(contentsOf: $0) }
        guard Set(bytes).count == outputs.count else { throw SnapshotError.duplicateState }
        print("PASS: rendered 3 distinct 1200x780 theme states at \(outputDirectory.path)")
    }

    private static func render(_ root: CALayer, to output: URL, width: Int, height: Int) throws {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(data: nil, width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: width * 4, space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
            let destination = CGImageDestinationCreateWithURL(output as CFURL, "public.png" as CFString, 1, nil)
        else { throw SnapshotError.cannotCreateImage }
        root.render(in: context)
        guard let image = context.makeImage() else { throw SnapshotError.cannotCreateImage }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw SnapshotError.cannotWriteImage }
    }

    enum SnapshotError: Error {
        case invalidArguments, missingLayer, invalidState, cannotCreateImage, cannotWriteImage,
             invalidDimensions, duplicateState
    }
}
