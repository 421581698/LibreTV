package tv.libretv.audio

import android.media.AudioDeviceInfo
import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidAudioRouteMapperTest {
    @Test
    fun mapsKnownOutputDeviceTypes() {
        assertEquals(
            NativeAudioRoute.BUILT_IN_SPEAKER,
            AndroidAudioRouteMapper.routeForDeviceType(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
        )
        assertEquals(
            NativeAudioRoute.WIRED_HEADPHONES,
            AndroidAudioRouteMapper.routeForDeviceType(AudioDeviceInfo.TYPE_WIRED_HEADPHONES)
        )
        assertEquals(
            NativeAudioRoute.BLUETOOTH,
            AndroidAudioRouteMapper.routeForDeviceType(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)
        )
        assertEquals(
            NativeAudioRoute.HDMI,
            AndroidAudioRouteMapper.routeForDeviceType(AudioDeviceInfo.TYPE_HDMI)
        )
    }

    @Test
    fun unknownDeviceTypeDoesNotGuess() {
        assertEquals(NativeAudioRoute.UNKNOWN, AndroidAudioRouteMapper.routeForDeviceType(-1))
    }
}
