import XCTest
@testable import LibreTVNativeAudio

final class NativeAudioAdapterTests: XCTestCase {
    func testMapsKnownIOSAudioRoutes() {
        XCTAssertEqual(IOSAudioRouteMapper.route(forPortTypeRawValue: "Speaker"), .builtInSpeaker)
        XCTAssertEqual(IOSAudioRouteMapper.route(forPortTypeRawValue: "BuiltInSpeaker"), .builtInSpeaker)
        XCTAssertEqual(IOSAudioRouteMapper.route(forPortTypeRawValue: "Headphones"), .wiredHeadphones)
        XCTAssertEqual(IOSAudioRouteMapper.route(forPortTypeRawValue: "BluetoothA2DP"), .bluetooth)
        XCTAssertEqual(IOSAudioRouteMapper.route(forPortTypeRawValue: "HDMI"), .hdmi)
    }

    func testUnknownRouteDoesNotGuess() {
        XCTAssertEqual(IOSAudioRouteMapper.route(forPortTypeRawValue: "CarAudio"), .unknown)
    }
}
