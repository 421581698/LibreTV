'use client';

import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "recording" | "uploading" | "done" | "error";

const MAX_RECORDING_MS = 20_000;

function chooseMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export default function VoiceRecorderTestPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("准备就绪。每轮录音最多 20 秒。");
  const [transcript, setTranscript] = useState("");
  const [round, setRound] = useState(0);
  const [lastDuration, setLastDuration] = useState(0);
  const [lastBytes, setLastBytes] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const releaseMicrophone = () => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
      releaseMicrophone();
    };
  }, []);

  const startRecording = async () => {
    if (phase === "recording" || phase === "uploading") return;
    setTranscript("");
    setLastBytes(0);
    setMessage("正在请求麦克风权限……");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("当前浏览器不支持 getUserMedia，或页面不是 HTTPS 安全上下文。");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("当前 Safari 不支持 MediaRecorder。");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = chooseMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        releaseMicrophone();
        if (mountedRef.current) {
          setPhase("error");
          setMessage("录音器发生错误。请查看 Safari 页面控制台。");
        }
      };

      recorder.onstop = async () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        const duration = Math.max(0, Date.now() - startedAtRef.current);
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "application/octet-stream",
        });
        chunksRef.current = [];
        recorderRef.current = null;

        // 先停止所有 MediaStreamTrack，再进行网络上传。
        releaseMicrophone();

        if (!mountedRef.current) return;
        setLastDuration(duration);
        setLastBytes(blob.size);
        setPhase("uploading");
        setMessage("录音已结束，麦克风轨道已停止。正在上传并请求 ASR 转写……");

        if (!blob.size) {
          setPhase("error");
          setMessage("录音数据为空；本轮不计为成功。");
          return;
        }

        try {
          const form = new FormData();
          const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
          form.append("audio", blob, `voice-test.${extension}`);
          const response = await fetch("/api/voice-test/transcribe", {
            method: "POST",
            body: form,
            cache: "no-store",
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error || `ASR 请求失败（HTTP ${response.status}）`);
          }
          if (!mountedRef.current) return;
          setTranscript(String(payload.text || ""));
          setRound((value) => value + 1);
          setPhase("done");
          setMessage(payload.text ? "本轮录音、释放麦克风和 ASR 转写均完成。" : "录音上传成功，但 ASR 未返回转写文字。");
        } catch (error) {
          if (!mountedRef.current) return;
          setPhase("error");
          setMessage(error instanceof Error ? error.message : "上传或转写失败。");
        }
      };

      recorder.start(250);
      setPhase("recording");
      setMessage(`正在录音（${recorder.mimeType || "浏览器默认格式"}）。说完后点击“停止并转写”。`);
      timeoutRef.current = setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, MAX_RECORDING_MS);
    } catch (error) {
      releaseMicrophone();
      if (!mountedRef.current) return;
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "无法启动录音。");
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      recorder.stop();
    }
  };

  const busy = phase === "recording" || phase === "uploading";

  return (
    <main style={{ minHeight: "100svh", background: "#090b12", color: "#f4f6fb", padding: "28px 18px", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
        <p style={{ color: "#8d9bb8", letterSpacing: 2, fontSize: 12 }}>LIBRETV · VOICE LAB</p>
        <h1 style={{ fontSize: 28, margin: "8px 0" }}>MediaRecorder 连续录音测试</h1>
        <p style={{ color: "#aeb8ca", lineHeight: 1.7, fontSize: 14 }}>
          独立于 Friday / Web Speech API。每轮录音停止后立即关闭本页取得的全部麦克风轨道，再上传音频进行 ASR。
        </p>

        <div style={{ marginTop: 24, padding: 18, border: "1px solid #293247", borderRadius: 16, background: "#111725" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, color: "#aeb8ca" }}>
            <span>成功转写轮数</span><strong style={{ color: "#fff" }}>{round} / 5</strong>
          </div>
          <div style={{ height: 6, background: "#293247", borderRadius: 99, marginTop: 10, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(round, 5) * 20}%`, height: "100%", background: "#5ee0b5", transition: "width .2s" }} />
          </div>
          <p role="status" aria-live="polite" style={{ margin: "18px 0 0", lineHeight: 1.6, fontSize: 14 }}>{message}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={startRecording} disabled={busy} style={{ flex: 1, border: 0, borderRadius: 12, padding: "14px 10px", fontWeight: 700, color: "#07110e", background: busy ? "#53616b" : "#5ee0b5", opacity: busy ? .6 : 1 }}>
              开始录音
            </button>
            <button onClick={stopRecording} disabled={phase !== "recording"} style={{ flex: 1, border: "1px solid #56627a", borderRadius: 12, padding: "14px 10px", fontWeight: 700, color: "#fff", background: "#273247", opacity: phase !== "recording" ? .45 : 1 }}>
              停止并转写
            </button>
          </div>
          <button onClick={() => { setTranscript(""); setMessage("记录已清空，可以重新测试。"); setPhase("idle"); }} disabled={busy} style={{ width: "100%", marginTop: 10, padding: 10, color: "#aeb8ca", background: "transparent", border: "1px solid #293247", borderRadius: 10 }}>
            清空状态（不影响已完成的轮数）
          </button>
        </div>

        <div style={{ marginTop: 16, padding: 18, border: "1px solid #293247", borderRadius: 16, background: "#111725" }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>本轮采集结果</h2>
          <p style={{ color: "#aeb8ca", fontSize: 13, margin: "6px 0" }}>音频时长：{(lastDuration / 1000).toFixed(1)} 秒</p>
          <p style={{ color: "#aeb8ca", fontSize: 13, margin: "6px 0" }}>音频大小：{lastBytes.toLocaleString()} bytes</p>
          <p style={{ color: "#aeb8ca", fontSize: 13, margin: "6px 0" }}>麦克风轨道：停止后调用 track.stop() 释放</p>
          <div style={{ marginTop: 14, padding: 12, minHeight: 72, whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderRadius: 10, background: "#090e18", color: transcript ? "#e8fff7" : "#78859b", fontSize: 14 }}>
            {transcript || "ASR 转写内容将在这里显示。"}
          </div>
        </div>

        <div style={{ marginTop: 18, color: "#8996ac", fontSize: 12, lineHeight: 1.8 }}>
          <strong style={{ color: "#bdc8da" }}>五轮测试方法</strong>
          <ol style={{ paddingLeft: 20 }}>
            <li>点击开始，允许 Safari 使用麦克风，说一句完整的话。</li>
            <li>点击停止并转写；等待本轮完成。</li>
            <li>确认状态显示录音结束后，再开始下一轮。</li>
            <li>连续完成 5 轮，记录是否每轮都有音频大小和识别文字。</li>
          </ol>
          <p>请使用 HTTPS，在 iPhone Safari 前台页面测试。录音最长 20 秒；页面不会自动播放录音。</p>
        </div>
      </section>
    </main>
  );
}
