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
        app.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Native Wallpaper Probe"
        alert.informativeText = "Test expérimental d’une extension Apple, sans fenêtre wallpaper superposée.\n\nDans Réglages > Fond d’écran, chercher Native Wallpaper Probe puis Balayage diagnostic. Si absent : l’admission de l’extension a échoué ; ne pas désactiver les protections macOS.\n\nAvant sélection, noter votre fond actuel. Pour arrêter, sélectionner de nouveau ce fond. Les clics dans le décor ne font pas partie de ce test."
        alert.addButton(withTitle: "Ouvrir les réglages")
        alert.addButton(withTitle: "Fermer")
        if alert.runModal() == .alertFirstButtonReturn {
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Wallpaper-Settings.extension")!)
        }
    }
}
