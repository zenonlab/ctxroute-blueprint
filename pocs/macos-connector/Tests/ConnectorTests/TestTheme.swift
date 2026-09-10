import Foundation
@testable import ThemeModel

extension Theme {
    static func fixture(still: Bool = false) -> Theme {
        let motion = still ? "still" : "orbit"
        return try! Theme.decode(Data("""
        {
          "schema_version": 1,
          "theme_id": "fixture.theme",
          "display_name": "Fixture libre",
          "panel_id": "fixture.panel",
          "background": "101B30",
          "accent": "5CE1E6",
          "motion_path": "\(motion)",
          "period_seconds": 24,
          "objects": [
            {"id":"orb.a","color":"FF6B6B","phase":0.00},
            {"id":"orb.b","color":"FFD166","phase":0.25},
            {"id":"orb.c","color":"06D6A0","phase":0.50},
            {"id":"orb.d","color":"4CC9F0","phase":0.75}
          ],
          "system_controls":{"placement":"top_left","items":["audio","desktop"]}
        }
        """.utf8))
    }
}
