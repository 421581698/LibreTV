import AVFoundation
import Capacitor
import Foundation

@objc(FridayVoicePlugin)
public class FridayVoicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FridayVoicePlugin"
    public let jsName = "FridayVoice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestMicrophonePermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    @available(iOS 27.0, *)
    private var engine: FridayVoiceEngine?

    override public func load() {
        if #available(iOS 27.0, *) {
            let voiceEngine = FridayVoiceEngine()
            voiceEngine.onTranscript = { [weak self] text, isFinal in
                self?.notifyListeners("transcript", data: [
                    "text": text,
                    "isFinal": isFinal
                ])
            }
            voiceEngine.onState = { [weak self] state, message in
                var payload: [String: Any] = ["state": state]
                if let message {
                    payload["message"] = message
                }
                self?.notifyListeners("state", data: payload)
            }
            engine = voiceEngine
        }
    }

    @objc func requestMicrophonePermission(_ call: CAPPluginCall) {
        if #available(iOS 27.0, *) {
            Task { @MainActor in
                let granted = await engine?.requestMicrophonePermission() ?? false
                call.resolve(["granted": granted])
            }
        } else {
            call.reject("Friday 原生语音需要 iOS 27 或更高版本。")
        }
    }

    @objc func startListening(_ call: CAPPluginCall) {
        if #available(iOS 27.0, *) {
            Task { @MainActor in
                do {
                    guard let engine else {
                        throw FridayVoiceError.speechUnavailable
                    }
                    try await engine.start()
                    call.resolve(["started": true])
                } catch {
                    call.reject(error.localizedDescription)
                }
            }
        } else {
            call.reject("Friday 原生语音需要 iOS 27 或更高版本。")
        }
    }

    @objc func stopListening(_ call: CAPPluginCall) {
        if #available(iOS 27.0, *) {
            Task { @MainActor in
                do {
                    let text = try await engine?.stop() ?? ""
                    call.resolve(["text": text])
                } catch {
                    call.reject(error.localizedDescription)
                }
            }
        } else {
            call.reject("Friday 原生语音需要 iOS 27 或更高版本。")
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        if #available(iOS 27.0, *) {
            let status = engine?.status()
            call.resolve([
                "state": status?.state ?? "idle",
                "text": status?.text ?? ""
            ])
        } else {
            call.resolve(["state": "unavailable", "text": ""])
        }
    }
}
