export interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  gender: string;
  description: string;
  locale?: string | null;
  engine?: string;
  capabilities?: string[];
}

export interface ClonedVoiceInfo {
  id: string;
  name: string;
  engine: string;
  duration_s: number;
  sample_rate: number;
  created_at: string;
  consent_confirmed?: boolean;
  watermark?: string | null;
  language?: string | null;
  locale?: string | null;
  capabilities?: string[];
}

export interface LocalModelInfo {
  id: string;
  name: string;
  category: "tts" | "asr" | "translation";
  provider: string;
  status: "ready" | "not_configured" | "not_installed" | "disabled" | "error";
  languages?: string[];
  capabilities?: string[];
  license?: string | null;
  path?: string | null;
  detail?: string | null;
}

export interface TranscriptionSegmentResponse {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface TranscriptionResponse {
  text: string;
  language?: string | null;
  provider: string;
  segments: TranscriptionSegmentResponse[];
}

export type Mode = "single" | "batch";
export type WorkspaceView =
  | "write"
  | "quality"
  | "voices"
  | "models"
  | "dubbing"
  | "pronunciation"
  | "library"
  | "settings";
export type VoiceKind = "kokoro" | "supertonic" | "clone";

export interface VoiceOption {
  key: string;
  label: string;
  shortLabel: string;
  language: string;
  kind: VoiceKind;
  id: string;
}
