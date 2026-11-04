import AppIntents
import Foundation

@available(iOS 16.0, *)
public struct FridayStartVoiceIntent: AppIntent {
    public static var title: LocalizedStringResource = "打开 Friday 语音"
    public static var description = IntentDescription("打开 Friday 语音助手。")
    public static var openAppWhenRun: Bool = true

    public init() {}

    public func perform() async throws -> some IntentResult {
        .result(
            dialog: "正在打开 Friday。首次使用请授权麦克风，然后在应用内开始聆听。"
        )
    }
}

@available(iOS 16.0, *)
public struct FridayAppShortcuts: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: FridayStartVoiceIntent(),
            phrases: [
                "用 \\(.applicationName) 打开语音助手",
                "用 \\(.applicationName) 开始语音"
            ],
            shortTitle: "Friday 语音",
            systemImageName: "waveform"
        )
    }
}
