import type { AudioControls, PronunciationRule } from "./workspace";
import type { VoiceKind } from "./types";

export const SYNTH_CHUNK_LIMIT = 3200;

export function splitBatchInput(value: string): string[] {
  return value
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function splitLongText(value: string, limit = SYNTH_CHUNK_LIMIT): string[] {
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

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyPronunciationPreview(
  text: string,
  rules: PronunciationRule[],
  language: string
): string {
  return [...rules]
    .filter((rule) => rule.enabled && rule.pattern.trim() && rule.replacement.trim())
    .sort((a, b) => b.priority - a.priority)
    .reduce((current, rule) => {
      if (rule.language && language && rule.language.toLowerCase() !== language.toLowerCase()) {
        return current;
      }
      const flags = rule.caseSensitive ? "g" : "gi";
      const pattern =
        rule.mode === "word"
          ? new RegExp(`(?<!\\w)${escapeRegExp(rule.pattern)}(?!\\w)`, flags)
          : new RegExp(escapeRegExp(rule.pattern), flags);
      return current.replace(pattern, rule.replacement);
    }, text);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function parseVoiceKey(key: string): { kind: VoiceKind; id: string } {
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":") || key;
  if (kind === "clone") return { kind: "clone", id };
  if (kind === "supertonic") return { kind: "supertonic", id };
  return { kind: "kokoro", id };
}

export function toApiControls(controls: AudioControls) {
  return {
    speed: controls.speed,
    pitch_semitones: controls.pitchSemitones,
    volume_db: controls.volumeDb,
    normalize: controls.normalize,
    trim_silence: controls.trimSilence,
    pause_scale: controls.pauseScale,
  };
}

export function toApiRules(rules: PronunciationRule[]) {
  return rules.map((rule) => ({
    id: rule.id,
    pattern: rule.pattern,
    replacement: rule.replacement,
    mode: rule.mode,
    case_sensitive: rule.caseSensitive,
    language: rule.language || undefined,
    enabled: rule.enabled,
    priority: rule.priority,
  }));
}

export function measureBlobDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(blob);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}
