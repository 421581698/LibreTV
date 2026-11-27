import type { DolbyVisionNativeCapabilityReport } from './native-playback-capability';
import type { NativePlaybackObservation } from './native-playback-observation';

export type DolbyVisionStageState =
  | 'signed-evidence'
  | 'browser-observed'
  | 'capability-hint'
  | 'declaration-only'
  | 'not-established';

export interface DolbyVisionStageAssessment {
  id: 'native-decoder' | 'rpu-analysis' | 'per-frame-mapping' | 'dynamic-rendering' | 'hdr-output' | 'device-acceptance';
  label: string;
  state: DolbyVisionStageState;
  explanation: string;
}

/**
 * The six Dolby Vision engineering stages are independent evidence gates.
 *
 * A native HTMLVideoElement does not expose proof that the OS decoded Dolby
 * Vision, consumed any RPU, mapped its per-frame metadata, or drove an HDR
 * output. Never promote ordinary decoded frames, a signed RPU report, an HLS
 * declaration, or a dynamic-range query into those missing proofs.
 */
export function assessDolbyVisionPipeline(input: {
  declared: boolean;
  signedRpuVerified: boolean;
  playback: NativePlaybackObservation;
  capability: DolbyVisionNativeCapabilityReport | null;
  /** Server-verified exact registered HEVC sample↔RPU mapping, NOT observed player RPU consumption. */
  registeredFrameMappingVerified?: boolean;
}): DolbyVisionStageAssessment[] {
  const { declared, signedRpuVerified, playback, capability } = input;
  const renderedVideoFrames = playback.status === 'progress-observed' &&
    playback.presentedFrames !== null && playback.presentedFrames > 0;
  const nativeCodecHint = capability?.nativeHls !== 'no' &&
    capability?.nativeHls !== 'unknown' &&
    capability?.codecs.some((codec) => codec.support === 'maybe' || codec.support === 'probably');
  return [
    {
      id: 'native-decoder',
      label: '3.1 原生解码路径',
      state: renderedVideoFrames ? 'browser-observed' : nativeCodecHint ? 'capability-hint' : 'not-established',
      explanation: renderedVideoFrames
        ? '浏览器实际呈现了视频帧；无法确认使用了 Dolby Vision 解码器。'
        : nativeCodecHint
          ? 'Safari/HLS 与 Codec 能力查询有提示；尚无实际解码证据。'
          : '未取得可用的原生解码观测。',
    },
    {
      id: 'rpu-analysis',
      label: '3.2 RPU 元数据解析',
      state: signedRpuVerified ? 'signed-evidence' : declared ? 'declaration-only' : 'not-established',
      explanation: signedRpuVerified
        ? '已取得当前注册资产的签名 RPU 解析证据；不证明播放器使用了 RPU。'
        : declared
          ? '只检测到 Dolby Vision 编码声明，RPU 本体未验真。'
          : '当前资源没有可验证的 RPU 解析结果。',
    },
    {
      id: 'per-frame-mapping',
      label: '3.3 逐帧动态元数据',
      state: input.registeredFrameMappingVerified && signedRpuVerified ? 'signed-evidence' : 'not-established',
      explanation: input.registeredFrameMappingVerified && signedRpuVerified
        ? '登记资产的逐帧 PTS↔RPU 映射已验签；尚无当前 Safari 解码或逐帧消费 RPU 的证据。'
        : '尚无播放器逐帧应用 RPU 的可信证据；HLS 总帧数匹配并不等于逐帧对应。',
    },
    {
      id: 'dynamic-rendering',
      label: '3.4 动态渲染',
      state: 'not-established',
      explanation: '网页未接入可验证的 Dolby Vision RPU 驱动合成器，不能以 CSS/HDR 近似冒充。',
    },
    {
      id: 'hdr-output',
      label: '3.5 HDR 显示输出',
      state: capability?.hdrDisplayHint === 'high' ? 'capability-hint' : 'not-established',
      explanation: capability?.hdrDisplayHint === 'high'
        ? '浏览器报告高动态范围显示能力；不证明当前视频正以 HDR 或 Dolby Vision 输出。'
        : '当前没有可信的 HDR 像素输出证据。',
    },
    {
      id: 'device-acceptance',
      label: '3.6 iPad 真机验收',
      state: 'not-established',
      explanation: '需要记录真实设备、系统版本、授权片源及输出链路；浏览器单元测试不能代替。',
    },
  ];
}
