import Foundation

#if os(iOS)
import AVFAudio
import UIKit
#endif

public enum NativeAudioPlatform: String, Codable, Sendable {
    case ios
    case ipados
    case android
}

public enum NativeAudioRoute: String, Codable, Sendable {
    case builtInSpeaker = "built-in-speaker"
    case wiredHeadphones = "wired-headphones"
    case bluetooth
    case hdmi
    case unknown
}

public enum NativeReportedState: String, Codable, Sendable {
    case reportedActive = "reported-active"
    case reportedInactive = "reported-inactive"
    case unsupported
    case unknown
}

public struct NativeAudioInput: Codable, Sendable {
    public let codec: String?
    public let channels: Int?
    public let sampleRateHz: Int?
    public let jocMarker: String

    public init(codec: String? = nil, channels: Int? = nil, sampleRateHz: Int? = nil, jocMarker: String = "unknown") {
        self.codec = codec
        self.channels = channels
        self.sampleRateHz = sampleRateHz
        self.jocMarker = jocMarker
    }
}

public struct NativeAudioSnapshotV1: Codable, Sendable {
    public struct Device: Codable, Sendable {
        public let osVersion: String
        public let appVersion: String
    }
    public struct Decoder: Codable, Sendable {
        public let state: String
        public let codec: String?
    }
    public struct Spatializer: Codable, Sendable {
        public let available: Bool?
        public let enabled: Bool?
    }
    public struct Output: Codable, Sendable {
        public let route: NativeAudioRoute
        public let nativeDolbyState: NativeReportedState
        public let jocDecodeState: NativeReportedState
        public let objectRenderState: NativeReportedState
    }

    public let version: Int
    public let platform: NativeAudioPlatform
    public let sessionId: String
    public let capturedAtMs: Int64
    public let device: Device
    public let input: NativeAudioInput
    public let decoder: Decoder
    public let spatializer: Spatializer
    public let output: Output
}

public enum IOSAudioRouteMapper {
    public static func route(forPortTypeRawValue rawValue: String) -> NativeAudioRoute {
        switch rawValue {
        case "Speaker", "BuiltInSpeaker":
            return .builtInSpeaker
        case "Headphones", "HeadsetMic":
            return .wiredHeadphones
        case "BluetoothA2DP", "BluetoothHFP", "BluetoothLE":
            return .bluetooth
        case "HDMI":
            return .hdmi
        default:
            return .unknown
        }
    }
}

/// Read-only adapter for a trusted iOS/iPadOS host application.
///
/// AVAudioSession exposes the active route, but does not provide public evidence
/// that JOC was decoded or that Dolby object rendering is active. Those fields
/// therefore remain unknown unless a separately verified native pipeline exists.
public struct IOSNativeAudioAdapter {
    public init() {}

    @MainActor
    public func snapshot(sessionId: String, input: NativeAudioInput = NativeAudioInput()) -> NativeAudioSnapshotV1 {
        #if os(iOS)
        let audioSession = AVAudioSession.sharedInstance()
        let route = audioSession.currentRoute.outputs
            .map { IOSAudioRouteMapper.route(forPortTypeRawValue: $0.portType.rawValue) }
            .first(where: { $0 != .unknown }) ?? .unknown
        let platform: NativeAudioPlatform = UIDevice.current.userInterfaceIdiom == .pad ? .ipados : .ios
        #else
        let route = NativeAudioRoute.unknown
        let platform = NativeAudioPlatform.ios
        #endif

        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        return NativeAudioSnapshotV1(
            version: 1,
            platform: platform,
            sessionId: sessionId,
            capturedAtMs: Int64(Date().timeIntervalSince1970 * 1_000),
            device: .init(osVersion: ProcessInfo.processInfo.operatingSystemVersionString, appVersion: appVersion),
            input: input,
            decoder: .init(state: "unknown", codec: nil),
            spatializer: .init(available: nil, enabled: nil),
            output: .init(
                route: route,
                nativeDolbyState: .unknown,
                jocDecodeState: .unknown,
                objectRenderState: .unknown
            )
        )
    }
}
