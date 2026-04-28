"use client";

import { useEffect, useRef, useState } from "react";

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

export default function Home() {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("");
  const [speed, setSpeed] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    fetch(`${getApiUrl()}/api/voices`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data) => {
        const list: VoiceInfo[] = data.voices ?? [];
        setVoices(list);
        if (list.length > 0) setVoice(list[0].id);
      })
      .catch((e) => setVoicesError(e.message));
  }, []);

  async function handleGenerate() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    try {
      const res = await fetch(`${getApiUrl()}/api/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), voice, speed, format: "wav" }),
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
    a.download = `kural-${voice}-${Date.now()}.wav`;
    a.click();
  }

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
            ) : voices.length === 0 ? (
              <p className="text-gray-500 text-xs">Loading voices…</p>
            ) : (
              <select
                id="voice"
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              >
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.language}, {v.gender})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Speed slider */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300" htmlFor="speed">
              Speed — {speed.toFixed(1)}×
            </label>
            <input
              id="speed"
              type="range"
              min={0.5}
              max={2.0}
              step={0.1}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
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
          disabled={loading || !text.trim() || !voice}
          className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          {loading ? "Generating…" : "Generate Audio"}
        </button>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-900/40 border border-red-700 px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Audio player + download */}
        {audioUrl && (
          <div className="space-y-3 rounded-lg bg-gray-900 border border-gray-700 p-4">
            <audio
              ref={audioRef}
              controls
              src={audioUrl}
              className="w-full"
            />
            <button
              onClick={handleDownload}
              className="w-full py-2 rounded-lg border border-gray-600 hover:border-indigo-500 hover:text-indigo-400 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              Download WAV
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
