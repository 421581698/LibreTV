import AVFoundation
import Speech
import Foundation

@available(iOS 27.0, *)
@MainActor
final class FridayVoiceEngine {
    var onTranscript: ((String, Bool) -> Void)?
    var onState: ((String, String?) -> Void)?

    private var captureProvider: CaptureInputSequenceProvider?
    private var analyzer: SpeechAnalyzer?
    private var transcriber: SpeechTranscriber?
    private var resultsTask: Task<Void, Never>?
    private var finalizedText = ""
    private var volatileText = ""
    private var isRunning = false

    func requestMicrophonePermission() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    continuation.resume(returning: granted)
                }
            }
        default:
            return false
        }
    }

    func start() async throws {
        guard !isRunning else { return }
        onState?("preparing", "正在准备中文语音模型")

        guard await requestMicrophonePermission() else {
            throw FridayVoiceError.microphonePermissionDenied
        }
        guard SpeechTranscriber.isAvailable else {
            throw FridayVoiceError.speechUnavailable
        }
        guard let locale = await SpeechTranscriber.supportedLocale(
            equivalentTo: Locale(identifier: "zh-CN")
        ) else {
            throw FridayVoiceError.chineseLocaleUnavailable
        }
        guard let microphone = AVCaptureDevice.default(for: .audio) else {
            throw FridayVoiceError.microphoneUnavailable
        }

        let transcriber = SpeechTranscriber(
            locale: locale,
            preset: .progressiveTranscription
        )

        if let request = try await AssetInventory.assetInstallationRequest(
            supporting: [transcriber]
        ) {
            try await request.downloadAndInstall()
        }

        guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
            throw FridayVoiceError.speechAssetsNotReady
        }

        let provider = try await CaptureInputSequenceProvider.providerWithSession(
            from: microphone,
            compatibleWith: [transcriber],
            priority: .userInitiated
        )

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(
            .playAndRecord,
            mode: .spokenAudio,
            options: [.defaultToSpeaker, .duckOthers]
        )
        try audioSession.setActive(true)

        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [transcriber]
        ) else {
            throw FridayVoiceError.noCompatibleAudioFormat
        }

        let analyzer = SpeechAnalyzer(
            modules: [transcriber],
            options: .init(
                priority: .userInitiated,
                modelRetention: .lingering
            )
        )
        try await analyzer.prepareToAnalyze(in: format)

        finalizedText = ""
        volatileText = ""
        self.captureProvider = provider
        self.analyzer = analyzer
        self.transcriber = transcriber

        resultsTask = Task { @MainActor [weak self] in
            do {
                for try await result in transcriber.results {
                    guard let self else { return }
                    let phrase = String(result.text.characters)
                    if result.isFinal {
                        self.finalizedText += phrase
                        self.volatileText = ""
                    } else {
                        self.volatileText = phrase
                    }
                    self.onTranscript?(self.finalizedText + self.volatileText, result.isFinal)
                }
            } catch {
                self?.onState?("error", error.localizedDescription)
            }
        }

        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                provider.captureSession.startRunning()
                continuation.resume()
            }
        }

        try await analyzer.start(inputSequence: provider.analyzerInputs)
        isRunning = true
        onState?("listening", "Friday 正在聆听")
    }

    func stop() async throws -> String {
        guard isRunning else {
            return finalizedText + volatileText
        }

        onState?("processing", "正在完成语音识别")
        if let provider = captureProvider {
            await withCheckedContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    provider.captureSession.stopRunning()
                    continuation.resume()
                }
            }
        }

        if let analyzer {
            try await analyzer.finalizeAndFinishThroughEndOfInput()
        }

        await resultsTask?.value
        resultsTask = nil

        let audioSession = AVAudioSession.sharedInstance()
        try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)

        captureProvider = nil
        analyzer = nil
        transcriber = nil
        isRunning = false

        let result = finalizedText + volatileText
        onState?("idle", "录音已结束")
        return result
    }

    func status() -> (state: String, text: String) {
        (isRunning ? "listening" : "idle", finalizedText + volatileText)
    }
}

enum FridayVoiceError: LocalizedError {
    case microphonePermissionDenied
    case microphoneUnavailable
    case speechUnavailable
    case chineseLocaleUnavailable
    case speechAssetsNotReady
    case noCompatibleAudioFormat

    var errorDescription: String? {
        switch self {
        case .microphonePermissionDenied:
            return "麦克风权限未授权，请在系统设置中允许 Friday 使用麦克风。"
        case .microphoneUnavailable:
            return "找不到可用的麦克风。"
        case .speechUnavailable:
            return "当前设备暂不支持 Apple SpeechTranscriber。"
        case .chineseLocaleUnavailable:
            return "当前设备没有可用的简体中文语音识别语言包。"
        case .speechAssetsNotReady:
            return "中文语音模型尚未安装完成，请检查网络后重试。"
        case .noCompatibleAudioFormat:
            return "找不到语音识别支持的音频格式。"
        }
    }
}
