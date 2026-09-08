// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MacOSSurfaceProbe",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "SurfaceProbe", targets: ["SurfaceProbe"])],
    targets: [
        .target(name: "ProbeCore"),
        .executableTarget(name: "SurfaceProbe", dependencies: ["ProbeCore"], resources: [.copy("Resources")]),
        .testTarget(name: "ProbeCoreTests", dependencies: ["ProbeCore"])
    ]
)
