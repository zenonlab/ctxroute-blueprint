import Foundation
import ProbeCore

enum FormationAssetLoader {
    static func load() throws -> FormationTheme {
        let root = Bundle.module.url(forResource: "formation-theme", withExtension: "json")
        let nested = Bundle.module.url(forResource: "formation-theme", withExtension: "json",
                                       subdirectory: "Resources")
        guard let url = root ?? nested else { throw FormationAssetError.missingResource }
        return try FormationTheme.decode(Data(contentsOf: url, options: .mappedIfSafe))
    }
}

enum FormationAssetError: Error { case missingResource }
