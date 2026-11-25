package tv.libretv.audio

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import org.json.JSONObject

enum class NativeAudioRoute(val wireValue: String) {
    BUILT_IN_SPEAKER("built-in-speaker"),
    WIRED_HEADPHONES("wired-headphones"),
    BLUETOOTH("bluetooth"),
    HDMI("hdmi"),
    UNKNOWN("unknown")
}

object AndroidAudioRouteMapper {
    fun routeForDeviceType(type: Int): NativeAudioRoute = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> NativeAudioRoute.BUILT_IN_SPEAKER
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET -> NativeAudioRoute.WIRED_HEADPHONES
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLE_HEADSET -> NativeAudioRoute.BLUETOOTH
        AudioDeviceInfo.TYPE_HDMI,
        AudioDeviceInfo.TYPE_HDMI_ARC,
        AudioDeviceInfo.TYPE_HDMI_EARC -> NativeAudioRoute.HDMI
        else -> NativeAudioRoute.UNKNOWN
    }
}

data class NativeAudioInput(
    val codec: String? = null,
    val channels: Int? = null,
    val sampleRateHz: Int? = null,
    val jocMarker: String = "unknown"
)

/**
 * Read-only capability/route adapter for a trusted Android host application.
 *
 * The host must pass the output device actually routed by its AudioTrack/player.
 * A list of connected devices is not evidence of the active route. Decoder
 * discovery means "supported", not "currently decoding". Dolby/JOC/object
 * output stays unknown because the public APIs used here do not prove it.
 */
class AndroidNativeAudioAdapter(context: Context) {
    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    fun snapshot(
        sessionId: String,
        appVersion: String,
        input: NativeAudioInput = NativeAudioInput(),
        activeOutputDevice: AudioDeviceInfo? = null
    ): JSONObject {
        val route = activeOutputDevice?.let { AndroidAudioRouteMapper.routeForDeviceType(it.type) }
            ?: NativeAudioRoute.UNKNOWN
        val jocDecoderSupported = supportsDecoder("audio/eac3-joc", input.channels ?: 6)
        val spatializerAvailable: Boolean?
        val spatializerEnabled: Boolean?

        if (Build.VERSION.SDK_INT >= 32) {
            val spatializer = audioManager.spatializer
            spatializerAvailable = spatializer.isAvailable
            spatializerEnabled = spatializer.isEnabled
        } else {
            spatializerAvailable = null
            spatializerEnabled = null
        }

        return JSONObject()
            .put("version", 1)
            .put("platform", "android")
            .put("sessionId", sessionId)
            .put("capturedAtMs", System.currentTimeMillis())
            .put("device", JSONObject()
                .put("osVersion", Build.VERSION.RELEASE ?: "unknown")
                .put("appVersion", appVersion))
            .put("input", JSONObject()
                .put("codec", input.codec)
                .put("channels", input.channels)
                .put("sampleRateHz", input.sampleRateHz)
                .put("jocMarker", input.jocMarker))
            .put("decoder", JSONObject()
                .put("state", if (jocDecoderSupported) "supported" else "unknown")
                .put("codec", if (jocDecoderSupported) "audio/eac3-joc" else JSONObject.NULL))
            .put("spatializer", JSONObject()
                .put("available", spatializerAvailable ?: JSONObject.NULL)
                .put("enabled", spatializerEnabled ?: JSONObject.NULL))
            .put("output", JSONObject()
                .put("route", route.wireValue)
                .put("nativeDolbyState", "unknown")
                .put("jocDecodeState", "unknown")
                .put("objectRenderState", "unknown"))
    }

    private fun supportsDecoder(mimeType: String, channels: Int): Boolean {
        return try {
            val format = MediaFormat.createAudioFormat(mimeType, 48_000, channels.coerceIn(1, 8))
            MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(format) != null
        } catch (_: RuntimeException) {
            false
        }
    }
}
