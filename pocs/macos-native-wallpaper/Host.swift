import AppKit
import ImageIO
import UniformTypeIdentifiers

@main
@MainActor
enum ProbeHost {
    static func main() throws {
        if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--thumbnail" {
            let context = CGContext(data: nil, width: 480, height: 270, bitsPerComponent: 8,
                bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.setFillColor(CGColor(red: 0, green: 0.55, blue: 0.25, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: 480, height: 270))
            context.setFillColor(CGColor(red: 0.9, green: 0.1, blue: 0.6, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: 240, height: 270))
            let url = URL(fileURLWithPath: CommandLine.arguments[2])
            let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
            CGImageDestinationAddImage(destination, context.makeImage()!, nil)
            guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
            return
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let controls = HostControls()
        app.delegate = controls
        withExtendedLifetime(controls) { app.run() }
    }
}
