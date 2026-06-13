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
  sample_sha256?: string | null;
  allowed_uses?: Array<"personal" | "commercial" | "parody" | "internal" | "restricted">;
  clone_tier?: "quick" | "professional";
  quality_score?: number | null;
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

export type ModelPackAction = "install" | "update" | "remove";
export type BackgroundJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface BackgroundJob {
  id: string;
  kind: string;
  status: BackgroundJobStatus;
  progress: number;
  message: string;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
}

export interface ModelPackInfo {
  id: string;
  name: string;
  category: LocalModelInfo["category"];
  provider: string;
  status: LocalModelInfo["status"];
  version: string;
  source_url?: string | null;
  checksum?: string | null;
  license?: string | null;
  disk_size_mb?: number | null;
  installed_path?: string | null;
  languages: string[];
  capabilities: string[];
  requires_confirmation: boolean;
  non_commercial: boolean;
  trust_level?: "built_in" | "verified_manifest" | "user_supplied" | "external_runtime";
  manifest_digest?: string | null;
  recommended?: boolean;
  quality_score?: number;
  latency_tier?: "realtime" | "interactive" | "batch" | "manual";
  routing_hints?: string[];
  compatibility?: Record<string, string | number | boolean | string[]>;
  community_pack?: boolean;
  provenance_required?: boolean;
  detail?: string | null;
  actions: ModelPackAction[];
}

export interface ModelPacksResponse {
  packs: ModelPackInfo[];
  jobs: BackgroundJob[];
  total: number;
}

export interface ModelPackBenchmark {
  id: string;
  name: string;
  category: LocalModelInfo["category"];
  status: LocalModelInfo["status"];
  quality_score: number;
  naturalness_score: number;
  language_quality: number;
  latency_ms_estimate: number;
  memory_mb_estimate: number;
  best_for: string[];
  measured: boolean;
  detail?: string | null;
}

export interface ModelPackBenchmarksResponse {
  benchmarks: ModelPackBenchmark[];
  total: number;
}

export interface ModelRouteRecommendation {
  language: string;
  capability: string;
  pack?: ModelPackInfo | null;
  reason: string;
}

export interface AlignmentWord {
  text: string;
  start_ms: number;
  end_ms: number;
  probability?: number | null;
}

export interface AlignmentResponse {
  provider: string;
  duration_ms: number;
  transcript: string;
  language?: string | null;
  expected_text?: string | null;
  expected_duration_ms?: number | null;
  overrun_ms?: number | null;
  words: AlignmentWord[];
}

export interface TranscriptionSegmentResponse {
  start_ms: number;
  end_ms: number;
  text: string;
  speaker?: string | null;
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
  | "agent"
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
