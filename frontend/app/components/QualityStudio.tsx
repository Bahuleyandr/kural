import { useEffect, useMemo, useState } from "react";

import type { PerformanceStyle } from "../lib/performanceStyles";
import { applyPerformanceStyle } from "../lib/performanceStyles";
import type { VoiceOption } from "../lib/types";
import type { AudioControls, OutputFormat } from "../lib/workspace";

export interface QualityRenderRequest {
  text: string;
  voiceKey: string;
  styleId: string;
  controls: AudioControls;
}

export interface QualityResult {
  id: string;
  label: string;
  styleId: string;
  voiceKey: string;
  voiceLabel: string;
  controls: AudioControls;
  blob: Blob;
  format: OutputFormat;
  bytes: number;
}

interface AudioAnalysis {
  duration: number;
  peak: number;
  rms: number;
  bars: number[];
}

interface NaturalnessCoach {
  score: number;
  tips: string[];
}

async function analyzeAudio(blob: Blob): Promise<AudioAnalysis> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channel = buffer.getChannelData(0);
    let peak = 0;
    let sum = 0;
    const bars: number[] = [];
    const step = Math.max(1, Math.floor(channel.length / 48));
    for (let i = 0; i < channel.length; i += 1) {
      const value = Math.abs(channel[i]);
      peak = Math.max(peak, value);
      sum += value * value;
    }
    for (let i = 0; i < channel.length; i += step) {
      let localPeak = 0;
      for (let j = i; j < Math.min(channel.length, i + step); j += 1) {
        localPeak = Math.max(localPeak, Math.abs(channel[j]));
      }
      bars.push(localPeak);
    }
    return {
      duration: buffer.duration,
      peak,
      rms: Math.sqrt(sum / Math.max(1, channel.length)),
      bars,
    };
  } finally {
    await context.close();
  }
}

function WaveformPreview({ analysis }: { analysis?: AudioAnalysis }) {
  const bars = analysis?.bars?.length ? analysis.bars : Array.from({ length: 48 }, () => 0.08);
  const max = Math.max(0.01, ...bars);
  return (
    <div className="mt-3 flex h-16 items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2">
      {bars.map((bar, index) => (
        <span
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          className="w-full rounded bg-emerald-600"
          style={{ height: `${Math.max(8, (bar / max) * 56)}px` }}
        />
      ))}
    </div>
  );
}

function naturalnessCoach(
  text: string,
  controls: AudioControls,
  analysis?: AudioAnalysis
): NaturalnessCoach {
  const tips: string[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentenceCount = Math.max(1, (text.match(/[.!?]/g) || []).length);
  const avgWords = words.length / sentenceCount;
  const commaCount = (text.match(/,/g) || []).length;
  let score = 100;

  if (avgWords > 28) {
    score -= 12;
    tips.push("Split longer sentences so the model gets more natural breath points.");
  }
  if (commaCount === 0 && words.length > 35) {
    score -= 8;
    tips.push("Add commas or short pauses for pacing.");
  }
  if (/[A-Z]{8,}/.test(text)) {
    score -= 8;
    tips.push("Avoid long all-caps words unless the read should sound shouted.");
  }
  if (controls.speed > 1.18) {
    score -= 8;
    tips.push("Try a slower speed for a less mechanical delivery.");
  }
  if (controls.pauseScale < 0.8) {
    score -= 7;
    tips.push("Increase pause scale to give phrases more room.");
  }
  if (Math.abs(controls.pitchSemitones) > 3) {
    score -= 6;
    tips.push("Keep pitch shifts subtle for the most natural voice timbre.");
  }
  if (analysis?.peak && analysis.peak > 0.96) {
    score -= 10;
    tips.push("Peak level is close to clipping; lower volume or enable normalization.");
  }
  if (analysis?.rms && analysis.rms < 0.035) {
    score -= 5;
    tips.push("The sample is quiet; add a little gain or normalize before export.");
  }
  if (tips.length === 0) {
    tips.push("Good pacing and level balance. Use A/B notes to choose the most human take.");
  }

  return { score: Math.max(0, Math.min(100, score)), tips };
}

export function QualityStudio(props: {
  defaultText: string;
  selectedVoiceKey: string;
  voiceOptions: VoiceOption[];
  controls: AudioControls;
  performanceStyles: PerformanceStyle[];
  onRenderSample: (request: QualityRenderRequest) => Promise<QualityResult>;
  onUseSample: (result: QualityResult) => void;
}) {
  const [text, setText] = useState(
    props.defaultText.trim() || "Kural should sound natural, steady, and easy to listen to."
  );
  const [voiceKey, setVoiceKey] = useState(props.selectedVoiceKey);
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>([
    "neutral",
    "natural",
    "conversational",
    "warm_narration",
  ]);
  const [busyStyleId, setBusyStyleId] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<QualityResult[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [analysis, setAnalysis] = useState<Record<string, AudioAnalysis>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [blindMode, setBlindMode] = useState(false);
  const [winnerId, setWinnerId] = useState("");

  useEffect(() => {
    if (!voiceKey && props.selectedVoiceKey) setVoiceKey(props.selectedVoiceKey);
  }, [props.selectedVoiceKey, voiceKey]);

  useEffect(() => {
    const nextUrls: Record<string, string> = {};
    results.forEach((result) => {
      nextUrls[result.id] = URL.createObjectURL(result.blob);
    });
    setUrls(nextUrls);
    return () => Object.values(nextUrls).forEach((url) => URL.revokeObjectURL(url));
  }, [results]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const entries = await Promise.all(
        results.map(async (result) => {
          try {
            return [result.id, await analyzeAudio(result.blob)] as const;
          } catch {
            return [result.id, undefined] as const;
          }
        })
      );
      if (!cancelled) {
        const next: Record<string, AudioAnalysis> = {};
        entries.forEach(([id, value]) => {
          if (value) next[id] = value;
        });
        setAnalysis(next);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [results]);

  const selectedVoice = useMemo(
    () => props.voiceOptions.find((option) => option.key === voiceKey),
    [props.voiceOptions, voiceKey]
  );
  const liveCoach = useMemo(
    () => naturalnessCoach(text, props.controls),
    [text, props.controls]
  );
  const blindLabels = useMemo(() => {
    const labels = ["A", "B", "C", "D", "E", "F"];
    return Object.fromEntries(results.map((result, index) => [result.id, labels[index] || `${index + 1}`]));
  }, [results]);

  async function renderStyle(style: PerformanceStyle) {
    if (!text.trim()) {
      setError("Enter comparison text first.");
      return;
    }
    if (!voiceKey) {
      setError("Choose a voice before rendering a comparison.");
      return;
    }
    setBusyStyleId(style.id);
    setError("");
    try {
      const result = await props.onRenderSample({
        text: text.trim(),
        voiceKey,
        styleId: style.id,
        controls: applyPerformanceStyle(props.controls, style.id),
      });
      setResults((current) => [result, ...current.filter((item) => item.id !== result.id)]);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not render comparison sample.");
    } finally {
      setBusyStyleId("");
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="quality-studio-heading">
      <div className="rounded border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">A/B testing</p>
            <h2 id="quality-studio-heading" className="text-lg font-semibold">
              Voice Quality Studio
            </h2>
          </div>
          <span className="rounded border border-slate-200 px-3 py-1 text-sm">
            {results.length} sample{results.length === 1 ? "" : "s"}
          </span>
          <label className="flex items-center gap-2 rounded border border-slate-200 px-3 py-1 text-sm">
            <input
              type="checkbox"
              checked={blindMode}
              onChange={(event) => {
                setBlindMode(event.target.checked);
                setWinnerId("");
              }}
            />
            Blind compare
          </label>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <label className="text-sm font-medium">
            Comparison script
            <textarea
              className="mt-2 min-h-36 w-full resize-y rounded border border-slate-300 px-3 py-3 font-mono text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Voice
              <select
                className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                value={voiceKey}
                onChange={(event) => setVoiceKey(event.target.value)}
              >
                {props.voiceOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              Current voice: {selectedVoice?.shortLabel || "none selected"}
            </p>
          </div>
        </div>
      </div>

      <section className="rounded border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Comparison set</h3>
            <p className="mt-1 text-sm text-slate-600">
              Naturalness score {liveCoach.score}/100 before rendering.
            </p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Mastering targets: normalize voiceover, keep peaks below 96%, leave room-tone pauses.
          </div>
        </div>
        <ul className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
          {liveCoach.tips.slice(0, 4).map((tip) => (
            <li key={tip} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
              {tip}
            </li>
          ))}
        </ul>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {props.performanceStyles.map((style) => (
            <label key={style.id} className="flex items-start gap-2 rounded border border-slate-200 p-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={selectedStyleIds.includes(style.id)}
                onChange={(event) =>
                  setSelectedStyleIds((current) =>
                    event.target.checked
                      ? [...current, style.id]
                      : current.filter((id) => id !== style.id)
                  )
                }
              />
              <span>
                <span className="block font-medium">{style.label}</span>
                <span className="block text-xs text-slate-500">{style.description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {props.performanceStyles
            .filter((style) => selectedStyleIds.includes(style.id))
            .map((style) => (
              <button
                type="button"
                key={style.id}
                className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                disabled={Boolean(busyStyleId)}
                onClick={() => void renderStyle(style)}
              >
                {busyStyleId === style.id ? "Rendering..." : `Render ${style.label}`}
              </button>
            ))}
        </div>
        {error && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="rounded border border-slate-300 bg-white p-4">
        <h3 className="font-semibold">Rendered samples</h3>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          {results.map((result) => (
            <article key={result.id} className="rounded border border-slate-200 p-3">
              {(() => {
                const coach = naturalnessCoach(text, result.controls, analysis[result.id]);
                return (
                  <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-800">Naturalness {coach.score}/100</span>
                    <span className="ml-2">{coach.tips[0]}</span>
                  </div>
                );
              })()}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="font-medium">
                    {blindMode ? `Take ${blindLabels[result.id]}` : result.label}
                    {winnerId === result.id ? " / winner" : ""}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {blindMode ? "Hidden style" : result.voiceLabel} / {result.format.toUpperCase()} /{" "}
                    {(result.bytes / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  onClick={() => props.onUseSample(result)}
                >
                  Use Settings
                </button>
                <button
                  type="button"
                  className={`rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                    winnerId === result.id
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-slate-300"
                  }`}
                  aria-pressed={winnerId === result.id}
                  onClick={() => {
                    setWinnerId(result.id);
                    props.onUseSample(result);
                  }}
                >
                  Pick Winner
                </button>
                <button
                  type="button"
                  className={`rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                    favorites[result.id]
                      ? "border-amber-300 bg-amber-50 text-amber-800"
                      : "border-slate-300"
                  }`}
                  aria-pressed={Boolean(favorites[result.id])}
                  onClick={() =>
                    setFavorites((current) => ({
                      ...current,
                      [result.id]: !current[result.id],
                    }))
                  }
                >
                  Favorite
                </button>
              </div>
              {urls[result.id] && (
                <audio className="mt-3 w-full" controls src={urls[result.id]} />
              )}
              <WaveformPreview analysis={analysis[result.id]} />
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                <div>
                  <dt>Speed</dt>
                  <dd>{result.controls.speed.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Pitch</dt>
                  <dd>{result.controls.pitchSemitones.toFixed(1)} st</dd>
                </div>
                <div>
                  <dt>Pauses</dt>
                  <dd>{result.controls.pauseScale.toFixed(2)}x</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{analysis[result.id]?.duration.toFixed(2) || "-"}s</dd>
                </div>
                <div>
                  <dt>Peak</dt>
                  <dd>{analysis[result.id] ? `${Math.round(analysis[result.id].peak * 100)}%` : "-"}</dd>
                </div>
                <div>
                  <dt>Noise/RMS</dt>
                  <dd>{analysis[result.id] ? `${Math.round(analysis[result.id].rms * 100)}%` : "-"}</dd>
                </div>
              </dl>
              <label className="mt-3 block text-xs font-medium text-slate-600">
                Notes
                <textarea
                  className="mt-1 min-h-16 w-full rounded border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  value={notes[result.id] || ""}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [result.id]: event.target.value }))
                  }
                  placeholder="What sounds best or needs another pass?"
                />
              </label>
            </article>
          ))}
          {results.length === 0 && (
            <p className="rounded border border-slate-200 p-4 text-sm text-slate-500">
              Render a few styles to compare voice, pacing, loudness, and pauses side by side.
            </p>
          )}
        </div>
      </section>
    </section>
  );
}
