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
        let theme = try DiagnosticTheme.load(url: URL(fileURLWithPath: CommandLine.arguments[1]))
        let output = URL(fileURLWithPath: CommandLine.arguments[2])
        try Lifecycle.queue.sync {
            let width = 1200
            let height = 780
            let root = CALayer()
            root.bounds = CGRect(x: 0, y: 0, width: width, height: height)
            colorDiagInstall(rootLayer: root, for: DisplayKey(displayID: 7))
            InteractiveDiagnostic.attach(to: root, theme: theme)
            InteractiveDiagnostic.receive(.showPanel)
            InteractiveDiagnostic.receive(.effectOn)
            guard let sweep = root.sublayers?.first(where: { $0.name == "colorDiag.fill" }) else {
                throw SnapshotError.missingSweep
            }
            sweep.removeAllAnimations()
            sweep.bounds.size.width = CGFloat(width) * 0.58

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
        guard let source = CGImageSourceCreateWithURL(output as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              properties[kCGImagePropertyPixelWidth] as? Int == 1200,
              properties[kCGImagePropertyPixelHeight] as? Int == 780 else {
            throw SnapshotError.invalidDimensions
        }
        print("PASS: rendered 1200x780 interactive theme preview at \(output.path)")
    }

    enum SnapshotError: Error { case missingSweep, cannotCreateImage, cannotWriteImage, invalidDimensions }
}
