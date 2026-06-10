import type { ChangeEvent, ReactNode } from "react";

import { formatTime } from "../lib/dubbing";
import type { VoiceOption } from "../lib/types";
import type { AudioAsset, DubbingSegment } from "../lib/workspace";

export function DubbingTimeline(props: {
  segments: DubbingSegment[];
  assets: AudioAsset[];
  audioUrls: Record<string, string>;
  assetDurations: Record<string, number>;
  voiceOptions: VoiceOption[];
  selectedVoiceKey: string;
  isTranscribing: boolean;
  isTranslating: boolean;
  localModelPanel: ReactNode;
  onImportTranscript: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportMedia: (event: ChangeEvent<HTMLInputElement>) => void;
  onTranslateAll: () => void;
  onTranslateSegment: (segment: DubbingSegment) => void;
  onRenderSegment: (segment: DubbingSegment) => void;
  onRenderAll: () => void;
  onRetryFailed: () => void;
  onAlignSegment: (segment: DubbingSegment) => void;
  onExportTimeline: () => void;
  onExportTranscript: (format: "srt" | "vtt" | "csv") => void;
  onUpdateSegment: (segmentId: string, fields: Partial<DubbingSegment>) => void;
}) {
  const maxEnd = Math.max(1, ...props.segments.map((segment) => segment.endMs));
  const readyCount = props.segments.filter((segment) => segment.status === "ready").length;
  const overrunCount = props.segments.filter((segment) => {
    const aligned = segment.alignment?.overrunMs || 0;
    if (aligned > 0) return true;
    if (!segment.audioAssetId) return false;
    const duration = props.assetDurations[segment.audioAssetId] || 0;
    return duration > segment.endMs - segment.startMs;
  }).length;
  const failedCount = props.segments.filter((segment) => segment.status === "error").length;
  const speakers = Array.from(
    new Set(props.segments.map((segment) => segment.speaker || "Speaker 1"))
  );

  return (
    <section className="space-y-4" aria-labelledby="dubbing-timeline-heading">
      <div className="rounded border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Transcript to voice</p>
            <h2 id="dubbing-timeline-heading" className="text-lg font-semibold">
              Dubbing Timeline
            </h2>
          </div>
          <span className="rounded border border-slate-200 px-3 py-1 text-sm" aria-live="polite">
            {readyCount}/{props.segments.length} rendered
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded border border-slate-300 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-slate-400">
            Import SRT/VTT/CSV/Text
            <input
              className="hidden"
              type="file"
              accept=".srt,.vtt,.csv,.txt"
              onChange={props.onImportTranscript}
            />
          </label>
          <label className="cursor-pointer rounded border border-slate-300 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-slate-400">
            Import Audio/Video
            <input
              className="hidden"
              type="file"
              accept="audio/*,video/mp4,video/quicktime"
              onChange={props.onImportMedia}
            />
          </label>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
            disabled={props.isTranslating || props.segments.length === 0}
            onClick={props.onTranslateAll}
            aria-busy={props.isTranslating}
          >
            {props.isTranslating ? "Translating..." : "Translate All"}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
            disabled={props.segments.length === 0}
            onClick={props.onRenderAll}
          >
            Render All
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
            disabled={failedCount === 0}
            onClick={props.onRetryFailed}
          >
            Retry Failed
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            onClick={props.onExportTimeline}
          >
            Export WAV Timeline
          </button>
          {(["srt", "vtt", "csv"] as const).map((format) => (
            <button
              type="button"
              key={format}
              className="rounded border border-slate-300 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
              disabled={props.segments.length === 0}
              onClick={() => props.onExportTranscript(format)}
            >
              {format}
            </button>
          ))}
          <span className="text-sm text-slate-500" role="status" aria-live="polite">
            {props.isTranscribing
              ? "Transcribing..."
              : `${props.segments.length} transcript segments`}
            {overrunCount ? ` / ${overrunCount} overrun` : ""}
          </span>
        </div>
      </div>

      {props.segments.length > 0 && (
        <section className="rounded border border-slate-300 bg-white p-4" aria-label="Timeline overview">
          <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-600">
            {speakers.map((speaker) => (
              <span key={speaker} className="rounded border border-slate-200 px-2 py-1">
                {speaker}
              </span>
            ))}
          </div>
          <div className="relative h-24 rounded border border-slate-200 bg-slate-50">
            {props.segments.map((segment, index) => {
              const left = Math.max(0, (segment.startMs / maxEnd) * 100);
              const width = Math.max(2, ((segment.endMs - segment.startMs) / maxEnd) * 100);
              const asset = segment.audioAssetId
                ? props.assets.find((candidate) => candidate.id === segment.audioAssetId)
                : undefined;
              const duration = segment.audioAssetId
                ? props.assetDurations[segment.audioAssetId] || 0
                : 0;
              const overrun =
                (segment.alignment?.overrunMs || 0) > 0 ||
                (duration > 0 && duration > segment.endMs - segment.startMs);
              return (
                <button
                  type="button"
                  key={segment.id}
                  className={`absolute top-3 h-16 rounded border px-2 text-left text-xs focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                    overrun
                      ? "border-red-300 bg-red-50 text-red-800"
                      : asset
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : "border-slate-300 bg-white text-slate-700"
                  }`}
                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                  aria-label={`Timeline segment ${index + 1}`}
                >
                  <span className="block truncate font-medium">{index + 1}</span>
                  <span className="block truncate">{segment.speaker || "Speaker 1"}</span>
                  <span className="block truncate">{formatTime(segment.startMs)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {props.localModelPanel}

      <div className="space-y-3">
        {props.segments.map((segment, index) => {
          const asset = props.assets.find((candidate) => candidate.id === segment.audioAssetId);
          const duration = segment.audioAssetId ? props.assetDurations[segment.audioAssetId] || 0 : 0;
          const limit = segment.endMs - segment.startMs;
          const alignedOverrun = segment.alignment?.overrunMs || 0;
          const overrun = alignedOverrun > 0 || (duration > 0 && duration > limit);
          return (
            <section
              key={segment.id}
              className="rounded border border-slate-300 bg-white p-3"
              aria-label={`Segment ${index + 1}`}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium">
                    Segment {index + 1} - {formatTime(segment.startMs)}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {segment.speaker || "Speaker 1"} / Slot {formatTime(limit)}{" "}
                    {overrun
                      ? `/ overrun by ${formatTime(Math.max(alignedOverrun, duration - limit))}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                    disabled={props.isTranslating}
                    onClick={() => props.onTranslateSegment(segment)}
                  >
                    Translate
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                    disabled={!asset}
                    onClick={() => props.onAlignSegment(segment)}
                  >
                    Align
                  </button>
                  <button
                    type="button"
                    className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                    disabled={segment.status === "rendering"}
                    onClick={() => props.onRenderSegment(segment)}
                    aria-busy={segment.status === "rendering"}
                  >
                    {segment.status === "rendering" ? "Rendering..." : "Render Segment"}
                  </button>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <label className="text-sm">
                  Source text
                  <textarea
                    className="mt-1 min-h-28 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    value={segment.sourceText}
                    onChange={(event) =>
                      props.onUpdateSegment(segment.id, { sourceText: event.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Target text
                  <textarea
                    className="mt-1 min-h-28 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    value={segment.targetText}
                    onChange={(event) =>
                      props.onUpdateSegment(segment.id, { targetText: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-5">
                <input
                  className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  value={segment.speaker || "Speaker 1"}
                  onChange={(event) =>
                    props.onUpdateSegment(segment.id, { speaker: event.target.value || "Speaker 1" })
                  }
                  placeholder="Speaker"
                  aria-label={`Speaker for segment ${index + 1}`}
                />
                <label className="sr-only" htmlFor={`segment-voice-${segment.id}`}>
                  Voice for segment {index + 1}
                </label>
                <select
                  id={`segment-voice-${segment.id}`}
                  className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  value={segment.voiceId || props.selectedVoiceKey}
                  onChange={(event) =>
                    props.onUpdateSegment(segment.id, { voiceId: event.target.value })
                  }
                >
                  {props.voiceOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  type="number"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={segment.controls.speed}
                  aria-label={`Speed for segment ${index + 1}`}
                  onChange={(event) =>
                    props.onUpdateSegment(segment.id, {
                      controls: { ...segment.controls, speed: Number(event.target.value) },
                    })
                  }
                />
                <input
                  className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  value={segment.notes}
                  onChange={(event) =>
                    props.onUpdateSegment(segment.id, { notes: event.target.value })
                  }
                  placeholder="Notes"
                  aria-label={`Notes for segment ${index + 1}`}
                />
                <span className="rounded border border-slate-200 px-3 py-2 text-sm" aria-live="polite">
                  {segment.status}
                </span>
              </div>
              {segment.alignment && (
                <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>
                      Alignment: {segment.alignment.provider} /{" "}
                      {formatTime(segment.alignment.durationMs)}
                    </span>
                    <span>
                      {segment.alignment.overrunMs > 0
                        ? `Overrun ${formatTime(segment.alignment.overrunMs)}`
                        : "On time"}
                    </span>
                  </div>
                  {segment.alignment.words.length > 0 && (
                    <p className="mt-2 line-clamp-2">
                      {segment.alignment.words.slice(0, 12).map((word) => word.text).join(" ")}
                    </p>
                  )}
                </div>
              )}
              {asset && props.audioUrls[asset.id] && (
                <audio
                  className="mt-3 w-full"
                  controls
                  src={props.audioUrls[asset.id]}
                  aria-label={`Rendered audio for segment ${index + 1}`}
                />
              )}
              {segment.error && (
                <p className="mt-2 text-sm text-red-700" role="alert">
                  {segment.error}
                </p>
              )}
            </section>
          );
        })}
        {props.segments.length === 0 && (
          <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Import a transcript file to start a local dubbing workflow.
          </p>
        )}
      </div>
    </section>
  );
}
