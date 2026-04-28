"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteAudioItem,
  loadAudioItems,
  saveAudioItem,
  type StoredAudioItem,
} from "./lib/audioLibrary";

function getInjectedValue(key: string): string {
  if (typeof window === "undefined") return "";
  const injected = (window as unknown as Record<string, unknown>)[key];
  return typeof injected === "string" ? injected : "";
}

function getApiUrl(): string {
  const injected = getInjectedValue("__KURAL_API_URL__");
  return injected || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  gender: string;
  description: string;
}

interface ClonedVoiceInfo {
  id: string;
  name: string;
  engine: string;
  duration_s: number;
  sample_rate: number;
  created_at: string;
  consent_confirmed?: boolean;
  watermark?: string | null;
}

type SelectedVoice =
  | { kind: "kokoro"; id: string }
  | { kind: "clone"; id: string };

type OutputFormat = "wav" | "mp3";
type Mode = "single" | "batch";

interface HistoryItem {
  id: string;
  text: string;
  voiceLabel: string;
  format: OutputFormat;
  audioUrl: string;
  createdAt: string;
  bytes: number;
}

const HISTORY_LIMIT = 12;
const PRONUNCIATION_KEY = "kural.pronunciation.v1";
const SYNTH_CHUNK_LIMIT = 3200;

function splitBatchInput(value: string): string[] {
  return value
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyPronunciation(text: string, dictionary: string): string {
  return dictionary
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((current, line) => {
      const match = line.match(/^(.+?)(?:=>|=|->)(.+)$/);
      if (!match) return current;
      const from = match[1].trim();
      const to = match[2].trim();
      if (!from || !to) return current;
      return current.replace(new RegExp(escapeRegExp(from), "gi"), to);
    }, text);
}

function splitLongText(value: string, limit = SYNTH_CHUNK_LIMIT): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length <= limit) return normalized ? [normalized] : [];

  const chunks: string[] = [];
  let remaining = normalized;
  const minCut = Math.floor(limit * 0.5);

  while (remaining.length > limit) {
    const windowText = remaining.slice(0, limit + 1);
    const sentenceCut = Math.max(
      windowText.lastIndexOf(". "),
      windowText.lastIndexOf("! "),
      windowText.lastIndexOf("? ")
    );
    const commaCut = windowText.lastIndexOf(", ");
    const spaceCut = windowText.lastIndexOf(" ");
    const cut =
      sentenceCut >= minCut
        ? sentenceCut + 1
        : commaCut >= Math.floor(limit * 0.65)
          ? commaCut + 1
          : spaceCut >= minCut
            ? spaceCut
            : limit;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function parsePcmWav(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 44 ||
    String.fromCharCode(...new Uint8Array(buffer.slice(0, 4))) !== "RIFF" ||
    String.fromCharCode(...new Uint8Array(buffer.slice(8, 12))) !== "WAVE"
  ) {
    throw new Error("Unsupported WAV data");
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let blockAlign = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt ") {
      audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      byteRate = view.getUint32(chunkDataOffset + 8, true);
      blockAlign = view.getUint16(chunkDataOffset + 12, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    }

    if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || !dataOffset) {
    throw new Error("Only PCM WAV chunks can be stitched");
  }

  return {
    audioFormat,
    channels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    data: new Uint8Array(buffer, dataOffset, dataSize),
  };
}

async function stitchWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];
  const wavs = await Promise.all(blobs.map(async (blob) => parsePcmWav(await blob.arrayBuffer())));
  const first = wavs[0];

  wavs.forEach((wav) => {
    if (
      wav.channels !== first.channels ||
      wav.sampleRate !== first.sampleRate ||
      wav.bitsPerSample !== first.bitsPerSample ||
      wav.blockAlign !== first.blockAlign
    ) {
      throw new Error("Generated WAV chunks used incompatible audio settings");
    }
  });

  const dataSize = wavs.reduce((total, wav) => total + wav.data.byteLength, 0);
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, first.audioFormat, true);
  view.setUint16(22, first.channels, true);
  view.setUint32(24, first.sampleRate, true);
  view.setUint32(28, first.byteRate, true);
  view.setUint16(32, first.blockAlign, true);
  view.setUint16(34, first.bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const bytes = new Uint8Array(output);
  let cursor = 44;
  wavs.forEach((wav) => {
    bytes.set(wav.data, cursor);
    cursor += wav.data.byteLength;
  });

  return new Blob([output], { type: "audio/wav" });
}

async function readApiError(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json();
    const detail = data?.detail;
    if (detail?.message) return `${res.status}: ${detail.message}`;
    if (typeof detail === "string") return `${res.status}: ${detail}`;
    return `${res.status}: ${JSON.stringify(data)}`;
  }
  return `${res.status}: ${await res.text()}`;
}

export default function Home() {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [clones, setClones] = useState<ClonedVoiceInfo[]>([]);
  const [backendError, setBackendError] = useState("");
  const [backendStatus, setBackendStatus] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("single");
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<SelectedVoice | null>(null);
  const [speed, setSpeed] = useState(1.0);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("wav");
  const [ssmlEnabled, setSsmlEnabled] = useState(false);
  const [pronunciation, setPronunciation] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const historyRef = useRef<HistoryItem[]>([]);

  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [clonePreviewUrl, setClonePreviewUrl] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloneSuccess, setCloneSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentVoiceLabel = useMemo(() => {
    if (!selectedVoice) return "No voice";
    if (selectedVoice.kind === "clone") {
      return clones.find((clone) => clone.id === selectedVoice.id)?.name ?? "Clone";
    }
    return voices.find((voice) => voice.id === selectedVoice.id)?.name ?? selectedVoice.id;
  }, [clones, selectedVoice, voices]);

  const effectiveFormat: OutputFormat =
    selectedVoice?.kind === "clone" ? "wav" : outputFormat;

  const loadClones = useCallback(async () => {
    try {
      const r = await fetch(`${getApiUrl()}/api/voices/clones`);
      if (!r.ok) return;
      const data = await r.json();
      setClones(data.clones ?? []);
    } catch {
      // Voice cloning is optional for installs that only use Kokoro.
    }
  }, []);

  useEffect(() => {
    setBackendError(getInjectedValue("__KURAL_BACKEND_ERROR__"));
    const savedPronunciation = window.localStorage.getItem(PRONUNCIATION_KEY);
    if (savedPronunciation) setPronunciation(savedPronunciation);

    let cancelled = false;
    loadAudioItems(HISTORY_LIMIT)
      .then((items) => {
        const loaded = items.map((item) => ({
          id: item.id,
          text: item.text,
          voiceLabel: item.voiceLabel,
          format: item.format,
          audioUrl: URL.createObjectURL(item.blob),
          createdAt: item.createdAt,
          bytes: item.bytes,
        }));
        if (cancelled) {
          loaded.forEach((item) => URL.revokeObjectURL(item.audioUrl));
          return;
        }
        setHistory((prev) => {
          if (prev.length > 0) {
            loaded.forEach((item) => URL.revokeObjectURL(item.audioUrl));
            return prev;
          }
          return loaded;
        });
      })
      .catch(() => {
        // Persisted history is a convenience; generation works without it.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PRONUNCIATION_KEY, pronunciation);
  }, [pronunciation]);

  useEffect(() => {
    fetch(`${getApiUrl()}/api/health`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data) => setBackendStatus(`${data.status} / ${data.version}`))
      .catch((e) => setBackendStatus(e instanceof Error ? e.message : String(e)));

    fetch(`${getApiUrl()}/api/voices`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data) => {
        const list: VoiceInfo[] = data.voices ?? [];
        setVoices(list);
        if (list.length > 0) setSelectedVoice({ kind: "kokoro", id: list[0].id });
      })
      .catch((e) => setVoicesError(e.message));

    loadClones();
  }, [loadClones]);

  useEffect(() => {
    if (!cloneFile) {
      setClonePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(cloneFile);
    setClonePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cloneFile]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    return () => {
      historyRef.current.forEach((item) => URL.revokeObjectURL(item.audioUrl));
    };
  }, []);

  function onCloneCreated(clone: ClonedVoiceInfo) {
    setClones((prev) => [...prev, clone]);
    setSelectedVoice({ kind: "clone", id: clone.id });
    setCloneSuccess(`Saved "${clone.name}"`);
    setCloneFile(null);
    setCloneName("");
    setCloneConsent(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleVoiceChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val.startsWith("clone:")) {
      setSelectedVoice({ kind: "clone", id: val.slice(6) });
      setOutputFormat("wav");
    } else {
      setSelectedVoice({ kind: "kokoro", id: val });
    }
  }

  function voiceSelectValue(): string {
    if (!selectedVoice) return "";
    return selectedVoice.kind === "clone" ? `clone:${selectedVoice.id}` : selectedVoice.id;
  }

  function addHistory(item: HistoryItem, blob: Blob) {
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, HISTORY_LIMIT);
      prev.slice(HISTORY_LIMIT - 1).forEach((oldItem) => {
        if (!next.some((candidate) => candidate.id === oldItem.id)) {
          URL.revokeObjectURL(oldItem.audioUrl);
        }
      });
      return next;
    });
    const storedItem: StoredAudioItem = {
      id: item.id,
      text: item.text,
      voiceLabel: item.voiceLabel,
      format: item.format,
      createdAt: item.createdAt,
      bytes: item.bytes,
      blob,
    };
    void saveAudioItem(storedItem, HISTORY_LIMIT).catch(() => {
      // The in-memory library remains usable if persistence is unavailable.
    });
  }

  async function requestSynthesis(processedText: string): Promise<Blob> {
    const output = selectedVoice?.kind === "clone" ? "wav" : effectiveFormat;
    const body: Record<string, unknown> = {
      text: processedText,
      format: output,
    };
    if (ssmlEnabled) body.ssml = true;
    if (selectedVoice?.kind === "clone") {
      body.voice_id = selectedVoice.id;
      body.format = "wav";
    } else {
      body.voice = selectedVoice?.id;
      body.speed = speed;
    }

    const res = await fetch(`${getApiUrl()}/api/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readApiError(res));
    return res.blob();
  }

  async function generateOne(
    inputText: string,
    index: number,
    totalItems: number
  ): Promise<HistoryItem> {
    const trimmedText = inputText.trim();
    const processedText = ssmlEnabled
      ? trimmedText
      : applyPronunciation(trimmedText, pronunciation);
    const chunks = ssmlEnabled ? [processedText] : splitLongText(processedText);
    const blobs: Blob[] = [];

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      if (chunks.length > 1) {
        setProgressText(
          totalItems > 1
            ? `Item ${index + 1}: chunk ${chunkIndex + 1} of ${chunks.length}`
            : `Generating chunk ${chunkIndex + 1} of ${chunks.length}`
        );
      }
      blobs.push(await requestSynthesis(chunks[chunkIndex]));
    }

    if (chunks.length > 1) setProgressText("Stitching chunks");
    const blob =
      (selectedVoice?.kind === "clone" ? "wav" : effectiveFormat) === "wav"
        ? await stitchWavBlobs(blobs)
        : new Blob(blobs, { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const item = {
      id: `${Date.now()}-${index}`,
      text: inputText.trim(),
      voiceLabel: currentVoiceLabel,
      format: selectedVoice?.kind === "clone" ? "wav" : effectiveFormat,
      audioUrl: url,
      createdAt: new Date().toISOString(),
      bytes: blob.size,
    } satisfies HistoryItem;
    addHistory(item, blob);
    return item;
  }

  async function handleGenerate() {
    if (!text.trim() || !selectedVoice) return;
    setLoading(true);
    setError(null);
    setProgressText("");
    setAudioUrl(null);

    try {
      const inputs = mode === "batch" ? splitBatchInput(text) : [text.trim()];
      if (inputs.length === 0) return;
      let latest: HistoryItem | null = null;
      for (let i = 0; i < inputs.length; i += 1) {
        setProgressText(
          inputs.length > 1 ? `Generating ${i + 1} of ${inputs.length}` : ""
        );
        latest = await generateOne(inputs[i], i, inputs.length);
      }
      if (latest) {
        setAudioUrl(latest.audioUrl);
        setTimeout(() => audioRef.current?.play(), 50);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setProgressText("");
    }
  }

  function handleDownload(item?: HistoryItem) {
    const target =
      item ?? history.find((candidate) => candidate.audioUrl === audioUrl) ?? history[0];
    if (!target) return;
    const a = document.createElement("a");
    a.href = target.audioUrl;
    const voice = target.voiceLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    a.download = `kural-${voice}-${Date.now()}.${target.format}`;
    a.click();
  }

  function removeHistoryItem(id: string) {
    setHistory((prev) => {
      const item = prev.find((candidate) => candidate.id === id);
      if (item) URL.revokeObjectURL(item.audioUrl);
      return prev.filter((candidate) => candidate.id !== id);
    });
    void deleteAudioItem(id).catch(() => {
      // Best-effort removal from the persisted local library.
    });
    const item = history.find((candidate) => candidate.id === id);
    if (item?.audioUrl === audioUrl) setAudioUrl(null);
  }

  async function handleClone() {
    if (!cloneFile || !cloneName.trim() || !cloneConsent) return;
    setCloning(true);
    setCloneError(null);
    setCloneSuccess(null);

    try {
      const fd = new FormData();
      fd.append("file", cloneFile);
      fd.append("name", cloneName.trim());
      fd.append("consent_confirmed", "true");

      const res = await fetch(`${getApiUrl()}/api/voices/clone`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const clone: ClonedVoiceInfo = await res.json();
      onCloneCreated(clone);
    } catch (e: unknown) {
      setCloneError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  }

  async function handleDeleteClone(id: string, name: string) {
    if (!confirm(`Delete cloned voice "${name}"?`)) return;
    try {
      const res = await fetch(`${getApiUrl()}/api/voices/clones/${id}`, {
        method: "DELETE",
      });
      if (res.ok || res.status === 404) {
        setClones((prev) => prev.filter((c) => c.id !== id));
        if (selectedVoice?.kind === "clone" && selectedVoice.id === id) {
          setSelectedVoice(voices.length > 0 ? { kind: "kokoro", id: voices[0].id } : null);
        }
      }
    } catch {
      // Deleting is best-effort in the local-only UI.
    }
  }

  const hasVoices = voices.length > 0 || clones.length > 0;
  const batchItems = splitBatchInput(text).length;
  const textPlaceholder = ssmlEnabled
    ? 'Hello <break time="300ms"/> world.'
    : mode === "batch"
      ? "Separate each item with a blank line."
      : "Enter text to synthesize.";

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 py-8 px-4">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Kural TTS</h1>
              <p className="mt-1 text-sm text-gray-400">
                Offline speech generation with Kokoro and cloned voices.
              </p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-400">
              API {backendStatus ?? "checking"}
            </div>
          </div>

          {backendError && (
            <div className="rounded-lg border border-amber-700 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
              Desktop backend did not start: {backendError}
            </div>
          )}

          <div className="grid gap-4 rounded-lg border border-gray-800 bg-gray-900/70 p-4">
            <div className="flex flex-wrap gap-2">
              {(["single", "batch"] as Mode[]).map((option) => (
                <button
                  key={option}
                  onClick={() => setMode(option)}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    mode === option
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  {option === "single" ? "Single" : "Batch"}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-medium text-gray-300" htmlFor="text">
                  Text
                </label>
                <label className="inline-flex items-center gap-2 rounded-md border border-gray-800 bg-gray-950 px-3 py-1.5 text-xs font-medium text-gray-300">
                  <input
                    type="checkbox"
                    checked={ssmlEnabled}
                    onChange={(e) => setSsmlEnabled(e.target.checked)}
                    className="accent-indigo-500"
                  />
                  <span>SSML</span>
                </label>
              </div>
              <textarea
                id="text"
                rows={mode === "batch" ? 10 : 7}
                maxLength={10000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={textPlaceholder}
                className="w-full resize-y rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex justify-between text-xs text-gray-600">
                <span>{mode === "batch" ? `${batchItems} item(s)` : "Single item"}</span>
                <span>{text.length} / 10000</span>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300" htmlFor="voice">
                  Voice
                </label>
                {voicesError ? (
                  <p className="text-xs text-red-400">Could not load voices: {voicesError}</p>
                ) : !hasVoices ? (
                  <p className="text-xs text-gray-500">Loading voices</p>
                ) : (
                  <select
                    id="voice"
                    value={voiceSelectValue()}
                    onChange={handleVoiceChange}
                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {voices.length > 0 && (
                      <optgroup label="Kokoro">
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} ({v.language}, {v.gender})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {clones.length > 0 && (
                      <optgroup label="Cloned">
                        {clones.map((c) => (
                          <option key={c.id} value={`clone:${c.id}`}>
                            {c.name} ({c.duration_s.toFixed(1)}s)
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300" htmlFor="speed">
                  {selectedVoice?.kind === "clone" ? "Speed unavailable" : `Speed ${speed.toFixed(1)}x`}
                </label>
                <input
                  id="speed"
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={speed}
                  disabled={selectedVoice?.kind === "clone"}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500 disabled:opacity-30"
                />
                <div className="flex justify-between text-xs text-gray-600">
                  <span>0.5x</span>
                  <span>1.0x</span>
                  <span>2.0x</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300" htmlFor="format">
                  Export
                </label>
                <select
                  id="format"
                  value={effectiveFormat}
                  disabled={selectedVoice?.kind === "clone"}
                  onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40"
                >
                  <option value="wav">WAV</option>
                  <option value="mp3">MP3</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300" htmlFor="pronunciation">
                Pronunciation dictionary
              </label>
              <textarea
                id="pronunciation"
                rows={3}
                value={pronunciation}
                onChange={(e) => setPronunciation(e.target.value)}
                disabled={ssmlEnabled}
                placeholder={
                  ssmlEnabled ? '<sub alias="koo-ral">Kural</sub>' : "Kural=koo-ral"
                }
                className="w-full resize-y rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !text.trim() || !selectedVoice}
              className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500"
            >
              {loading ? progressText || "Generating" : mode === "batch" ? "Generate Batch" : "Generate Audio"}
            </button>

            {error && (
              <div className="rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {audioUrl && (
              <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-950 p-4">
                <audio ref={audioRef} controls src={audioUrl} className="w-full" />
                <button
                  onClick={() => handleDownload()}
                  className="w-full rounded-lg border border-gray-700 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-indigo-500 hover:text-indigo-300"
                >
                  Download Current
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
            <h2 className="text-base font-semibold text-gray-100">Audio Library</h2>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No audio yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {history.map((item) => (
                  <li key={item.id} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <button
                      onClick={() => setAudioUrl(item.audioUrl)}
                      className="block w-full truncate text-left text-sm font-medium text-gray-100 hover:text-indigo-300"
                      title={item.text}
                    >
                      {item.text}
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500">
                      <span>
                        {item.voiceLabel} / {item.format.toUpperCase()} /{" "}
                        {(item.bytes / 1024).toFixed(0)} KB
                      </span>
                      <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleDownload(item)}
                        className="rounded-md border border-gray-700 py-1.5 text-xs text-gray-300 hover:border-indigo-500 hover:text-indigo-300"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => removeHistoryItem(item.id)}
                        className="rounded-md border border-gray-700 py-1.5 text-xs text-gray-300 hover:border-red-500 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
            <h2 className="text-base font-semibold text-gray-100">Clone a Voice</h2>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300" htmlFor="clone-file">
                  Audio sample
                </label>
                <input
                  ref={fileInputRef}
                  id="clone-file"
                  type="file"
                  accept="audio/wav,audio/wave,audio/mp3,audio/mpeg,.wav,.mp3"
                  onChange={(e) => {
                    setCloneFile(e.target.files?.[0] ?? null);
                    setCloneError(null);
                    setCloneSuccess(null);
                  }}
                  className="w-full cursor-pointer text-sm text-gray-400 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-200 hover:file:bg-indigo-800"
                />
                {cloneFile && (
                  <p className="text-xs text-gray-500">
                    {cloneFile.name} ({(cloneFile.size / 1024).toFixed(0)} KB)
                  </p>
                )}
                {clonePreviewUrl && (
                  <audio controls src={clonePreviewUrl} className="w-full" />
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300" htmlFor="clone-name">
                  Voice name
                </label>
                <input
                  id="clone-name"
                  type="text"
                  maxLength={100}
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="My Voice"
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <label className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950 p-3 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={cloneConsent}
                  onChange={(e) => setCloneConsent(e.target.checked)}
                  className="mt-1 accent-indigo-500"
                />
                <span>I have consent to clone and use this voice.</span>
              </label>

              <button
                onClick={handleClone}
                disabled={cloning || !cloneFile || !cloneName.trim() || !cloneConsent}
                className="w-full rounded-lg bg-violet-700 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-600 disabled:bg-gray-700 disabled:text-gray-500"
              >
                {cloning ? "Cloning" : "Clone Voice"}
              </button>

              {cloneError && (
                <div className="rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                  {cloneError}
                </div>
              )}
              {cloneSuccess && (
                <div className="rounded-lg border border-green-700 bg-green-950/40 px-4 py-3 text-sm text-green-300">
                  {cloneSuccess}
                </div>
              )}

              {clones.length > 0 && (
                <ul className="space-y-2">
                  {clones.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-gray-200">
                        {c.name}
                        <span className="ml-2 text-xs text-gray-500">
                          {c.duration_s.toFixed(1)}s
                        </span>
                      </span>
                      <button
                        onClick={() => handleDeleteClone(c.id, c.name)}
                        className="shrink-0 text-xs text-gray-500 transition-colors hover:text-red-300"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
