import type { AudioControls } from "./workspace";

export type PerformanceStyleId =
  | "neutral"
  | "natural"
  | "conversational"
  | "warm_narration"
  | "podcast"
  | "calm"
  | "excited"
  | "angry"
  | "romantic"
  | "dramatic"
  | "documentary"
  | "advertisement"
  | "tutorial"
  | "audiobook";

type ControlTuning = Partial<Omit<AudioControls, "format">>;

interface TextTuning {
  expandTokens: boolean;
  sentenceBreakMs?: number;
  commaBreakMs?: number;
}

export interface PerformanceStyle {
  id: PerformanceStyleId;
  label: string;
  description: string;
  controls: ControlTuning;
  text: TextTuning;
}

export const PERFORMANCE_STYLES: PerformanceStyle[] = [
  {
    id: "neutral",
    label: "Neutral",
    description: "Default delivery with cleanup only.",
    controls: {
      speed: 1,
      pitchSemitones: 0,
      volumeDb: 0,
      normalize: true,
      trimSilence: false,
      pauseScale: 1,
    },
    text: { expandTokens: true },
  },
  {
    id: "natural",
    label: "Natural",
    description: "Softer pacing for everyday narration.",
    controls: {
      speed: 0.94,
      pitchSemitones: -0.5,
      volumeDb: 0,
      normalize: true,
      trimSilence: false,
      pauseScale: 1.18,
    },
    text: { expandTokens: true, sentenceBreakMs: 260, commaBreakMs: 90 },
  },
  {
    id: "conversational",
    label: "Conversational",
    description: "Relaxed and close to spoken cadence.",
    controls: {
      speed: 0.96,
      pitchSemitones: -0.5,
      volumeDb: 0,
      normalize: true,
      trimSilence: false,
      pauseScale: 1.14,
    },
    text: { expandTokens: true, sentenceBreakMs: 220, commaBreakMs: 75 },
  },
  {
    id: "warm_narration",
    label: "Warm Narration",
    description: "Measured, gentle audiobook-style delivery.",
    controls: {
      speed: 0.9,
      pitchSemitones: -1,
      volumeDb: -0.5,
      normalize: true,
      trimSilence: false,
      pauseScale: 1.28,
    },
    text: { expandTokens: true, sentenceBreakMs: 340, commaBreakMs: 120 },
  },
  {
    id: "podcast",
    label: "Podcast",
    description: "Clean and slightly tighter spoken-word pace.",
    controls: {
      speed: 0.98,
      pitchSemitones: -0.5,
      volumeDb: 1,
      normalize: true,
      trimSilence: true,
      pauseScale: 1.06,
    },
    text: { expandTokens: true, sentenceBreakMs: 210, commaBreakMs: 70 },
  },
  {
    id: "calm",
    label: "Calm",
    description: "Slower, steadier, and less sharp.",
    controls: {
      speed: 0.86,
      pitchSemitones: -1.5,
      volumeDb: -1,
      normalize: true,
      trimSilence: false,
      pauseScale: 1.42,
    },
    text: { expandTokens: true, sentenceBreakMs: 420, commaBreakMs: 145 },
  },
  {
    id: "excited",
    label: "Excited",
    description: "Brighter, faster, and more energetic.",
    controls: {
      speed: 1.08,
      pitchSemitones: 1,
      volumeDb: 1,
      normalize: true,
      trimSilence: true,
      pauseScale: 0.9,
    },
    text: { expandTokens: true, sentenceBreakMs: 170, commaBreakMs: 45 },
  },
  {
    id: "angry",
    label: "Angry",
    description: "Sharper, louder, and clipped for tense reads.",
    controls: {
      speed: 1.12,
      pitchSemitones: 1.5,
      volumeDb: 2,
      normalize: true,
      trimSilence: true,
      pauseScale: 0.78,
    },
    text: { expandTokens: true, sentenceBreakMs: 130, commaBreakMs: 25 },
  },
  {
    id: "romantic",
    label: "Romantic",
    description: "Slower, softer, and more intimate pacing.",
    controls: {
      speed: 0.84,
      pitchSemitones: -1,
      volumeDb: -1.5,
      normalize: true,
      trimSilence: false,
      pauseScale: 1.55,
    },
    text: { expandTokens: true, sentenceBreakMs: 470, commaBreakMs: 170 },
  },
  {
    id: "dramatic",
    label: "Dramatic",
    description: "Big pauses and weightier narration.",
    controls: {
      speed: 0.88,
      pitchSemitones: -1.5,
      volumeDb: 1,
      normalize: true,
      trimSilence: false,
      pauseScale: 1.5,
    },
    text: { expandTokens: true, sentenceBreakMs: 520, commaBreakMs: 180 },
  },
  {
    id: "documentary",
    label: "Documentary",
    description: "Measured, credible pacing with room for visual edits.",
    controls: {
      speed: 0.92,
      pitchSemitones: -1,
      volumeDb: 0,
      normalize: true,
      trimSilence: false,
      pauseScale: 1.32,
    },
    text: { expandTokens: true, sentenceBreakMs: 360, commaBreakMs: 125 },
  },
  {
    id: "advertisement",
    label: "Advertisement",
    description: "Confident, brighter, and tighter for short promos.",
    controls: {
      speed: 1.04,
      pitchSemitones: 0.75,
      volumeDb: 1.5,
      normalize: true,
      trimSilence: true,
      pauseScale: 0.92,
    },
    text: { expandTokens: true, sentenceBreakMs: 180, commaBreakMs: 55 },
  },
  {
    id: "tutorial",
    label: "Tutorial",
    description: "Clear instructional delivery with extra step pauses.",
    controls: {
      speed: 0.93,
      pitchSemitones: -0.25,
      volumeDb: 0,
      normalize: true,
      trimSilence: false,
      pauseScale: 1.24,
    },
    text: { expandTokens: true, sentenceBreakMs: 320, commaBreakMs: 115 },
  },
  {
    id: "audiobook",
    label: "Audiobook",
    description: "Long-form narration with warmer pitch and generous pauses.",
    controls: {
      speed: 0.88,
      pitchSemitones: -1.25,
      volumeDb: -0.5,
      normalize: true,
      trimSilence: false,
      pauseScale: 1.45,
    },
    text: { expandTokens: true, sentenceBreakMs: 460, commaBreakMs: 160 },
  },
];

const STYLE_BY_ID = new Map(PERFORMANCE_STYLES.map((style) => [style.id, style]));
const TOKEN_EXPANSIONS: Record<string, string> = {
  AI: "A I",
  API: "A P I",
  ASR: "A S R",
  CLI: "C L I",
  CSV: "C S V",
  GPU: "G P U",
  HTTP: "H T T P",
  HTTPS: "H T T P S",
  JSON: "J S O N",
  MP3: "M P 3",
  PDF: "P D F",
  SSML: "S S M L",
  TTS: "T T S",
  UI: "U I",
  URL: "U R L",
  WAV: "wave",
};

export function getPerformanceStyle(styleId: string): PerformanceStyle {
  return STYLE_BY_ID.get(styleId as PerformanceStyleId) ?? PERFORMANCE_STYLES[1];
}

export function applyPerformanceStyle(
  controls: AudioControls,
  styleId: string
): AudioControls {
  const style = getPerformanceStyle(styleId);
  return {
    ...controls,
    ...style.controls,
    format: controls.format,
  };
}

export function expandSpeechTokens(value: string): string {
  return value
    .replace(/\bv(\d+)\.(\d+)\b/gi, "version $1 point $2")
    .replace(/(\d+(?:\.\d+)?)%/g, "$1 percent")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\b(AI|API|ASR|CLI|CSV|GPU|HTTPS?|JSON|MP3|PDF|SSML|TTS|UI|URL|WAV)\b/g, (token) =>
      TOKEN_EXPANSIONS[token.toUpperCase()] ?? token
    )
    .replace(/[ \t]+/g, " ")
    .trim();
}

function escapeSsmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function addBreaks(value: string, textTuning: TextTuning): string {
  let output = value;
  if (textTuning.commaBreakMs) {
    output = output.replace(
      /([,;:])\s+/g,
      `$1<break time="${textTuning.commaBreakMs}ms"/> `
    );
  }
  if (textTuning.sentenceBreakMs) {
    output = output.replace(
      /([.!?])\s+/g,
      `$1<break time="${textTuning.sentenceBreakMs}ms"/> `
    );
  }
  return output;
}

export function prepareTextForPerformance(
  text: string,
  styleId: string,
  ssmlEnabled: boolean
): { text: string; ssml: boolean } {
  if (ssmlEnabled) return { text, ssml: true };

  const style = getPerformanceStyle(styleId);
  const expanded = style.text.expandTokens ? expandSpeechTokens(text) : text.trim();
  if (!style.text.sentenceBreakMs && !style.text.commaBreakMs) {
    return { text: expanded, ssml: false };
  }

  const withBreaks = addBreaks(escapeSsmlText(expanded), style.text);
  return { text: `<speak>${withBreaks}</speak>`, ssml: true };
}
