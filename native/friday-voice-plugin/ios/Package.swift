// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FridayVoicePlugin",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "FridayVoicePlugin",
            targets: ["FridayVoicePlugin"]
        )
    ],
    dependencies: [
        .package(
            url: "https://github.com/ionic-team/capacitor-swift-pm.git",
            from: "8.0.0"
        )
    ],
    targets: [
        .target(
            name: "FridayVoicePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "Sources/FridayVoicePlugin"
        )
    ]
)
