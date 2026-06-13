import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import type { ClonedVoiceInfo } from "../lib/types";

const CLONE_MIN_SECONDS = 5;
const CLONE_MAX_SECONDS = 30;
const CLONE_PROMPTS = [
  {
    id: "neutral",
    label: "Neutral proof",
    language: "any",
    accent: "general",
    text: "Hi, this is my Kural voice sample. I am speaking clearly at a natural pace, with steady volume and a quiet room. Today I will read a few short sentences, count from one to ten, and pause briefly between ideas so the app can learn my voice without background noise.",
  },
  {
    id: "range",
    label: "Expression range",
    language: "any",
    accent: "general",
    text: "This sample includes a calm sentence, a brighter sentence, and a slower closing line. I am keeping the same microphone distance while changing emotion gently, so Kural can hear my natural speaking range.",
  },
  {
    id: "consent",
    label: "Consent statement",
    language: "any",
    accent: "general",
    text: "I confirm that I own this voice or have permission to use it in Kural. This recording is for local voice cloning on this computer, and I understand that generated audio should be used responsibly.",
  },
  {
    id: "en-us-story",
    label: "English US story",
    language: "en-US",
    accent: "US",
    text: "When I record a voice sample, I keep the microphone steady and speak like I am telling a short story to one person. The room is quiet, my words are clear, and every sentence has a natural beginning and ending.",
  },
  {
    id: "en-in-instruction",
    label: "English India tutorial",
    language: "en-IN",
    accent: "India",
    text: "This is a clean tutorial voice sample for Kural. First, I explain the topic clearly. Next, I pause for a moment. Finally, I close the sentence with the same natural tone and volume.",
  },
  {
    id: "hi-in-consent",
    label: "Hindi India consent",
    language: "hi-IN",
    accent: "India",
    text: "Yeh meri awaaz ka sample hai. Main shaant jagah par saaf aur prakritik tareeke se bol raha hoon. Mujhe is awaaz ko Kural mein istemaal karne ki anumati hai.",
  },
];
const CLONE_ALLOWED_USES = ["personal", "commercial", "parody", "internal", "restricted"] as const;
type CloneAllowedUse = (typeof CLONE_ALLOWED_USES)[number];
type CloneTier = "quick" | "professional";

type ClonePanelTab = "upload" | "record";

type WindowWithWebkitAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

interface SampleScore {
  duration: number;
  peak: number;
  rms: number;
  clippedRatio: number;
  silenceRatio: number;
  noiseFloor: number;
  score: number;
  warnings: string[];
  strengths: string[];
}

function formatSeconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

function flattenAudio(chunks: Float32Array[], totalSamples: number): Float32Array {
  const result = new Float32Array(totalSamples);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  samples.forEach((sample) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  });

  return new Blob([view], { type: "audio/wav" });
}

async function scoreSample(file: File): Promise<SampleScore> {
  const AudioContextCtor =
    window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (!AudioContextCtor) {
    return {
      duration: 0,
      peak: 0,
      rms: 0,
      clippedRatio: 0,
      silenceRatio: 0,
      noiseFloor: 0,
      score: 0,
      warnings: ["Audio analysis is not available in this browser."],
      strengths: [],
    };
  }
  const context = new AudioContextCtor();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channel = buffer.getChannelData(0);
    let peak = 0;
    let sum = 0;
    let clipped = 0;
    let silent = 0;
    let noiseSum = 0;
    const noiseWindow = Math.min(channel.length, Math.floor(buffer.sampleRate * 0.5));
    for (let i = 0; i < channel.length; i += 1) {
      const value = Math.abs(channel[i]);
      peak = Math.max(peak, value);
      sum += value * value;
      if (value > 0.98) clipped += 1;
      if (value < 0.008) silent += 1;
      if (i < noiseWindow) noiseSum += value * value;
    }
    const rms = Math.sqrt(sum / Math.max(1, channel.length));
    const clippedRatio = clipped / Math.max(1, channel.length);
    const silenceRatio = silent / Math.max(1, channel.length);
    const noiseFloor = Math.sqrt(noiseSum / Math.max(1, noiseWindow));
    const warnings: string[] = [];
    const strengths: string[] = [];
    if (buffer.duration < CLONE_MIN_SECONDS) warnings.push("Sample is shorter than 5 seconds.");
    if (buffer.duration > CLONE_MAX_SECONDS) warnings.push("Sample is longer than 30 seconds.");
    if (peak > 0.98) warnings.push("Possible clipping detected.");
    if (rms < 0.015) warnings.push("Recording level is very quiet.");
    if (rms > 0.35) warnings.push("Recording level is very loud.");
    if (silenceRatio > 0.45) warnings.push("Too much silence detected; keep a steady read.");
    if (noiseFloor > 0.04) warnings.push("Noise floor is high; try a quieter room or closer mic.");
    if (buffer.duration >= 12 && buffer.duration <= 25) strengths.push("Duration is in the ideal range.");
    if (peak >= 0.35 && peak <= 0.92) strengths.push("Peak level leaves useful headroom.");
    if (rms >= 0.03 && rms <= 0.22) strengths.push("Average level is healthy for cloning.");
    if (silenceRatio <= 0.3) strengths.push("Speech is present through most of the sample.");
    const score = Math.max(
      0,
      100 -
        warnings.length * 18 -
        (buffer.duration >= 12 && buffer.duration <= 25 ? 0 : 10) -
        (peak > 0.98 ? 15 : 0) -
        (silenceRatio > 0.45 ? 10 : 0) -
        (noiseFloor > 0.04 ? 10 : 0)
    );
    return { duration: buffer.duration, peak, rms, clippedRatio, silenceRatio, noiseFloor, score, warnings, strengths };
  } finally {
    await context.close();
  }
}

export function ClonePanel(props: {
  cloneBusy: boolean;
  cloneConsent: boolean;
  cloneFile: File | null;
  cloneLanguage: string;
  cloneMessage: string;
  cloneName: string;
  cloneTier: CloneTier;
  cloneAllowedUses: CloneAllowedUse[];
  clones: ClonedVoiceInfo[];
  onCloneAllowedUsesChange: (value: CloneAllowedUse[]) => void;
  onCloneConsentChange: (value: boolean) => void;
  onCloneExport: () => void;
  onCloneFileChange: (value: File | null) => void;
  onCloneImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onCloneLanguageChange: (value: string) => void;
  onCloneNameChange: (value: string) => void;
  onCloneQualityScoreChange: (value: number | null) => void;
  onCloneTierChange: (value: CloneTier) => void;
  onCloneUpload: () => void;
  onDeleteClone: (id: string) => void;
}) {
  const {
    cloneBusy,
    cloneConsent,
    cloneFile,
    cloneLanguage,
    cloneMessage,
    cloneName,
    cloneTier,
    cloneAllowedUses,
    clones,
    onCloneAllowedUsesChange,
    onCloneConsentChange,
    onCloneExport,
    onCloneFileChange,
    onCloneImport,
    onCloneLanguageChange,
    onCloneNameChange,
    onCloneQualityScoreChange,
    onCloneTierChange,
    onCloneUpload,
    onDeleteClone,
  } = props;

  const [activeTab, setActiveTab] = useState<ClonePanelTab>("upload");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recorderMessage, setRecorderMessage] = useState("");
  const [sampleUrl, setSampleUrl] = useState("");
  const [sampleScore, setSampleScore] = useState<SampleScore | null>(null);
  const [promptId, setPromptId] = useState(CLONE_PROMPTS[0].id);
  const [promptAccent, setPromptAccent] = useState("general");

  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const isRecordingRef = useRef(false);
  const sampleCountRef = useRef(0);
  const sampleRateRef = useRef(0);
  const startedAtRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);

  const cleanupRecorder = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    const duration = sampleRateRef.current
      ? sampleCountRef.current / sampleRateRef.current
      : (Date.now() - startedAtRef.current) / 1000;
    const chunks = chunksRef.current;
    const sampleCount = sampleCountRef.current;
    const sampleRate = sampleRateRef.current;

    cleanupRecorder();
    isRecordingRef.current = false;
    setIsRecording(false);
    setRecordingSeconds(duration);

    if (duration < CLONE_MIN_SECONDS || sampleCount === 0 || sampleRate === 0) {
      chunksRef.current = [];
      sampleCountRef.current = 0;
      setRecorderMessage(`Keep recording for at least ${CLONE_MIN_SECONDS} seconds.`);
      return;
    }

    const wavBlob = encodeWav(flattenAudio(chunks, sampleCount), sampleRate);
    const file = new File([wavBlob], "kural-voice-sample.wav", {
      type: "audio/wav",
      lastModified: Date.now(),
    });
    onCloneFileChange(file);
    setRecorderMessage(`Recorded ${formatSeconds(duration)} WAV sample selected.`);
  }, [cleanupRecorder, onCloneFileChange]);

  async function startRecording() {
    if (isRecording || cloneBusy) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecorderMessage("Microphone recording is not available in this browser.");
      return;
    }

    const AudioContextCtor =
      window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (!AudioContextCtor) {
      setRecorderMessage("This browser does not support local microphone capture.");
      return;
    }

    cleanupRecorder();
    chunksRef.current = [];
    sampleCountRef.current = 0;
    sampleRateRef.current = 0;
    setRecordingSeconds(0);
    setRecorderMessage("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const gain = audioContext.createGain();
      gain.gain.value = 0;

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(input));
        sampleCountRef.current += input.length;
      };

      source.connect(processor);
      processor.connect(gain);
      gain.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      processorRef.current = processor;
      sourceRef.current = source;
      gainRef.current = gain;
      streamRef.current = stream;
      sampleRateRef.current = audioContext.sampleRate;
      startedAtRef.current = Date.now();
      isRecordingRef.current = true;
      setIsRecording(true);

      intervalRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.min(CLONE_MAX_SECONDS, (Date.now() - startedAtRef.current) / 1000));
      }, 200);
      maxTimerRef.current = window.setTimeout(() => {
        stopRecording();
      }, CLONE_MAX_SECONDS * 1000);
    } catch (exc) {
      cleanupRecorder();
      setIsRecording(false);
      setRecorderMessage(
        exc instanceof Error ? exc.message : "Could not start microphone recording."
      );
    }
  }

  useEffect(() => {
    return () => cleanupRecorder();
  }, [cleanupRecorder]);

  useEffect(() => {
    if (!cloneFile) {
      setSampleUrl("");
      setSampleScore(null);
      onCloneQualityScoreChange(null);
      return undefined;
    }
    const url = URL.createObjectURL(cloneFile);
    setSampleUrl(url);
    let cancelled = false;
    void scoreSample(cloneFile)
      .then((score) => {
        if (!cancelled) {
          setSampleScore(score);
          onCloneQualityScoreChange(score.score);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSampleScore({
            duration: 0,
            peak: 0,
            rms: 0,
            clippedRatio: 0,
            silenceRatio: 0,
            noiseFloor: 0,
            score: 0,
            warnings: ["Could not analyze this sample."],
            strengths: [],
          });
          onCloneQualityScoreChange(null);
        }
      });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [cloneFile, onCloneQualityScoreChange]);

  const selectedFileDetail = cloneFile
    ? `${cloneFile.name} (${Math.max(1, Math.round(cloneFile.size / 1024))} KB)`
    : "No sample selected";
  const visiblePrompts = CLONE_PROMPTS.filter(
    (prompt) =>
      prompt.language === "any" ||
      prompt.language.toLowerCase() === cloneLanguage.toLowerCase() ||
      prompt.accent.toLowerCase() === promptAccent.toLowerCase()
  );
  const activePrompt =
    visiblePrompts.find((prompt) => prompt.id === promptId) ||
    CLONE_PROMPTS.find((prompt) => prompt.id === promptId) ||
    CLONE_PROMPTS[0];
  const readinessLabel =
    !sampleScore ? "No sample" : sampleScore.score >= 80 ? "Clone-ready" : sampleScore.score >= 55 ? "Needs cleanup" : "Retake recommended";

  function downloadReadinessReport() {
    if (!cloneFile || !sampleScore) return;
    const report = {
      schemaVersion: 1,
      kind: "kural-clone-readiness-report",
      createdAt: new Date().toISOString(),
      file: {
        name: cloneFile.name,
        size: cloneFile.size,
        type: cloneFile.type,
      },
      language: cloneLanguage,
      requestedName: cloneName,
      consentConfirmed: cloneConsent,
      prompt: activePrompt,
      score: sampleScore,
      recommendation: readinessLabel,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${cloneName.trim() || "kural-clone"}-readiness.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded border border-slate-300 p-3" aria-labelledby="clone-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="clone-heading" className="font-semibold">Clone a Voice</h2>
        <div
          className="inline-flex rounded border border-slate-300 p-0.5 text-xs"
          role="tablist"
          aria-label="Clone sample source"
        >
          {(["upload", "record"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                activeTab === tab ? "bg-slate-950 text-white" : "text-slate-700"
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "upload" ? "Upload" : "Record"}
            </button>
          ))}
        </div>
      </div>

      <details className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm" open>
        <summary className="cursor-pointer font-medium">Sample guide</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
          <li>Use a clear 5 to 30 second sample. Around 15 to 25 seconds works best.</li>
          <li>Record one speaker in a quiet room, close to the mic, with steady volume.</li>
          <li>Use a natural reading voice and include short pauses between sentences.</li>
          <li>Only clone a voice you own or have explicit permission to use.</li>
        </ul>
      </details>

      <div className="mt-3 space-y-3">
        {activeTab === "upload" && (
          <div role="tabpanel" aria-label="Upload audio sample">
            <label className="block text-sm">
              Audio sample
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                type="file"
                accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/mp4,audio/*"
                onChange={(event) => {
                  onCloneFileChange(event.target.files?.[0] ?? null);
                  setRecorderMessage("");
                }}
              />
            </label>
          </div>
        )}

        {activeTab === "record" && (
          <div className="space-y-3" role="tabpanel" aria-label="Record audio sample">
            <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-800">
              <div className="mb-1 text-xs font-medium uppercase text-slate-500">
                Read this aloud
              </div>
              <label className="mb-2 block text-xs font-medium text-slate-600">
                Script
                <select
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  value={promptId}
                  onChange={(event) => setPromptId(event.target.value)}
                >
                  {visiblePrompts.map((prompt) => (
                    <option key={prompt.id} value={prompt.id}>
                      {prompt.label}
                    </option>
                  ))}
                </select>
              </label>
              <p>{activePrompt.text}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                disabled={isRecording || cloneBusy}
                onClick={() => void startRecording()}
              >
                Start Recording
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                disabled={!isRecording}
                onClick={stopRecording}
              >
                Stop
              </button>
              <span className="text-sm text-slate-600" aria-live="polite">
                {isRecording ? "Recording " : "Length "}
                {formatSeconds(recordingSeconds)}
              </span>
            </div>
            {recorderMessage && (
              <p className="text-sm text-slate-700" role="status" aria-live="polite">
                {recorderMessage}
              </p>
            )}
          </div>
        )}

        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="font-medium">Selected sample</div>
          <div className="mt-1 break-all">{selectedFileDetail}</div>
          {sampleUrl && (
            <audio
              className="mt-2 w-full"
              controls
              src={sampleUrl}
              aria-label="Selected clone sample preview"
            />
          )}
          {sampleScore && (
            <div className="mt-3 rounded border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">Clone readiness</span>
                <span
                  className={`rounded border px-2 py-1 text-xs ${
                    sampleScore.score >= 80
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : sampleScore.score >= 55
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  {readinessLabel} / {sampleScore.score}/100
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600 md:grid-cols-6">
                <div>
                  <dt>Length</dt>
                  <dd>{formatSeconds(sampleScore.duration)}</dd>
                </div>
                <div>
                  <dt>Peak</dt>
                  <dd>{Math.round(sampleScore.peak * 100)}%</dd>
                </div>
                <div>
                  <dt>Level</dt>
                  <dd>{Math.round(sampleScore.rms * 100)}%</dd>
                </div>
                <div>
                  <dt>Clipped</dt>
                  <dd>{Math.round(sampleScore.clippedRatio * 1000) / 10}%</dd>
                </div>
                <div>
                  <dt>Silence</dt>
                  <dd>{Math.round(sampleScore.silenceRatio * 100)}%</dd>
                </div>
                <div>
                  <dt>Noise floor</dt>
                  <dd>{Math.round(sampleScore.noiseFloor * 100)}%</dd>
                </div>
              </dl>
              {sampleScore.strengths.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-emerald-800">
                  {sampleScore.strengths.map((strength) => (
                    <li key={strength}>{strength}</li>
                  ))}
                </ul>
              )}
              {sampleScore.warnings.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                  {sampleScore.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="mt-3 rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
                onClick={downloadReadinessReport}
              >
                Export Readiness Report
              </button>
            </div>
          )}
        </div>

        <label className="block text-sm">
          Voice name
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={cloneName}
            onChange={(event) => onCloneNameChange(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Language
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={cloneLanguage}
            onChange={(event) => onCloneLanguageChange(event.target.value)}
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            Clone tier
            <select
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={cloneTier}
              onChange={(event) => onCloneTierChange(event.target.value as CloneTier)}
            >
              <option value="quick">Quick clone</option>
              <option value="professional">Professional clone pack</option>
            </select>
          </label>
          <label className="block text-sm">
            Recording accent
            <select
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={promptAccent}
              onChange={(event) => setPromptAccent(event.target.value)}
            >
              <option value="general">General</option>
              <option value="US">US</option>
              <option value="India">India</option>
              <option value="UK">UK</option>
            </select>
          </label>
        </div>
        <fieldset className="rounded border border-slate-200 p-3 text-sm">
          <legend className="px-1 font-medium">Allowed uses</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {CLONE_ALLOWED_USES.map((use) => (
              <label
                key={use}
                className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1"
              >
                <input
                  type="checkbox"
                  checked={cloneAllowedUses.includes(use)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...cloneAllowedUses, use]
                      : cloneAllowedUses.filter((item) => item !== use);
                    onCloneAllowedUsesChange(next.length ? next : ["personal"]);
                  }}
                />
                <span className="capitalize">{use}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={cloneConsent}
            onChange={(event) => onCloneConsentChange(event.target.checked)}
          />
          I have consent to clone and use this voice.
        </label>
        <button
          type="button"
          className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
          disabled={cloneBusy}
          onClick={onCloneUpload}
          aria-busy={cloneBusy}
        >
          {cloneBusy ? "Cloning..." : "Clone Voice"}
        </button>
        {cloneMessage && (
          <p className="text-sm text-slate-700" role="status" aria-live="polite">
            {cloneMessage}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={onCloneExport}
        >
          Export Voices
        </button>
        <label className="cursor-pointer rounded border border-slate-300 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-slate-400">
          Import Voices
          <input
            id="clone-archive-file"
            className="hidden"
            type="file"
            accept=".zip"
            onChange={onCloneImport}
          />
        </label>
      </div>

      <div className="mt-4 space-y-2">
        {clones.map((clone) => (
          <div key={clone.id} className="rounded border border-slate-200 px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-medium">
                  {clone.name} {clone.language ? `(${clone.language})` : ""}
                </span>
                <dl className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                  <div>
                    <dt>Tier</dt>
                    <dd className="capitalize">{clone.clone_tier || "quick"}</dd>
                  </div>
                  <div>
                    <dt>Quality</dt>
                    <dd>{clone.quality_score ?? "-"} / 100</dd>
                  </div>
                  <div>
                    <dt>Allowed</dt>
                    <dd>{(clone.allowed_uses || ["personal"]).join(", ")}</dd>
                  </div>
                  <div>
                    <dt>Consent</dt>
                    <dd>{clone.consent_confirmed ? "confirmed" : "missing"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt>Sample hash</dt>
                    <dd className="break-all font-mono">
                      {clone.sample_sha256?.slice(0, 32) || "-"}
                    </dd>
                  </div>
                </dl>
              </div>
              <button
                type="button"
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                aria-label={`Delete cloned voice: ${clone.name}`}
                onClick={() => onDeleteClone(clone.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {clones.length === 0 && (
          <p className="text-sm text-slate-500">No cloned voices yet.</p>
        )}
      </div>
    </section>
  );
}
