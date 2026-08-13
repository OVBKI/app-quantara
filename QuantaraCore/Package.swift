// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "QuantaraCore",
    defaultLocalization: "fr",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
        .watchOS(.v10)
    ],
    products: [
        .library(name: "QuantaraCore", targets: ["QuantaraCore"])
    ],
    targets: [
        .target(
            name: "QuantaraCore",
            swiftSettings: [.enableUpcomingFeature("StrictConcurrency")]
        ),
        .testTarget(
            name: "QuantaraCoreTests",
            dependencies: ["QuantaraCore"]
        )
    ]
)
