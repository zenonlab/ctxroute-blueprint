import Foundation

@MainActor func makeCatalog(bundle: Bundle = .main) -> AnyObject? {
    guard let themes = try? Theme.catalog(bundle: bundle), let bundleID = bundle.bundleIdentifier else {
        extensionLog("Catalog resources unavailable in \(bundle.bundlePath)"); return nil
    }
    let provider = ChoiceProviderID(rawValue: bundleID)
    var items: [SettingsItem] = []
    for (index, theme) in themes.enumerated() {
        guard let thumbnail = bundle.url(forResource: theme.theme_id, withExtension: "png") else {
            extensionLog("Catalog thumbnail missing: \(theme.theme_id)"); return nil
        }
        let choice = ChoiceID(id: theme.theme_id, descriptor: ChoiceIDDescriptor(provider: provider,
            identifier: theme.theme_id, files: [], configuration: Data(theme.theme_id.utf8)))
        let item = SettingsItem(id: choice, localizedName: theme.display_name, thumbnail: .image(url: thumbnail),
            choice: ChoiceDescriptor(id: choice, provider: provider, identifier: theme.theme_id,
                name: theme.display_name, localizedDescription: "Scène originale — connecteur PoC 2",
                thumbnail: .image(url: thumbnail), isDownloaded: true, options: []),
            contentBadge: theme.motion_path == "still" ? .none : .dynamic,
            showInTopLevel: true, sortOrder: index, disposability: .none, contextMenu: nil)
        items.append(item)
    }
    let group = SettingsGroup(id: GroupID(id: "connector-poc2"), items: items,
        localizedName: "Wallpaper Connector — PoC 2", disposability: .none, sortOrder: 0,
        sortID: GroupSortID(id: "connector-poc2"), shouldHideItemLabels: false)
    let models = SettingsViewModels(desktop: SettingsViewModel(groups: [group],
        refreshPolicy: .default, isModificationDisabled: false), screenSaver: nil)
    // Local self-produced archive, never an untrusted input.
    guard let cls = objc_getClass("WallpaperSettingsViewModelsXPC") as? AnyClass,
          let data = try? NSKeyedArchiver.archivedData(withRootObject: ShimViewModelsXPC(value: models), requiringSecureCoding: false),
          let decoder = try? NSKeyedUnarchiver(forReadingFrom: data) else { return nil }
    decoder.requiresSecureCoding = false; decoder.decodingFailurePolicy = .setErrorAndReturn
    decoder.setClass(cls, forClassName: "ShimViewModelsXPC")
    let result = decoder.decodeObject(forKey: NSKeyedArchiveRootObjectKey)
    if let error = decoder.error { extensionLog("Catalog decoding failed: \(error)") }
    decoder.finishDecoding()
    return decoder.error == nil ? result as AnyObject? : nil
}
