import AppIntents
import FridayVoicePlugin

@available(iOS 16.0, *)
struct FridayAppIntentsPackage: AppIntentsPackage {
    static var includedPackages: [any AppIntentsPackage.Type] {
        [FridayVoiceIntentsPackage.self]
    }
}
