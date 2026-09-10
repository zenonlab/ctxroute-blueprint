import Foundation
import Testing
@testable import ThemeModel

@Suite(.serialized) struct RenderHostTests {
    private func defaults() -> UserDefaults {
        let suite = "RenderHostTests.\(UUID().uuidString)"
        return UserDefaults(suiteName: suite)!
    }

    @Test func capability_resolves_to_registered_binary_without_manifest_command() throws {
        let defaults = defaults()
        try RenderHostRegistry.register(renderer: "bevy-0.19",
                                        executable: URL(fileURLWithPath: "/usr/bin/true"),
                                        defaults: defaults)
        let package = InstalledTheme(id: "fixture", displayName: "Fixture",
            entry: .init(format: "orbite.scene-probe/1", path: "scene.json"), renderer: "bevy-0.19")
        let root = URL(fileURLWithPath: "/tmp/package", isDirectory: true)
        let theme = DiscoveredTheme(package: package, descriptor: root.appendingPathComponent("orbite-theme.json"),
                                    entry: root.appendingPathComponent("scene.json"), thumbnail: nil)
        let request = try RenderHostLaunchRequest.desktop(theme: theme, defaults: defaults)
        #expect(request.executable.path == "/usr/bin/true")
        #expect(request.arguments == ["/tmp/package/scene.json", "--desktop"])
        #expect(request.themeID == "fixture")
    }

    @Test func unregistered_and_non_executable_renderers_fail_closed() throws {
        let defaults = defaults()
        #expect(throws: (any Error).self) {
            try RenderHostRegistry.resolve(renderer: "unknown", defaults: defaults)
        }
        defaults.set(["bevy-0.19": "/tmp"], forKey: RenderHostRegistry.defaultsKey)
        #expect(throws: (any Error).self) {
            try RenderHostRegistry.resolve(renderer: "bevy-0.19", defaults: defaults)
        }
    }

    @Test @MainActor func changed_recipe_restarts_the_same_theme() throws {
        let controller = RenderHostController()
        defer { controller.stop() }
        let first = RenderHostLaunchRequest(executable: URL(fileURLWithPath: "/bin/sleep"),
                                            arguments: ["30"], themeID: "fixture")
        let changed = RenderHostLaunchRequest(executable: URL(fileURLWithPath: "/bin/sleep"),
                                              arguments: ["29"], themeID: "fixture")
        #expect(try controller.activate(first))
        #expect(try !controller.activate(first))
        #expect(try controller.activate(changed))
    }

    @Test @MainActor func immediate_renderhost_exit_is_not_reported_as_activation() {
        let controller = RenderHostController()
        let request = RenderHostLaunchRequest(executable: URL(fileURLWithPath: "/usr/bin/false"),
                                              arguments: [], themeID: "fixture")
        #expect(throws: (any Error).self) { try controller.activate(request) }
        #expect(controller.themeID == nil)
    }
}
