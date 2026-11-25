// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LibreTVNativeAudio",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "LibreTVNativeAudio", targets: ["LibreTVNativeAudio"])
    ],
    targets: [
        .target(name: "LibreTVNativeAudio"),
        .testTarget(name: "LibreTVNativeAudioTests", dependencies: ["LibreTVNativeAudio"])
    ]
)
