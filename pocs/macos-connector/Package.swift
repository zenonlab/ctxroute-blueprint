// swift-tools-version: 6.0
import PackageDescription

let package = Package(name: "MacConnectorPoC", platforms: [.macOS(.v14)], targets: [
    .target(name: "ThemeModel", resources: [.copy("Resources/theme.json")]),
    .target(name: "SceneRenderer", dependencies: ["ThemeModel"]),
    .target(name: "ConnectorTransport", dependencies: ["ThemeModel"]),
    .testTarget(name: "ConnectorTests", dependencies: ["ThemeModel", "SceneRenderer", "ConnectorTransport"])
])
