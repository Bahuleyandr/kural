"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// In the Tauri desktop build, Tauri injects window.__KURAL_API_URL__ via
// initialization_script before any page JS runs, so the webview always has
// the correct dynamic backend port without baking a URL into the static build.
function getApiUrl(): string {
  if (typeof window !== "undefined") {
    const injected = (window as unknown as Record<string, unknown>).__KURAL_API_URL__;
    if (typeof injected === "string" && injected.length > 0) return injected;
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
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
}

type SelectedVoice =
  | { kind: "kokoro"; id: string }
  | { kind: "clone"; id: string };

export default function Home() {
  // --- Kokoro voices ---
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voicesError, setVoicesError] = useState<string | null>(null);

  // --- Cloned voices ---
  const [clones, setClones] = useState<ClonedVoiceInfo[]>([]);

  // --- Synthesis ---
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<SelectedVoice | null>(null);
  const [speed, setSpeed] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // --- Clone panel ---
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloneSuccess, setCloneSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadClones = useCallback(async () => {
    try {
      const r = await fetch(`${getApiUrl()}/api/voices/clones`);
      if (!r.ok) return;
      const data = await r.json();
      setClones(data.clones ?? []);
    } catch {
      // clones are optional — ignore failures
    }
  }, []);

  useEffect(() => {
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

  function onCloneCreated(clone: ClonedVoiceInfo) {
    setClones((prev) => [...prev, clone]);
    setSelectedVoice({ kind: "clone", id: clone.id });
    setCloneSuccess(`Voice "${clone.name}" cloned! Select it in the Voice picker above.`);
    setCloneFile(null);
    setCloneName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleVoiceChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val.startsWith("clone:")) {
      setSelectedVoice({ kind: "clone", id: val.slice(6) });
    } else {
      setSelectedVoice({ kind: "kokoro", id: val });
    }
  }

  function voiceSelectValue(): string {
    if (!selectedVoice) return "";
    return selectedVoice.kind === "clone"
      ? `clone:${selectedVoice.id}`
      : selectedVoice.id;
  }

  async function handleGenerate() {
    if (!text.trim() || !selectedVoice) return;
    setLoading(true);
    setError(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    try {
      const body: Record<string, unknown> = { text: text.trim(), format: "wav" };
      if (selectedVoice.kind === "clone") {
        body.voice_id = selectedVoice.id;
      } else {
        body.voice = selectedVoice.id;
        body.speed = speed;
      }

      const res = await fetch(`${getApiUrl()}/api/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`${res.status}: ${detail}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setTimeout(() => audioRef.current?.play(), 50);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    const label =
      selectedVoice?.kind === "clone"
        ? selectedVoice.id.slice(0, 8)
        : (selectedVoice?.id ?? "voice");
    a.download = `kural-${label}-${Date.now()}.wav`;
    a.click();
  }

  async function handleClone() {
    if (!cloneFile || !cloneName.trim()) return;
    setCloning(true);
    setCloneError(null);
    setCloneSuccess(null);

    try {
      const fd = new FormData();
      fd.append("file", cloneFile);
      fd.append("name", cloneName.trim());

      const res = await fetch(`${getApiUrl()}/api/voices/clone`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`${res.status}: ${detail}`);
      }
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
          setSelectedVoice(
            voices.length > 0 ? { kind: "kokoro", id: voices[0].id } : null
          );
        }
      }
    } catch {
      // ignore
    }
  }

  const hasVoices = voices.length > 0 || clones.length > 0;

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center py-16 px-4">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kural TTS</h1>
          <p className="mt-1 text-gray-400 text-sm">
            Privacy-first text-to-speech. Runs 100% offline.
          </p>
        </div>

        {/* Text input */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300" htmlFor="text">
            Text
          </label>
          <textarea
            id="text"
            rows={6}
            maxLength={10000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter text to synthesize…"
            className="w-full rounded-lg bg-gray-900 border border-gray-700 px-4 py-3 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y text-sm"
          />
          <p className="text-xs text-gray-600 text-right">{text.length} / 10 000</p>
        </div>

        {/* Voice + speed row */}
        <div className="grid grid-cols-2 gap-6">
          {/* Voice picker */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300" htmlFor="voice">
              Voice
            </label>
            {voicesError ? (
              <p className="text-red-400 text-xs">Could not load voices: {voicesError}</p>
            ) : !hasVoices ? (
              <p className="text-gray-500 text-xs">Loading voices…</p>
            ) : (
              <select
                id="voice"
                value={voiceSelectValue()}
                onChange={handleVoiceChange}
                className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              >
                {voices.length > 0 && (
                  <optgroup label="Kokoro Voices">
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.language}, {v.gender})
                      </option>
                    ))}
                  </optgroup>
                )}
                {clones.length > 0 && (
                  <optgroup label="My Cloned Voices">
                    {clones.map((c) => (
                      <option key={c.id} value={`clone:${c.id}`}>
                        {c.name} ({c.duration_s.toFixed(1)}s sample)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </div>

          {/* Speed slider */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300" htmlFor="speed">
              {selectedVoice?.kind === "clone"
                ? "Speed — n/a for cloned voice"
                : `Speed — ${speed.toFixed(1)}×`}
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
              <span>0.5×</span>
              <span>1.0×</span>
              <span>2.0×</span>
            </div>
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={loading || !text.trim() || !selectedVoice}
          className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          {loading ? "Generating…" : "Generate Audio"}
        </button>

        {/* Synthesis error */}
        {error && (
          <div className="rounded-lg bg-red-900/40 border border-red-700 px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Audio player + download */}
        {audioUrl && (
          <div className="space-y-3 rounded-lg bg-gray-900 border border-gray-700 p-4">
            <audio ref={audioRef} controls src={audioUrl} className="w-full" />
            <button
              onClick={handleDownload}
              className="w-full py-2 rounded-lg border border-gray-600 hover:border-indigo-500 hover:text-indigo-400 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              Download WAV
            </button>
          </div>
        )}

        {/* ── Clone a Voice panel ── */}
        <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-gray-100">Clone a Voice</h2>
            <p className="mt-1 text-xs text-gray-500">
              Upload a 6–30 s WAV or MP3 sample. The voice embedding is saved locally — no
              cloud, no uploads.
            </p>
          </div>

          {/* File picker */}
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
              className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-900 file:text-indigo-300 hover:file:bg-indigo-800 cursor-pointer"
            />
            {cloneFile && (
              <p className="text-xs text-gray-500">
                {cloneFile.name} ({(cloneFile.size / 1024).toFixed(0)} KB)
              </p>
            )}
          </div>

          {/* Voice name */}
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
              placeholder="e.g. My Voice"
              className="w-full rounded-lg bg-gray-900 border border-gray-700 px-4 py-2 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>

          {/* Clone button */}
          <button
            onClick={handleClone}
            disabled={cloning || !cloneFile || !cloneName.trim()}
            className="w-full py-2.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:bg-gray-700 disabled:text-gray-500 font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {cloning ? "Cloning… (this takes a few seconds)" : "Clone Voice"}
          </button>

          {/* Clone feedback */}
          {cloneError && (
            <div className="rounded-lg bg-red-900/40 border border-red-700 px-4 py-3 text-red-300 text-sm">
              {cloneError}
            </div>
          )}
          {cloneSuccess && (
            <div className="rounded-lg bg-green-900/40 border border-green-700 px-4 py-3 text-green-300 text-sm">
              {cloneSuccess}
            </div>
          )}

          {/* Saved clones list */}
          {clones.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Saved clones
              </p>
              <ul className="space-y-1">
                {clones.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm"
                  >
                    <span className="text-gray-200">
                      {c.name}
                      <span className="ml-2 text-xs text-gray-500">
                        {c.duration_s.toFixed(1)}s
                      </span>
                    </span>
                    <button
                      onClick={() => handleDeleteClone(c.id, c.name)}
                      className="text-gray-600 hover:text-red-400 text-xs transition-colors"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
