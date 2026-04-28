"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { formatTime, parseTranscript } from "./lib/dubbing";
import { stitchWavBlobs } from "./lib/wav";
import {
  DEFAULT_CONTROLS,
  createId,
  createProject,
  deleteAudioAsset,
  deleteProject,
  exportProjectArchive,
  importProjectArchive,
  loadAudioAssets,
  loadWorkspace,
  saveAudioAsset,
  saveProject,
  setActiveProject as storeActiveProject,
  type AudioAsset,
  type AudioControls,
  type DubbingSegment,
  type KuralProject,
  type OutputFormat,
  type PronunciationProfile,
  type PronunciationRule,
  type VoicePreset,
} from "./lib/workspace";

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
  locale?: string | null;
  engine?: string;
  capabilities?: string[];
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
  language?: string | null;
  locale?: string | null;
  capabilities?: string[];
}

type Mode = "single" | "batch";
type WorkspaceView = "write" | "dubbing" | "pronunciation" | "library";
type VoiceKind = "kokoro" | "clone";

const SYNTH_CHUNK_LIMIT = 3200;

function splitBatchInput(value: string): string[] {
  return value
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyPronunciationPreview(text: string, rules: PronunciationRule[], language: string): string {
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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseVoiceKey(key: string): { kind: VoiceKind; id: string } {
  const [kind, ...rest] = key.split(":");
  return {
    kind: kind === "clone" ? "clone" : "kokoro",
    id: rest.join(":") || key,
  };
}

function toApiControls(controls: AudioControls) {
  return {
    speed: controls.speed,
    pitch_semitones: controls.pitchSemitones,
    volume_db: controls.volumeDb,
    normalize: controls.normalize,
    trim_silence: controls.trimSilence,
    pause_scale: controls.pauseScale,
  };
}

function toApiRules(rules: PronunciationRule[]) {
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

function measureBlobDuration(blob: Blob): Promise<number> {
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

export default function Home() {
  const apiUrl = useMemo(getApiUrl, []);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [clones, setClones] = useState<ClonedVoiceInfo[]>([]);
  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [backendError, setBackendError] = useState("");
  const [voicesError, setVoicesError] = useState<string | null>(null);

  const [projects, setProjects] = useState<KuralProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [assets, setAssets] = useState<AudioAsset[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const [activeView, setActiveView] = useState<WorkspaceView>("write");
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({});

  const [selectedVoiceKey, setSelectedVoiceKey] = useState("");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [controls, setControls] = useState<AudioControls>(DEFAULT_CONTROLS);
  const [ssmlEnabled, setSsmlEnabled] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [presetName, setPresetName] = useState("");
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleReplacement, setNewRuleReplacement] = useState("");

  const [cloneName, setCloneName] = useState("");
  const [cloneLanguage, setCloneLanguage] = useState("en-US");
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneMessage, setCloneMessage] = useState("");

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects]
  );
  const activeDocument = useMemo(
    () =>
      activeProject?.documents.find((document) => document.id === activeProject.activeDocumentId) ??
      activeProject?.documents[0] ??
      null,
    [activeProject]
  );
  const activeProfile = useMemo(
    () =>
      activeProject?.pronunciationProfiles.find(
        (profile) => profile.id === activeProject.activePronunciationProfileId
      ) ??
      activeProject?.pronunciationProfiles[0] ??
      null,
    [activeProject]
  );

  const voiceOptions = useMemo(() => {
    const kokoro = voices.map((voice) => ({
      key: `kokoro:${voice.id}`,
      label: `${voice.name} (${voice.language})`,
      shortLabel: voice.name,
      language: voice.locale || voice.language,
      kind: "kokoro" as const,
      id: voice.id,
    }));
    const cloned = clones.map((clone) => ({
      key: `clone:${clone.id}`,
      label: `${clone.name} (${clone.language || "custom"})`,
      shortLabel: clone.name,
      language: clone.language || "custom",
      kind: "clone" as const,
      id: clone.id,
    }));
    return [...kokoro, ...cloned].filter(
      (option) => languageFilter === "all" || option.language === languageFilter || option.language === "custom"
    );
  }, [clones, languageFilter, voices]);

  const allLanguages = useMemo(() => {
    const set = new Set<string>();
    voices.forEach((voice) => set.add(voice.locale || voice.language));
    clones.forEach((clone) => clone.language && set.add(clone.language));
    return ["all", ...Array.from(set).sort()];
  }, [clones, voices]);

  const selectedVoiceLabel = useCallback(
    (key: string) => {
      const option =
        voiceOptions.find((candidate) => candidate.key === key) ||
        voices
          .map((voice) => ({ key: `kokoro:${voice.id}`, shortLabel: voice.name }))
          .find((candidate) => candidate.key === key) ||
        clones
          .map((clone) => ({ key: `clone:${clone.id}`, shortLabel: clone.name }))
          .find((candidate) => candidate.key === key);
      return option?.shortLabel || "Voice";
    },
    [clones, voiceOptions, voices]
  );

  const refreshWorkspace = useCallback(async () => {
    try {
      const workspace = await loadWorkspace();
      setProjects(workspace.projects);
      setActiveProjectId(workspace.activeProjectId);
      setAssets(workspace.assets);
      setWorkspaceError("");
    } catch (exc) {
      setWorkspaceError(exc instanceof Error ? exc.message : "Could not load workspace");
    }
  }, []);

  const refreshAssets = useCallback(async (projectId: string) => {
    try {
      setAssets(await loadAudioAssets(projectId));
    } catch (exc) {
      setWorkspaceError(exc instanceof Error ? exc.message : "Could not load audio assets");
    }
  }, []);

  const fetchClones = useCallback(async () => {
    const res = await fetch(`${apiUrl}/api/voices/clones`);
    if (!res.ok) throw new Error(await readApiError(res));
    const data = await res.json();
    setClones(data.clones ?? []);
  }, [apiUrl]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  useEffect(() => {
    let cancelled = false;
    async function loadBackend() {
      try {
        const health = await fetch(`${apiUrl}/api/health`);
        if (health.ok) {
          const data = await health.json();
          if (!cancelled) setBackendStatus(`${data.engine} ${data.version}`);
        }
      } catch {
        if (!cancelled) setBackendError("Backend is not reachable yet.");
      }

      try {
        const res = await fetch(`${apiUrl}/api/voices`);
        if (!res.ok) throw new Error(await readApiError(res));
        const data = await res.json();
        if (!cancelled) {
          setVoices(data.voices ?? []);
          setVoicesError(null);
        }
      } catch (exc) {
        if (!cancelled) setVoicesError(exc instanceof Error ? exc.message : "Could not load voices");
      }

      try {
        await fetchClones();
      } catch {
        if (!cancelled) setClones([]);
      }
    }

    void loadBackend();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, fetchClones]);

  useEffect(() => {
    if (!selectedVoiceKey && voiceOptions.length > 0) {
      setSelectedVoiceKey(voiceOptions[0].key);
    }
  }, [selectedVoiceKey, voiceOptions]);

  useEffect(() => {
    const urls: Record<string, string> = {};
    assets.forEach((asset) => {
      urls[asset.id] = URL.createObjectURL(asset.blob);
    });
    setAudioUrls(urls);
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [assets]);

  useEffect(() => {
    let cancelled = false;
    async function measure() {
      const entries = await Promise.all(
        assets.map(async (asset) => [asset.id, await measureBlobDuration(asset.blob)] as const)
      );
      if (!cancelled) {
        setAssetDurations(Object.fromEntries(entries));
      }
    }
    void measure();
    return () => {
      cancelled = true;
    };
  }, [assets]);

  function persistProject(project: KuralProject) {
    const next = { ...project, updatedAt: new Date().toISOString() };
    setProjects((current) =>
      current.map((candidate) => (candidate.id === next.id ? next : candidate)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    );
    void saveProject(next).catch((exc) => {
      setWorkspaceError(exc instanceof Error ? exc.message : "Could not save project");
    });
  }

  function updateDocumentText(value: string) {
    if (!activeProject || !activeDocument) return;
    persistProject({
      ...activeProject,
      documents: activeProject.documents.map((document) =>
        document.id === activeDocument.id ? { ...document, text: value, updatedAt: new Date().toISOString() } : document
      ),
    });
  }

  function updateMode(mode: Mode) {
    if (!activeProject || !activeDocument) return;
    persistProject({
      ...activeProject,
      documents: activeProject.documents.map((document) =>
        document.id === activeDocument.id ? { ...document, mode, updatedAt: new Date().toISOString() } : document
      ),
    });
  }

  function updateActiveProjectFields(fields: Partial<KuralProject>) {
    if (!activeProject) return;
    persistProject({ ...activeProject, ...fields });
  }

  async function createNewProject() {
    const project = createProject(`Project ${projects.length + 1}`);
    await saveProject(project);
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    storeActiveProject(project.id);
    setAssets([]);
  }

  async function removeActiveProject() {
    if (!activeProject || projects.length <= 1) return;
    await deleteProject(activeProject.id);
    const next = projects.find((project) => project.id !== activeProject.id);
    if (next) {
      setActiveProjectId(next.id);
      storeActiveProject(next.id);
      setProjects((current) => current.filter((project) => project.id !== activeProject.id));
      await refreshAssets(next.id);
    }
  }

  async function switchProject(projectId: string) {
    setActiveProjectId(projectId);
    storeActiveProject(projectId);
    await refreshAssets(projectId);
  }

  async function synthesizeText(text: string, segment?: DubbingSegment): Promise<{ blob: Blob; format: OutputFormat }> {
    if (!activeProject || !activeProfile) throw new Error("Workspace is still loading");
    const voiceKey = segment?.voiceId || selectedVoiceKey;
    if (!voiceKey) throw new Error("Choose a voice before generating audio");
    const selected = parseVoiceKey(voiceKey);
    const activeControls = segment?.controls ?? controls;
    const body = {
      text,
      voice: selected.kind === "kokoro" ? selected.id : "af_bella",
      voice_id: selected.kind === "clone" ? selected.id : undefined,
      speed: activeControls.speed,
      format: activeControls.format,
      ssml: !segment && ssmlEnabled,
      controls: toApiControls(activeControls),
      pronunciation_rules: toApiRules(activeProfile.rules),
      language: activeProject.targetLanguage,
    };

    const res = await fetch(`${apiUrl}/api/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readApiError(res));
    const blob = await res.blob();
    const isMp3 = (res.headers.get("content-type") || "").includes("mpeg");
    return { blob, format: isMp3 ? "mp3" : activeControls.format };
  }

  async function generateAudio() {
    if (!activeProject || !activeDocument) return;
    const rawText = activeDocument.text.trim();
    if (!rawText) {
      setError("Enter text before generating audio.");
      return;
    }

    setIsGenerating(true);
    setError("");
    setSuccess("");
    try {
      const mode = activeDocument.mode === "batch" ? "batch" : "single";
      const items = mode === "batch" ? splitBatchInput(rawText) : [rawText];
      const newAssets: AudioAsset[] = [];

      for (const item of items) {
        const chunks =
          !ssmlEnabled && controls.format === "wav" && item.length > SYNTH_CHUNK_LIMIT
            ? splitLongText(item)
            : [item];
        const generated = [];
        for (const chunk of chunks) {
          generated.push(await synthesizeText(chunk));
        }
        const blob =
          generated.length > 1
            ? await stitchWavBlobs(generated.map((part) => part.blob))
            : generated[0].blob;
        const format = generated.length > 1 ? "wav" : generated[0].format;
        const asset: AudioAsset = {
          id: createId("asset"),
          projectId: activeProject.id,
          name: item.slice(0, 60) || "Generated clip",
          text: item,
          voiceLabel: selectedVoiceLabel(selectedVoiceKey),
          format,
          createdAt: new Date().toISOString(),
          bytes: blob.size,
          blob,
          language: activeProject.targetLanguage,
          controls,
        };
        await saveAudioAsset(asset);
        newAssets.push(asset);
      }

      setAssets((current) => [...newAssets, ...current]);
      setActiveView("library");
      setSuccess(`Generated ${newAssets.length} audio clip${newAssets.length === 1 ? "" : "s"}.`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  function updatePronunciationProfile(profile: PronunciationProfile) {
    if (!activeProject) return;
    persistProject({
      ...activeProject,
      pronunciationProfiles: activeProject.pronunciationProfiles.map((candidate) =>
        candidate.id === profile.id ? { ...profile, updatedAt: new Date().toISOString() } : candidate
      ),
    });
  }

  function addPronunciationRule() {
    if (!activeProfile || !newRulePattern.trim() || !newRuleReplacement.trim()) return;
    updatePronunciationProfile({
      ...activeProfile,
      rules: [
        ...activeProfile.rules,
        {
          id: createId("rule"),
          pattern: newRulePattern.trim(),
          replacement: newRuleReplacement.trim(),
          mode: "word",
          caseSensitive: false,
          language: activeProject?.targetLanguage || "",
          enabled: true,
          priority: activeProfile.rules.length + 1,
        },
      ],
    });
    setNewRulePattern("");
    setNewRuleReplacement("");
  }

  function updateRule(ruleId: string, fields: Partial<PronunciationRule>) {
    if (!activeProfile) return;
    updatePronunciationProfile({
      ...activeProfile,
      rules: activeProfile.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...fields } : rule)),
    });
  }

  function deleteRule(ruleId: string) {
    if (!activeProfile) return;
    updatePronunciationProfile({
      ...activeProfile,
      rules: activeProfile.rules.filter((rule) => rule.id !== ruleId),
    });
  }

  function saveVoicePreset() {
    if (!activeProject || !selectedVoiceKey) return;
    const parsed = parseVoiceKey(selectedVoiceKey);
    const preset: VoicePreset = {
      id: createId("preset"),
      name: presetName.trim() || selectedVoiceLabel(selectedVoiceKey),
      voiceKind: parsed.kind,
      voiceId: parsed.id,
      voiceLabel: selectedVoiceLabel(selectedVoiceKey),
      language: activeProject.targetLanguage,
      controls,
      updatedAt: new Date().toISOString(),
    };
    persistProject({ ...activeProject, voicePresets: [...activeProject.voicePresets, preset] });
    setPresetName("");
  }

  function applyVoicePreset(preset: VoicePreset) {
    setSelectedVoiceKey(`${preset.voiceKind}:${preset.voiceId}`);
    setControls(preset.controls);
  }

  async function importTranscriptFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeProject) return;
    try {
      const imported = parseTranscript(
        file.name,
        await file.text(),
        activeProject.sourceLanguage,
        activeProject.targetLanguage
      ).map((segment) => ({
        ...segment,
        voiceId: selectedVoiceKey,
        controls: { ...controls, format: "wav" as const },
      }));
      if (imported.length === 0) throw new Error("No transcript segments found");
      persistProject({
        ...activeProject,
        dubbingSegments: imported,
        documents: activeProject.documents.map((document) =>
          document.id === activeProject.activeDocumentId ? { ...document, mode: "dubbing" } : document
        ),
      });
      setActiveView("dubbing");
      setSuccess(`Imported ${imported.length} dubbing segment${imported.length === 1 ? "" : "s"}.`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not import transcript");
    }
  }

  function updateSegment(segmentId: string, fields: Partial<DubbingSegment>) {
    if (!activeProject) return;
    persistProject({
      ...activeProject,
      dubbingSegments: activeProject.dubbingSegments.map((segment) =>
        segment.id === segmentId ? { ...segment, ...fields } : segment
      ),
    });
  }

  async function renderSegment(segment: DubbingSegment) {
    if (!activeProject) return;
    updateSegment(segment.id, { status: "rendering", error: undefined });
    try {
      const generated = await synthesizeText(segment.targetText || segment.sourceText, segment);
      const asset: AudioAsset = {
        id: createId("asset"),
        projectId: activeProject.id,
        name: `Dub ${formatTime(segment.startMs)}`,
        text: segment.targetText || segment.sourceText,
        voiceLabel: selectedVoiceLabel(segment.voiceId || selectedVoiceKey),
        format: generated.format,
        createdAt: new Date().toISOString(),
        bytes: generated.blob.size,
        blob: generated.blob,
        dubbingSegmentId: segment.id,
        language: segment.targetLanguage,
        controls: segment.controls,
      };
      await saveAudioAsset(asset);
      setAssets((current) => [asset, ...current]);
      updateSegment(segment.id, { status: "ready", audioAssetId: asset.id, error: undefined });
    } catch (exc) {
      updateSegment(segment.id, {
        status: "error",
        error: exc instanceof Error ? exc.message : "Could not render segment",
      });
    }
  }

  async function exportDubbingTimeline() {
    if (!activeProject) return;
    const rendered = activeProject.dubbingSegments
      .filter((segment) => segment.audioAssetId)
      .sort((a, b) => a.startMs - b.startMs)
      .map((segment) => assets.find((asset) => asset.id === segment.audioAssetId))
      .filter((asset): asset is AudioAsset => Boolean(asset));
    if (rendered.length === 0) {
      setError("Render at least one dubbing segment before exporting.");
      return;
    }
    if (rendered.some((asset) => asset.format !== "wav")) {
      setError("Timeline export is WAV-only. Re-render non-WAV segments as WAV.");
      return;
    }
    try {
      const blob = await stitchWavBlobs(rendered.map((asset) => asset.blob));
      downloadBlob(blob, `${activeProject.name || "kural"}-dubbing.wav`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not export dubbing timeline");
    }
  }

  async function exportActiveProject() {
    if (!activeProject) return;
    try {
      const blob = await exportProjectArchive(activeProject, assets);
      downloadBlob(blob, `${activeProject.name || "kural"}.kuralproj`);
    } catch (exc) {
      setWorkspaceError(exc instanceof Error ? exc.message : "Could not export project");
    }
  }

  async function importProjectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await importProjectArchive(file);
      await refreshWorkspace();
      setSuccess("Imported project archive.");
    } catch (exc) {
      setWorkspaceError(exc instanceof Error ? exc.message : "Could not import project");
    }
  }

  async function deleteAsset(assetId: string) {
    await deleteAudioAsset(assetId);
    setAssets((current) => current.filter((asset) => asset.id !== assetId));
  }

  async function uploadClone() {
    if (!cloneFile) {
      setCloneMessage("Choose an audio sample first.");
      return;
    }
    setCloneBusy(true);
    setCloneMessage("");
    try {
      const form = new FormData();
      form.append("file", cloneFile);
      form.append("name", cloneName);
      form.append("language", cloneLanguage);
      form.append("consent_confirmed", String(cloneConsent));
      const res = await fetch(`${apiUrl}/api/voices/clone`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await readApiError(res));
      await fetchClones();
      setCloneName("");
      setCloneFile(null);
      setCloneConsent(false);
      setCloneMessage("Cloned voice is ready.");
    } catch (exc) {
      setCloneMessage(exc instanceof Error ? exc.message : "Could not clone voice");
    } finally {
      setCloneBusy(false);
    }
  }

  async function deleteClone(voiceId: string) {
    const res = await fetch(`${apiUrl}/api/voices/clones/${voiceId}`, { method: "DELETE" });
    if (res.ok) {
      await fetchClones();
    }
  }

  async function exportClones() {
    const res = await fetch(`${apiUrl}/api/voices/clones/export`);
    if (!res.ok) {
      setCloneMessage(await readApiError(res));
      return;
    }
    downloadBlob(await res.blob(), "kural-voices.zip");
  }

  async function importCloneArchive(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${apiUrl}/api/voices/clones/import`, { method: "POST", body: form });
    if (!res.ok) {
      setCloneMessage(await readApiError(res));
      return;
    }
    const data = await res.json();
    await fetchClones();
    setCloneMessage(`Imported ${data.total} cloned voice${data.total === 1 ? "" : "s"}.`);
  }

  const mode: Mode = activeDocument?.mode === "batch" ? "batch" : "single";
  const previewText = activeProfile
    ? applyPronunciationPreview(activeProfile.previewText, activeProfile.rules, activeProject?.targetLanguage || "")
    : "";

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 lg:flex-row">
        <aside className="w-full shrink-0 rounded border border-slate-300 bg-white p-3 lg:w-72">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Workspace</p>
              <h1 className="text-xl font-semibold">Kural</h1>
            </div>
            <button className="rounded bg-slate-950 px-3 py-2 text-sm text-white" onClick={createNewProject}>
              New
            </button>
          </div>

          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                className={`w-full rounded border px-3 py-2 text-left text-sm ${
                  project.id === activeProjectId
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"
                }`}
                onClick={() => void switchProject(project.id)}
              >
                <span className="block font-medium">{project.name}</span>
                <span className="block text-xs opacity-75">{project.targetLanguage}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="rounded border border-slate-300 px-2 py-2 text-sm" onClick={exportActiveProject}>
              Export
            </button>
            <label className="cursor-pointer rounded border border-slate-300 px-2 py-2 text-center text-sm">
              Import
              <input className="hidden" type="file" accept=".kuralproj,.zip" onChange={importProjectFile} />
            </label>
            <button
              className="col-span-2 rounded border border-red-300 px-2 py-2 text-sm text-red-700 disabled:opacity-40"
              disabled={projects.length <= 1}
              onClick={() => void removeActiveProject()}
            >
              Delete Project
            </button>
          </div>

          <div className="mt-4 rounded border border-slate-200 p-3 text-xs text-slate-600">
            <p>Backend: {backendStatus || "checking"}</p>
            <p>API: {apiUrl}</p>
            {backendError && <p className="mt-2 text-red-700">{backendError}</p>}
            {workspaceError && <p className="mt-2 text-red-700">{workspaceError}</p>}
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="rounded border border-slate-300 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_1fr_1fr]">
                <label className="text-sm">
                  Project name
                  <input
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    value={activeProject?.name || ""}
                    onChange={(event) => updateActiveProjectFields({ name: event.target.value })}
                  />
                </label>
                <label className="text-sm">
                  Source
                  <input
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    value={activeProject?.sourceLanguage || "en-US"}
                    onChange={(event) => updateActiveProjectFields({ sourceLanguage: event.target.value })}
                  />
                </label>
                <label className="text-sm">
                  Target
                  <input
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    value={activeProject?.targetLanguage || "en-US"}
                    onChange={(event) => updateActiveProjectFields({ targetLanguage: event.target.value })}
                  />
                </label>
              </div>
              <nav className="flex flex-wrap gap-2">
                {(["write", "dubbing", "pronunciation", "library"] as WorkspaceView[]).map((view) => (
                  <button
                    key={view}
                    className={`rounded border px-3 py-2 text-sm capitalize ${
                      activeView === view ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300"
                    }`}
                    onClick={() => setActiveView(view)}
                  >
                    {view}
                  </button>
                ))}
              </nav>
            </div>

            {activeView === "write" && (!activeProject || !activeDocument) && (
              <div className="p-4 text-sm text-slate-500">Loading workspace...</div>
            )}

            {activeView === "write" && activeProject && activeDocument && (
              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={`rounded border px-3 py-2 text-sm ${
                        mode === "single" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300"
                      }`}
                      onClick={() => updateMode("single")}
                    >
                      Single
                    </button>
                    <button
                      className={`rounded border px-3 py-2 text-sm ${
                        mode === "batch" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300"
                      }`}
                      onClick={() => updateMode("batch")}
                    >
                      Batch
                    </button>
                    <label className="flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm">
                      <input
                        aria-label="SSML"
                        type="checkbox"
                        checked={ssmlEnabled}
                        onChange={(event) => setSsmlEnabled(event.target.checked)}
                      />
                      SSML
                    </label>
                  </div>

                  <label className="block text-sm font-medium">
                    Text
                    <textarea
                      id="script-text"
                      className="mt-2 min-h-72 w-full resize-y rounded border border-slate-300 px-3 py-3 font-mono text-sm leading-6"
                      value={activeDocument?.text || ""}
                      onChange={(event) => updateDocumentText(event.target.value)}
                      placeholder={
                        mode === "batch"
                          ? "Separate each script with a blank line."
                          : "Write or paste the script for this project."
                      }
                    />
                  </label>

                  {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                  {success && (
                    <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      {success}
                    </p>
                  )}

                  <button
                    className="rounded bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={isGenerating || !selectedVoiceKey}
                    onClick={() => void generateAudio()}
                  >
                    {isGenerating ? "Generating..." : mode === "batch" ? "Generate Batch" : "Generate Audio"}
                  </button>
                </div>

                <div className="space-y-4">
                  <ControlPanel
                    controls={controls}
                    languageFilter={languageFilter}
                    languages={allLanguages}
                    selectedVoiceKey={selectedVoiceKey}
                    voiceOptions={voiceOptions}
                    onControlsChange={setControls}
                    onLanguageFilterChange={setLanguageFilter}
                    onVoiceChange={setSelectedVoiceKey}
                  />

                  <section className="rounded border border-slate-300 p-3">
                    <h2 className="mb-2 font-semibold">Voice Presets</h2>
                    <div className="flex gap-2">
                      <input
                        className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                        value={presetName}
                        onChange={(event) => setPresetName(event.target.value)}
                        placeholder="Preset name"
                      />
                      <button className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={saveVoicePreset}>
                        Save
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {activeProject?.voicePresets.map((preset) => (
                        <button
                          key={preset.id}
                          className="w-full rounded border border-slate-200 px-3 py-2 text-left text-sm"
                          onClick={() => applyVoicePreset(preset)}
                        >
                          {preset.name} - {preset.voiceLabel}
                        </button>
                      ))}
                      {activeProject?.voicePresets.length === 0 && (
                        <p className="text-sm text-slate-500">No presets saved yet.</p>
                      )}
                    </div>
                  </section>

                  <ClonePanel
                    cloneBusy={cloneBusy}
                    cloneConsent={cloneConsent}
                    cloneLanguage={cloneLanguage}
                    cloneMessage={cloneMessage}
                    cloneName={cloneName}
                    clones={clones}
                    onCloneConsentChange={setCloneConsent}
                    onCloneExport={() => void exportClones()}
                    onCloneFileChange={setCloneFile}
                    onCloneImport={importCloneArchive}
                    onCloneLanguageChange={setCloneLanguage}
                    onCloneNameChange={setCloneName}
                    onCloneUpload={() => void uploadClone()}
                    onDeleteClone={(id) => void deleteClone(id)}
                  />

                  <AudioLibrary assets={assets} audioUrls={audioUrls} onDelete={(id) => void deleteAsset(id)} />
                </div>
              </div>
            )}

            {activeView === "dubbing" && !activeProject && (
              <div className="p-4 text-sm text-slate-500">Loading workspace...</div>
            )}

            {activeView === "dubbing" && activeProject && (
              <div className="space-y-4 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded border border-slate-300 px-3 py-2 text-sm">
                    Import SRT/VTT/CSV/Text
                    <input className="hidden" type="file" accept=".srt,.vtt,.csv,.txt" onChange={importTranscriptFile} />
                  </label>
                  <button className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={exportDubbingTimeline}>
                    Export WAV Timeline
                  </button>
                  <span className="text-sm text-slate-500">
                    {activeProject?.dubbingSegments.length || 0} transcript segments
                  </span>
                </div>

                <div className="space-y-3">
                  {activeProject?.dubbingSegments.map((segment, index) => {
                    const asset = assets.find((candidate) => candidate.id === segment.audioAssetId);
                    const duration = segment.audioAssetId ? assetDurations[segment.audioAssetId] || 0 : 0;
                    const limit = segment.endMs - segment.startMs;
                    const overrun = duration > 0 && duration > limit;
                    return (
                      <section key={segment.id} className="rounded border border-slate-300 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="font-medium">
                              Segment {index + 1} - {formatTime(segment.startMs)}
                            </h3>
                            <p className="text-xs text-slate-500">
                              Target {formatTime(segment.endMs)} {overrun ? "- overrun" : ""}
                            </p>
                          </div>
                          <button
                            className="rounded bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50"
                            disabled={segment.status === "rendering"}
                            onClick={() => void renderSegment(segment)}
                          >
                            {segment.status === "rendering" ? "Rendering..." : "Render Segment"}
                          </button>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <label className="text-sm">
                            Source text
                            <textarea
                              className="mt-1 min-h-28 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                              value={segment.sourceText}
                              onChange={(event) => updateSegment(segment.id, { sourceText: event.target.value })}
                            />
                          </label>
                          <label className="text-sm">
                            Target text
                            <textarea
                              className="mt-1 min-h-28 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                              value={segment.targetText}
                              onChange={(event) => updateSegment(segment.id, { targetText: event.target.value })}
                            />
                          </label>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-4">
                          <select
                            className="rounded border border-slate-300 px-3 py-2 text-sm"
                            value={segment.voiceId || selectedVoiceKey}
                            onChange={(event) => updateSegment(segment.id, { voiceId: event.target.value })}
                          >
                            {voiceOptions.map((option) => (
                              <option key={option.key} value={option.key}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <input
                            className="rounded border border-slate-300 px-3 py-2 text-sm"
                            type="number"
                            min={0.5}
                            max={2}
                            step={0.05}
                            value={segment.controls.speed}
                            onChange={(event) =>
                              updateSegment(segment.id, {
                                controls: { ...segment.controls, speed: Number(event.target.value) },
                              })
                            }
                          />
                          <input
                            className="rounded border border-slate-300 px-3 py-2 text-sm"
                            value={segment.notes}
                            onChange={(event) => updateSegment(segment.id, { notes: event.target.value })}
                            placeholder="Notes"
                          />
                          <span className="rounded border border-slate-200 px-3 py-2 text-sm">
                            {segment.status}
                          </span>
                        </div>
                        {asset && audioUrls[asset.id] && (
                          <audio className="mt-3 w-full" controls src={audioUrls[asset.id]} />
                        )}
                        {segment.error && <p className="mt-2 text-sm text-red-700">{segment.error}</p>}
                      </section>
                    );
                  })}
                  {activeProject?.dubbingSegments.length === 0 && (
                    <p className="rounded border border-slate-200 p-4 text-sm text-slate-500">
                      Import a transcript file to start a local dubbing workflow.
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeView === "pronunciation" && (
              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                <section className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                      value={newRulePattern}
                      onChange={(event) => setNewRulePattern(event.target.value)}
                      placeholder="Pattern"
                    />
                    <input
                      className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                      value={newRuleReplacement}
                      onChange={(event) => setNewRuleReplacement(event.target.value)}
                      placeholder="Replacement"
                    />
                    <button className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={addPronunciationRule}>
                      Add Rule
                    </button>
                  </div>

                  <div className="space-y-2">
                    {activeProfile?.rules.map((rule) => (
                      <div key={rule.id} className="grid gap-2 rounded border border-slate-300 p-3 md:grid-cols-6">
                        <input
                          className="rounded border border-slate-300 px-2 py-2 text-sm md:col-span-2"
                          value={rule.pattern}
                          onChange={(event) => updateRule(rule.id, { pattern: event.target.value })}
                        />
                        <input
                          className="rounded border border-slate-300 px-2 py-2 text-sm md:col-span-2"
                          value={rule.replacement}
                          onChange={(event) => updateRule(rule.id, { replacement: event.target.value })}
                        />
                        <select
                          className="rounded border border-slate-300 px-2 py-2 text-sm"
                          value={rule.mode}
                          onChange={(event) => updateRule(rule.id, { mode: event.target.value as PronunciationRule["mode"] })}
                        >
                          <option value="word">Word</option>
                          <option value="literal">Literal</option>
                        </select>
                        <button className="rounded border border-red-300 px-2 py-2 text-sm text-red-700" onClick={() => deleteRule(rule.id)}>
                          Delete
                        </button>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
                          />
                          Enabled
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={rule.caseSensitive}
                            onChange={(event) => updateRule(rule.id, { caseSensitive: event.target.checked })}
                          />
                          Case sensitive
                        </label>
                        <input
                          className="rounded border border-slate-300 px-2 py-2 text-sm"
                          value={rule.language}
                          onChange={(event) => updateRule(rule.id, { language: event.target.value })}
                          placeholder="Language"
                        />
                        <input
                          className="rounded border border-slate-300 px-2 py-2 text-sm"
                          type="number"
                          value={rule.priority}
                          onChange={(event) => updateRule(rule.id, { priority: Number(event.target.value) })}
                          placeholder="Priority"
                        />
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded border border-slate-300 p-3">
                  <h2 className="font-semibold">Profile Preview</h2>
                  <textarea
                    className="mt-2 min-h-32 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    value={activeProfile?.previewText || ""}
                    onChange={(event) =>
                      activeProfile && updatePronunciationProfile({ ...activeProfile, previewText: event.target.value })
                    }
                  />
                  <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm">{previewText}</div>
                </section>
              </div>
            )}

            {activeView === "library" && (
              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                <AudioLibrary assets={assets} audioUrls={audioUrls} onDelete={(id) => void deleteAsset(id)} />
                <ClonePanel
                  cloneBusy={cloneBusy}
                  cloneConsent={cloneConsent}
                  cloneLanguage={cloneLanguage}
                  cloneMessage={cloneMessage}
                  cloneName={cloneName}
                  clones={clones}
                  onCloneConsentChange={setCloneConsent}
                  onCloneExport={() => void exportClones()}
                  onCloneFileChange={setCloneFile}
                  onCloneImport={importCloneArchive}
                  onCloneLanguageChange={setCloneLanguage}
                  onCloneNameChange={setCloneName}
                  onCloneUpload={() => void uploadClone()}
                  onDeleteClone={(id) => void deleteClone(id)}
                />
              </div>
            )}
          </div>
          {voicesError && <p className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{voicesError}</p>}
        </section>
      </div>
    </main>
  );
}

function ControlPanel(props: {
  controls: AudioControls;
  languageFilter: string;
  languages: string[];
  selectedVoiceKey: string;
  voiceOptions: Array<{ key: string; label: string }>;
  onControlsChange: (controls: AudioControls) => void;
  onLanguageFilterChange: (language: string) => void;
  onVoiceChange: (voice: string) => void;
}) {
  const { controls, onControlsChange } = props;
  return (
    <section className="rounded border border-slate-300 p-3">
      <h2 className="mb-3 font-semibold">Advanced Audio</h2>
      <div className="space-y-3">
        <label className="block text-sm">
          Language filter
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={props.languageFilter}
            onChange={(event) => props.onLanguageFilterChange(event.target.value)}
          >
            {props.languages.map((language) => (
              <option key={language} value={language}>
                {language === "all" ? "All languages" : language}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Voice
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={props.selectedVoiceKey}
            onChange={(event) => props.onVoiceChange(event.target.value)}
          >
            {props.voiceOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Speed {controls.speed.toFixed(2)}
          <input
            className="mt-1 w-full"
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={controls.speed}
            onChange={(event) => onControlsChange({ ...controls, speed: Number(event.target.value) })}
          />
        </label>
        <label className="block text-sm">
          Pitch {controls.pitchSemitones.toFixed(1)} st
          <input
            className="mt-1 w-full"
            type="range"
            min={-6}
            max={6}
            step={0.5}
            value={controls.pitchSemitones}
            onChange={(event) => onControlsChange({ ...controls, pitchSemitones: Number(event.target.value) })}
          />
        </label>
        <label className="block text-sm">
          Volume {controls.volumeDb.toFixed(1)} dB
          <input
            className="mt-1 w-full"
            type="range"
            min={-12}
            max={6}
            step={0.5}
            value={controls.volumeDb}
            onChange={(event) => onControlsChange({ ...controls, volumeDb: Number(event.target.value) })}
          />
        </label>
        <label className="block text-sm">
          Pause scale {controls.pauseScale.toFixed(2)}
          <input
            className="mt-1 w-full"
            type="range"
            min={0.25}
            max={3}
            step={0.05}
            value={controls.pauseScale}
            onChange={(event) => onControlsChange({ ...controls, pauseScale: Number(event.target.value) })}
          />
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={controls.normalize}
              onChange={(event) => onControlsChange({ ...controls, normalize: event.target.checked })}
            />
            Normalize
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={controls.trimSilence}
              onChange={(event) => onControlsChange({ ...controls, trimSilence: event.target.checked })}
            />
            Trim silence
          </label>
        </div>
        <label className="block text-sm">
          Format
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={controls.format}
            onChange={(event) => onControlsChange({ ...controls, format: event.target.value as OutputFormat })}
          >
            <option value="wav">WAV</option>
            <option value="mp3">MP3</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function AudioLibrary(props: {
  assets: AudioAsset[];
  audioUrls: Record<string, string>;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Audio Library</h2>
        <p className="text-sm text-slate-500">{props.assets.length} local clips in this project</p>
      </div>
      {props.assets.map((asset) => (
        <article key={asset.id} className="rounded border border-slate-300 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <button className="max-w-xl text-left text-sm font-medium" onClick={() => props.audioUrls[asset.id] && downloadBlob(asset.blob, `${asset.name}.${asset.format}`)}>
              {asset.text}
            </button>
            <button className="rounded border border-red-300 px-2 py-1 text-xs text-red-700" onClick={() => props.onDelete(asset.id)}>
              Delete
            </button>
          </div>
          <p className="mt-1 text-xs uppercase text-slate-500">
            {asset.voiceLabel} / {asset.format.toUpperCase()} / {(asset.bytes / 1024).toFixed(1)} KB
          </p>
          {props.audioUrls[asset.id] && <audio className="mt-2 w-full" controls src={props.audioUrls[asset.id]} />}
        </article>
      ))}
      {props.assets.length === 0 && <p className="rounded border border-slate-200 p-4 text-sm text-slate-500">No clips yet.</p>}
    </section>
  );
}

function ClonePanel(props: {
  cloneBusy: boolean;
  cloneConsent: boolean;
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
  return (
    <section className="rounded border border-slate-300 p-3">
      <h2 className="font-semibold">Clone a Voice</h2>
      <div className="mt-3 space-y-3">
        <label className="block text-sm">
          Audio sample
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            type="file"
            accept="audio/*"
            onChange={(event) => props.onCloneFileChange(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="block text-sm">
          Voice name
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={props.cloneName}
            onChange={(event) => props.onCloneNameChange(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Language
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={props.cloneLanguage}
            onChange={(event) => props.onCloneLanguageChange(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={props.cloneConsent}
            onChange={(event) => props.onCloneConsentChange(event.target.checked)}
          />
          I have consent to clone and use this voice.
        </label>
        <button
          className="rounded bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={props.cloneBusy}
          onClick={props.onCloneUpload}
        >
          Clone Voice
        </button>
        {props.cloneMessage && <p className="text-sm text-slate-700">{props.cloneMessage}</p>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={props.onCloneExport}>
          Export Voices
        </button>
        <label className="cursor-pointer rounded border border-slate-300 px-3 py-2 text-sm">
          Import Voices
          <input id="clone-archive-file" className="hidden" type="file" accept=".zip" onChange={props.onCloneImport} />
        </label>
      </div>

      <div className="mt-4 space-y-2">
        {props.clones.map((clone) => (
          <div key={clone.id} className="rounded border border-slate-200 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>
                {clone.name} {clone.language ? `(${clone.language})` : ""}
              </span>
              <button className="rounded border border-red-300 px-2 py-1 text-xs text-red-700" onClick={() => props.onDeleteClone(clone.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {props.clones.length === 0 && <p className="text-sm text-slate-500">No cloned voices yet.</p>}
      </div>
    </section>
  );
}
