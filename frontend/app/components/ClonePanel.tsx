import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import type { ClonedVoiceInfo } from "../lib/types";

const CLONE_MIN_SECONDS = 5;
const CLONE_MAX_SECONDS = 30;
const CLONE_READING_PROMPT =
  "Hi, this is my Kural voice sample. I am speaking clearly at a natural pace, with steady volume and a quiet room. Today I will read a few short sentences, count from one to ten, and pause briefly between ideas so the app can learn my voice without background noise.";

type ClonePanelTab = "upload" | "record";

type WindowWithWebkitAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

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

export function ClonePanel(props: {
  cloneBusy: boolean;
  cloneConsent: boolean;
  cloneFile: File | null;
  cloneLanguage: string;
  cloneMessage: string;
  cloneName: string;
  clones: ClonedVoiceInfo[];
  onCloneConsentChange: (value: boolean) => void;
  onCloneExport: () => void;
  onCloneFileChange: (value: File | null) => void;
  onCloneImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onCloneLanguageChange: (value: string) => void;
  onCloneNameChange: (value: string) => void;
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
    clones,
    onCloneConsentChange,
    onCloneExport,
    onCloneFileChange,
    onCloneImport,
    onCloneLanguageChange,
    onCloneNameChange,
    onCloneUpload,
    onDeleteClone,
  } = props;

  const [activeTab, setActiveTab] = useState<ClonePanelTab>("upload");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recorderMessage, setRecorderMessage] = useState("");
  const [sampleUrl, setSampleUrl] = useState("");

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
      return undefined;
    }
    const url = URL.createObjectURL(cloneFile);
    setSampleUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cloneFile]);

  const selectedFileDetail = cloneFile
    ? `${cloneFile.name} (${Math.max(1, Math.round(cloneFile.size / 1024))} KB)`
    : "No sample selected";

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
              <p>{CLONE_READING_PROMPT}</p>
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
            <div className="flex items-center justify-between gap-2">
              <span>
                {clone.name} {clone.language ? `(${clone.language})` : ""}
              </span>
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
