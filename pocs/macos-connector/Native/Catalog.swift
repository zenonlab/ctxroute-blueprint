import AppKit
import Foundation

@MainActor private func genericThumbnail() -> URL? {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("org.orbite.wallpaper.provider", isDirectory: true)
    let url = directory.appendingPathComponent("provider-thumbnail.png")
    if let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
       values.isRegularFile == true, values.isSymbolicLink != true { return url }
    do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let size = NSSize(width: 320, height: 180)
        let image = NSImage(size: size)
        image.lockFocus()
        NSColor(calibratedRed: 0.055, green: 0.075, blue: 0.12, alpha: 1).setFill()
        NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
        NSColor(calibratedRed: 0.25, green: 0.82, blue: 0.72, alpha: 1).setStroke()
        let orbit = NSBezierPath(ovalIn: NSRect(x: 72, y: 34, width: 176, height: 112))
        orbit.lineWidth = 8
        orbit.stroke()
        NSColor.white.setFill()
        NSBezierPath(ovalIn: NSRect(x: 218, y: 76, width: 28, height: 28)).fill()
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else { return nil }
        try png.write(to: url, options: .atomic)
        return url
    } catch {
        extensionLog("Generic thumbnail unavailable: \(error)")
        return nil
    }
}

@MainActor func makeCatalog(items: [ProviderCatalogItem], bundle: Bundle = .main) -> AnyObject? {
    guard items.count <= 256, items.allSatisfy(\.isValid),
          Set(items.map(\.id)).count == items.count,
          let bundleID = bundle.bundleIdentifier,
          let thumbnail = genericThumbnail() else {
        extensionLog("External catalog rejected")
        return nil
    }
    let provider = ChoiceProviderID(rawValue: bundleID)
    let settingsItems = items.enumerated().map { index, item in
        let choice = ChoiceID(id: item.id, descriptor: ChoiceIDDescriptor(
            provider: provider, identifier: item.id, files: [], configuration: Data(item.id.utf8)))
        return SettingsItem(id: choice, localizedName: item.displayName, thumbnail: .image(url: thumbnail),
            choice: ChoiceDescriptor(id: choice, provider: provider, identifier: item.id,
                name: item.displayName, localizedDescription: "Thème Orbite local",
                thumbnail: .image(url: thumbnail), isDownloaded: true, options: []),
            contentBadge: .dynamic, showInTopLevel: true, sortOrder: index,
            disposability: .none, contextMenu: nil)
    }
    let group = SettingsGroup(id: GroupID(id: "external-themes"), items: settingsItems,
        localizedName: "Orbite Wallpaper", disposability: .none, sortOrder: 0,
        sortID: GroupSortID(id: "external-themes"), shouldHideItemLabels: false)
    let models = SettingsViewModels(desktop: SettingsViewModel(groups: [group],
        refreshPolicy: .default, isModificationDisabled: false), screenSaver: nil)

    guard let cls = objc_getClass("WallpaperSettingsViewModelsXPC") as? AnyClass,
          let data = try? NSKeyedArchiver.archivedData(
            withRootObject: ShimViewModelsXPC(value: models), requiringSecureCoding: false),
          let decoder = try? NSKeyedUnarchiver(forReadingFrom: data) else { return nil }
    decoder.requiresSecureCoding = false
    decoder.decodingFailurePolicy = .setErrorAndReturn
    decoder.setClass(cls, forClassName: "ShimViewModelsXPC")
    let result = decoder.decodeObject(forKey: NSKeyedArchiveRootObjectKey)
    if let error = decoder.error { extensionLog("Catalog decoding failed: \(error)") }
    decoder.finishDecoding()
    return decoder.error == nil ? result as AnyObject? : nil
}
