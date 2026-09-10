import Foundation

@MainActor enum ProviderCover {
    static func externalURL(from url: URL?) -> URL? {
        guard let url else { return nil }
        return ProviderCatalogItem(id: "cover.validation", displayName: "Cover", coverURL: url).isValid
            ? url : nil
    }
}
