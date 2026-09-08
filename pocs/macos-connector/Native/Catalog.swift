import Foundation

@MainActor func makeCatalog() -> AnyObject? {
    guard let theme = try? Theme.load(), let bundleID = Bundle.main.bundleIdentifier,
          let thumbnail = Bundle.main.url(forResource: "thumbnail", withExtension: "png") else { return nil }
    let provider = ChoiceProviderID(rawValue: bundleID)
    let choice = ChoiceID(id: theme.theme_id, descriptor: ChoiceIDDescriptor(provider: provider,
        identifier: theme.theme_id, files: [], configuration: Data(theme.theme_id.utf8)))
    let item = SettingsItem(id: choice, localizedName: theme.display_name, thumbnail: .image(url: thumbnail),
        choice: ChoiceDescriptor(id: choice, provider: provider, identifier: theme.theme_id,
            name: theme.display_name, localizedDescription: "Scène originale — connecteur PoC 2",
            thumbnail: .image(url: thumbnail), isDownloaded: true, options: []),
        contentBadge: .dynamic, showInTopLevel: true, sortOrder: 0, disposability: .none, contextMenu: nil)
    let group = SettingsGroup(id: GroupID(id: "connector-poc2"), items: [item],
        localizedName: "Wallpaper Connector — PoC 2", disposability: .none, sortOrder: 0)
    let models = SettingsViewModels(desktop: SettingsViewModel(groups: [group],
        refreshPolicy: .default, isModificationDisabled: false), screenSaver: nil)
    // Local self-produced archive, never an untrusted input.
    guard let cls = objc_getClass("WallpaperSettingsViewModelsXPC") as? AnyClass,
          let data = try? NSKeyedArchiver.archivedData(withRootObject: ShimViewModelsXPC(value: models), requiringSecureCoding: false),
          let decoder = try? NSKeyedUnarchiver(forReadingFrom: data) else { return nil }
    decoder.requiresSecureCoding = false; decoder.decodingFailurePolicy = .setErrorAndReturn
    decoder.setClass(cls, forClassName: "ShimViewModelsXPC")
    let result = decoder.decodeObject(forKey: NSKeyedArchiveRootObjectKey)
    decoder.finishDecoding()
    return decoder.error == nil ? result as AnyObject? : nil
}
