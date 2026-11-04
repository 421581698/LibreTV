# Friday iOS Native Bootstrap

This folder contains the first native iOS bootstrap for Friday.

## Current scope

- Capacitor 8 host project is generated in GitHub Actions (not committed as generated Xcode project files).
- A local Capacitor Swift Package exposes the `FridayVoice` JavaScript bridge.
- The iOS 27+ engine uses `AVAudioSession`, `AVCaptureSession`, `SpeechAnalyzer`, and `SpeechTranscriber` for on-device Simplified Chinese transcription.
- Siri App Intents are declared in the plugin package and explicitly included by the generated app target. The shortcut opens Friday; it does not bypass microphone permission or silently start recording.
- The manual workflow currently builds an unsigned iOS Simulator app artifact.

## Triggering the first cloud build

1. Open **Actions** in GitHub.
2. Select **Friday iOS Native Build**.
3. Choose **Run workflow**.
4. Optionally enter the HTTPS LibreTV Preview URL in `web_url`. Leave it empty to use the bundled native shell.
5. Run the workflow and download the `Friday-iOS-Simulator` artifact when it succeeds.

## Important signing limitation

The simulator artifact is not an iPhone-installable IPA. Installing on a physical iPhone or distributing through TestFlight requires Apple signing assets; TestFlight additionally requires an active Apple Developer Program membership. Do not put certificates, provisioning profiles, or App Store Connect private keys in source control; add them only as GitHub Actions Secrets when signing is configured.

## Speech model behavior

The first Chinese transcription may need to download Apple's on-device speech assets. Model availability is checked at runtime; the OS version alone does not guarantee that the required locale/model is available on every device.

## Beta API note

The iOS 27 `CaptureInputSequenceProvider` capture helper is currently documented as beta. Treat this branch as a device-validation prototype until the Xcode 27 cloud build and physical-device tests pass.
