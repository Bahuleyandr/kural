"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AgentPanel } from "./components/AgentPanel";
import { AudioLibrary } from "./components/AudioLibrary";
import { ClonePanel } from "./components/ClonePanel";
import { ControlPanel } from "./components/ControlPanel";
import { DubbingTimeline } from "./components/DubbingTimeline";
import { FirstRunWizard, LocalRuntimeStatus } from "./components/FirstRunWizard";
import { LocalModelPanel } from "./components/LocalModelPanel";
import { ModelPackManager } from "./components/ModelPackManager";
import {
  QualityStudio,
  type QualityRenderRequest,
  type QualityResult,
} from "./components/QualityStudio";
import { SettingsView } from "./components/SettingsView";
import { ScriptStudio } from "./components/ScriptStudio";
import { TtsEnginePanel } from "./components/TtsEnginePanel";
import { SetupBanner } from "./components/SetupBanner";
import { WorkspaceTabs } from "./components/WorkspaceTabs";
import { useBackendStatus } from "./hooks/useBackendStatus";
import { useWorkspace } from "./hooks/useWorkspace";
import {
  apiFetch,
  getApiUrl,
  readApiError,
  rehydrateTauriGlobals,
  saveProjectArchiveToVault,
} from "./lib/api";
import {
  SYNTH_CHUNK_LIMIT,
  applyPronunciationPreview,
  downloadBlob,
  measureBlobDuration,
  parseVoiceKey,
  splitBatchInput,
  splitLongText,
  toApiControls,
  toApiRules,
} from "./lib/clientUtils";
import {
  exportSegmentsAsCsv,
  exportSegmentsAsSrt,
  exportSegmentsAsVtt,
  formatTime,
  inferSpeakerFromText,
  parseTranscript,
} from "./lib/dubbing";
import {
  PERFORMANCE_STYLES,
  applyPerformanceStyle,
  getPerformanceStyle,
  prepareTextForPerformance,
} from "./lib/performanceStyles";
import type {
  AlignmentResponse,
  Mode,
  TranscriptionResponse,
  VoiceKind,
  WorkspaceView,
} from "./lib/types";
import { stitchWavBlobs } from "./lib/wav";
import {
  DEFAULT_CONTROLS,
  createProject,
  createId,
  deleteAudioAsset,
  exportProjectArchive,
  importProjectArchive,
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
  type ScriptVersion,
  type VoicePreset,
} from "./lib/workspace";

export default function Home() {
  const [tauriReady, setTauriReady] = useState(false);
  const apiUrl = useMemo(() => {
    // tauriReady is in the dep array on purpose — once Tauri rehydrates the
    // window globals we want a fresh getApiUrl() read.
    void tauriReady;
    return getApiUrl();
  }, [tauriReady]);

  const {
    voices,
    clones,
    localModels,
    backendStatus,
    backendError,
    voicesError,
    localModelError,
    refreshClones,
    refreshBackend,
  } = useBackendStatus(apiUrl);

  const {
    projects,
    activeProjectId,
    assets,
    workspaceError,
    setAssets,
    setProjects,
    setWorkspaceError,
    setActiveProjectId,
    refreshWorkspace,
    persistProject,
    createNewProject,
    removeActiveProject,
    switchProject,
  } = useWorkspace();

  const [activeView, setActiveView] = useState<WorkspaceView>("write");
  const [projectSearch, setProjectSearch] = useState("");
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({});

  const [selectedVoiceKey, setSelectedVoiceKey] = useState("");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [engineFilter, setEngineFilter] = useState<"all" | VoiceKind>("all");
  const [performanceStyleId, setPerformanceStyleId] = useState("natural");
  const [controls, setControls] = useState<AudioControls>(() =>
    applyPerformanceStyle(DEFAULT_CONTROLS, "natural")
  );
  const [ssmlEnabled, setSsmlEnabled] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
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
  const [cloneTier, setCloneTier] = useState<"quick" | "professional">("quick");
  const [cloneAllowedUses, setCloneAllowedUses] = useState<
    Array<"personal" | "commercial" | "parody" | "internal" | "restricted">
  >(["personal"]);
  const [cloneQualityScore, setCloneQualityScore] = useState<number | null>(null);

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
  const visibleProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    return projects.filter((project) => {
      if (!query) return true;
      return (
        project.name.toLowerCase().includes(query) ||
        project.description.toLowerCase().includes(query) ||
        (project.tags || []).some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [projectSearch, projects]);

  const voiceOptions = useMemo(() => {
    const builtin = voices.map((voice) => {
      const kind: VoiceKind = voice.engine === "supertonic" ? "supertonic" : "kokoro";
      const tag = kind === "supertonic" ? "Supertonic" : "Kokoro";
      return {
        key: `${kind}:${voice.id}`,
        label: `[${tag}] ${voice.name} (${voice.language})`,
        shortLabel: voice.name,
        language: voice.locale || voice.language,
        kind,
        id: voice.id,
      };
    });
    const cloned = clones.map((clone) => ({
      key: `clone:${clone.id}`,
      label: `[Clone] ${clone.name} (${clone.language || "custom"})`,
      shortLabel: clone.name,
      language: clone.language || "custom",
      kind: "clone" as const,
      id: clone.id,
    }));
    return [...builtin, ...cloned].filter(
      (option) =>
        languageFilter === "all" ||
        option.language === languageFilter ||
        option.language === "custom"
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
          .map((voice) => {
            const kind: VoiceKind =
              voice.engine === "supertonic" ? "supertonic" : "kokoro";
            return { key: `${kind}:${voice.id}`, shortLabel: voice.name };
          })
          .find((candidate) => candidate.key === key) ||
        clones
          .map((clone) => ({ key: `clone:${clone.id}`, shortLabel: clone.name }))
          .find((candidate) => candidate.key === key);
      return option?.shortLabel || "Voice";
    },
    [clones, voiceOptions, voices]
  );

  useEffect(() => {
    let cancelled = false;
    void rehydrateTauriGlobals().finally(() => {
      if (!cancelled) setTauriReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  function updateDocumentText(value: string) {
    if (!activeProject || !activeDocument) return;
    persistProject({
      ...activeProject,
      documents: activeProject.documents.map((document) =>
        document.id === activeDocument.id
          ? { ...document, text: value, updatedAt: new Date().toISOString() }
          : document
      ),
    });
  }

  function saveScriptVersion() {
    if (!activeProject || !activeDocument) return;
    const version: ScriptVersion = {
      id: createId("scriptver"),
      documentId: activeDocument.id,
      label: `Version ${(activeProject.scriptVersions || []).length + 1}`,
      text: activeDocument.text,
      createdAt: new Date().toISOString(),
    };
    persistProject({
      ...activeProject,
      scriptVersions: [version, ...(activeProject.scriptVersions || [])].slice(0, 30),
    });
    setSuccess("Saved script restore point.");
  }

  function restoreScriptVersion(version: ScriptVersion) {
    if (!activeProject || !activeDocument) return;
    persistProject({
      ...activeProject,
      documents: activeProject.documents.map((document) =>
        document.id === activeDocument.id
          ? { ...document, text: version.text, updatedAt: new Date().toISOString() }
          : document
      ),
    });
    setSuccess(`Restored ${version.label}.`);
  }

  function updateMode(mode: Mode) {
    if (!activeProject || !activeDocument) return;
    persistProject({
      ...activeProject,
      documents: activeProject.documents.map((document) =>
        document.id === activeDocument.id
          ? { ...document, mode, updatedAt: new Date().toISOString() }
          : document
      ),
    });
  }

  function updateActiveProjectFields(fields: Partial<KuralProject>) {
    if (!activeProject) return;
    persistProject({ ...activeProject, ...fields });
  }

  async function createSampleProject() {
    const project = createProject("Offline Creator Pro sample");
    const now = new Date().toISOString();
    project.description = "A starter project for testing Kural voiceover and dubbing workflows.";
    project.tags = ["sample", "public-beta"];
    project.sourceLanguage = "en-US";
    project.targetLanguage = "hi-IN";
    project.documents = project.documents.map((document) => ({
      ...document,
      title: "Launch narration",
      text:
        "Welcome to Kural. This project shows how to write a short narration, test voice styles, translate a segment, and export local audio without sending your voice data to a cloud service.",
      updatedAt: now,
    }));
    project.dubbingSegments = [
      {
        id: createId("dub"),
        startMs: 0,
        endMs: 4200,
        speaker: "Narrator",
        sourceText: "Welcome to Kural, an offline creator workstation for voice and dubbing.",
        targetText: "Welcome to Kural, an offline creator workstation for voice and dubbing.",
        sourceLanguage: "en-US",
        targetLanguage: "hi-IN",
        voiceId: selectedVoiceKey,
        controls: { ...controls, format: "wav" },
        status: "draft",
        notes: "Sample segment",
      },
    ];
    await saveProject(project);
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    setActiveProjectId(project.id);
    storeActiveProject(project.id);
    setAssets([]);
    setActiveView("write");
    setSuccess("Created a sample Public Beta project.");
  }

  async function duplicateActiveProject() {
    if (!activeProject) return;
    const cloneMap = new Map<string, string>();
    const duplicated: KuralProject = {
      ...activeProject,
      id: createId("project"),
      name: `${activeProject.name} copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documents: activeProject.documents.map((document) => {
        const id = createId("doc");
        cloneMap.set(document.id, id);
        return { ...document, id, title: `${document.title} copy` };
      }),
      voicePresets: activeProject.voicePresets.map((preset) => ({
        ...preset,
        id: createId("preset"),
      })),
      pronunciationProfiles: activeProject.pronunciationProfiles.map((profile) => ({
        ...profile,
        id: createId("pron"),
        rules: profile.rules.map((rule) => ({ ...rule, id: createId("rule") })),
      })),
      dubbingSegments: activeProject.dubbingSegments.map((segment) => ({
        ...segment,
        id: createId("dub"),
        audioAssetId: undefined,
        status: "draft",
        alignment: undefined,
      })),
      scriptVersions: (activeProject.scriptVersions || []).map((version) => ({
        ...version,
        id: createId("scriptver"),
        documentId: cloneMap.get(version.documentId) || version.documentId,
      })),
    };
    duplicated.activeDocumentId =
      cloneMap.get(activeProject.activeDocumentId) || duplicated.documents[0]?.id || "";
    duplicated.activePronunciationProfileId = duplicated.pronunciationProfiles[0]?.id || "";
    await saveProject(duplicated);
    setProjects((current) => [duplicated, ...current]);
    setActiveProjectId(duplicated.id);
    storeActiveProject(duplicated.id);
    setAssets([]);
    setSuccess("Duplicated project without generated audio assets.");
  }

  async function synthesizeText(
    text: string,
    segment?: DubbingSegment
  ): Promise<{ blob: Blob; format: OutputFormat }> {
    if (!activeProject || !activeProfile) throw new Error("Workspace is still loading");
    const voiceKey = segment?.voiceId || selectedVoiceKey;
    if (!voiceKey) throw new Error("Choose a voice before generating audio");
    const selected = parseVoiceKey(voiceKey);
    const activeControls = segment?.controls ?? controls;
    const prepared = segment
      ? { text, ssml: false }
      : prepareTextForPerformance(text, performanceStyleId, ssmlEnabled);
    const body = {
      text: prepared.text,
      voice: selected.kind === "clone" ? "af_bella" : selected.id,
      voice_id: selected.kind === "clone" ? selected.id : undefined,
      speed: activeControls.speed,
      format: activeControls.format,
      ssml: prepared.ssml,
      controls: toApiControls(activeControls),
      pronunciation_rules: toApiRules(activeProfile.rules),
      language: activeProject.targetLanguage,
    };

    const res = await apiFetch(`${apiUrl}/api/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readApiError(res));
    const blob = await res.blob();
    const isMp3 = (res.headers.get("content-type") || "").includes("mpeg");
    return { blob, format: isMp3 ? "mp3" : activeControls.format };
  }

  function playProgressiveChunk(chunkBlob: Blob, queue: { audio: HTMLAudioElement | null }) {
    const url = URL.createObjectURL(chunkBlob);
    const playNext = () => {
      const audio = new Audio(url);
      queue.audio = audio;
      audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      void audio.play().catch(() => {
        // Autoplay can be blocked on fresh tabs; downloading still works.
        URL.revokeObjectURL(url);
      });
    };
    if (queue.audio && !queue.audio.ended) {
      queue.audio.addEventListener("ended", playNext, { once: true });
    } else {
      playNext();
    }
  }

  async function generateSelectedScriptAudio(text: string) {
    if (!activeProject) return;
    const cleanText = text.trim();
    if (!cleanText) {
      setError("Select a line or place the cursor inside a line before generating.");
      return;
    }
    setIsGenerating(true);
    setError("");
    setSuccess("");
    try {
      const { blob, format } = await synthesizeText(cleanText);
      const asset: AudioAsset = {
        id: createId("asset"),
        projectId: activeProject.id,
        name: `Selected line - ${cleanText.slice(0, 36)}`,
        text: cleanText,
        voiceLabel: selectedVoiceLabel(selectedVoiceKey),
        format,
        createdAt: new Date().toISOString(),
        bytes: blob.size,
        blob,
        language: activeProject.targetLanguage,
        controls,
      };
      await saveAudioAsset(asset);
      setAssets((current) => [asset, ...current]);
      setActiveView("library");
      setSuccess("Generated selected script line into the audio library.");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not generate selected line");
    } finally {
      setIsGenerating(false);
    }
  }

  async function synthesizeAgentResponse(text: string): Promise<Blob> {
    if (!activeProject) throw new Error("Workspace is still loading");
    const { blob, format } = await synthesizeText(text);
    const asset: AudioAsset = {
      id: createId("asset"),
      projectId: activeProject.id,
      name: `Agent response - ${text.slice(0, 36)}`,
      text,
      voiceLabel: selectedVoiceLabel(selectedVoiceKey),
      format,
      createdAt: new Date().toISOString(),
      bytes: blob.size,
      blob,
      language: activeProject.targetLanguage,
      controls,
    };
    await saveAudioAsset(asset);
    setAssets((current) => [asset, ...current]);
    return blob;
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
      const playbackQueue: { audio: HTMLAudioElement | null } = { audio: null };

      for (const item of items) {
        const chunks =
          !ssmlEnabled && controls.format === "wav" && item.length > SYNTH_CHUNK_LIMIT
            ? splitLongText(item)
            : [item];
        const generated: Array<{ blob: Blob; format: OutputFormat }> = [];
        for (const chunk of chunks) {
          const part = await synthesizeText(chunk);
          generated.push(part);
          // Progressive playback: start playing the first chunk while later
          // chunks are still synthesizing. WAV-only because MP3 chunks would
          // need decoding before playback.
          if (chunks.length > 1 && part.format === "wav") {
            playProgressiveChunk(part.blob, playbackQueue);
          }
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

  async function renderQualitySample(request: QualityRenderRequest): Promise<QualityResult> {
    if (!activeProject || !activeProfile) throw new Error("Workspace is still loading");
    const selected = parseVoiceKey(request.voiceKey);
    const prepared = prepareTextForPerformance(request.text, request.styleId, false);
    const body = {
      text: prepared.text,
      voice: selected.kind === "clone" ? "af_bella" : selected.id,
      voice_id: selected.kind === "clone" ? selected.id : undefined,
      speed: request.controls.speed,
      format: request.controls.format,
      ssml: prepared.ssml,
      controls: toApiControls(request.controls),
      pronunciation_rules: toApiRules(activeProfile.rules),
      language: activeProject.targetLanguage,
    };
    const res = await apiFetch(`${apiUrl}/api/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readApiError(res));
    const blob = await res.blob();
    const isMp3 = (res.headers.get("content-type") || "").includes("mpeg");
    const format: OutputFormat = isMp3 ? "mp3" : request.controls.format;
    const style = getPerformanceStyle(request.styleId);
    const asset: AudioAsset = {
      id: createId("asset"),
      projectId: activeProject.id,
      name: `Quality ${style.label}`,
      text: request.text,
      voiceLabel: selectedVoiceLabel(request.voiceKey),
      format,
      createdAt: new Date().toISOString(),
      bytes: blob.size,
      blob,
      language: activeProject.targetLanguage,
      controls: request.controls,
    };
    await saveAudioAsset(asset);
    setAssets((current) => [asset, ...current]);
    return {
      id: asset.id,
      label: style.label,
      styleId: request.styleId,
      voiceKey: request.voiceKey,
      voiceLabel: asset.voiceLabel,
      controls: request.controls,
      blob,
      format,
      bytes: blob.size,
    };
  }

  function useQualitySample(result: QualityResult) {
    setSelectedVoiceKey(result.voiceKey);
    setControls(result.controls);
    setPerformanceStyleId(result.styleId);
    setSuccess(`Applied ${result.label} settings from Quality Studio.`);
    setActiveView("write");
  }

  function updatePronunciationProfile(profile: PronunciationProfile) {
    if (!activeProject) return;
    persistProject({
      ...activeProject,
      pronunciationProfiles: activeProject.pronunciationProfiles.map((candidate) =>
        candidate.id === profile.id
          ? { ...profile, updatedAt: new Date().toISOString() }
          : candidate
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
      rules: activeProfile.rules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...fields } : rule
      ),
    });
  }

  function deleteRule(ruleId: string) {
    if (!activeProfile) return;
    updatePronunciationProfile({
      ...activeProfile,
      rules: activeProfile.rules.filter((rule) => rule.id !== ruleId),
    });
  }

  function exportActivePronunciationProfile() {
    if (!activeProject || !activeProfile) return;
    const payload = {
      schemaVersion: 1,
      kind: "kural-pronunciation-profile",
      exportedAt: new Date().toISOString(),
      projectName: activeProject.name,
      profile: activeProfile,
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `${activeProfile.name || "pronunciation-profile"}.json`
    );
  }

  async function importPronunciationProfile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeProject) return;
    try {
      const raw = JSON.parse(await file.text());
      const candidate = raw?.profile || raw;
      if (!candidate || !Array.isArray(candidate.rules)) {
        throw new Error("Pronunciation profile JSON must include a rules array.");
      }
      const profile: PronunciationProfile = {
        id: createId("pron"),
        name: `${String(candidate.name || file.name).replace(/\.json$/i, "")} import`,
        language: String(candidate.language || activeProject.targetLanguage || ""),
        previewText: String(candidate.previewText || ""),
        glossary: Array.isArray(candidate.glossary)
          ? candidate.glossary.map((item: Record<string, unknown>) => ({
              term: String(item.term || ""),
              pronunciation: String(item.pronunciation || ""),
              language: String(item.language || candidate.language || activeProject.targetLanguage || ""),
              notes: item.notes ? String(item.notes) : undefined,
            }))
          : [],
        rules: candidate.rules.map((rule: Record<string, unknown>, index: number) => ({
          id: createId("rule"),
          pattern: String(rule.pattern || ""),
          replacement: String(rule.replacement || ""),
          mode: rule.mode === "literal" ? "literal" : "word",
          caseSensitive: Boolean(rule.caseSensitive ?? rule.case_sensitive),
          language: String(rule.language || ""),
          enabled: rule.enabled !== false,
          priority: Number(rule.priority || index + 1),
        })),
        updatedAt: new Date().toISOString(),
      };
      persistProject({
        ...activeProject,
        activePronunciationProfileId: profile.id,
        pronunciationProfiles: [...activeProject.pronunciationProfiles, profile],
      });
      setSuccess(`Imported pronunciation profile ${profile.name}.`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not import pronunciation profile.");
    }
  }

  async function renderPronunciationPreview() {
    if (!activeProject || !activeProfile) return;
    const text = activeProfile.previewText.trim();
    if (!text) {
      setError("Add preview text before rendering pronunciation audio.");
      return;
    }
    try {
      setError("");
      const { blob, format } = await synthesizeText(text);
      const asset: AudioAsset = {
        id: createId("asset"),
        projectId: activeProject.id,
        name: `Pronunciation preview - ${activeProfile.name}`,
        text,
        voiceLabel: selectedVoiceLabel(selectedVoiceKey),
        format,
        createdAt: new Date().toISOString(),
        bytes: blob.size,
        blob,
        language: activeProject.targetLanguage,
        controls,
      };
      await saveAudioAsset(asset);
      setAssets((current) => [asset, ...current]);
      setActiveView("library");
      setSuccess("Rendered pronunciation preview to the audio library.");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not render pronunciation preview.");
    }
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
    setPerformanceStyleId("custom");
  }

  function updatePerformanceStyle(styleId: string) {
    setPerformanceStyleId(styleId);
    if (styleId === "custom") return;
    setControls((current) => applyPerformanceStyle(current, styleId));
  }

  function updateControls(nextControls: AudioControls) {
    setPerformanceStyleId("custom");
    setControls(nextControls);
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
          document.id === activeProject.activeDocumentId
            ? { ...document, mode: "dubbing" }
            : document
        ),
      });
      setActiveView("dubbing");
      setSuccess(
        `Imported ${imported.length} dubbing segment${imported.length === 1 ? "" : "s"}.`
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not import transcript");
    }
  }

  async function transcribeMediaFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeProject) return;

    setIsTranscribing(true);
    setError("");
    setSuccess("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("language", activeProject.sourceLanguage);
      const res = await apiFetch(`${apiUrl}/api/transcribe`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = (await res.json()) as TranscriptionResponse;
      const rawSegments =
        data.segments.length > 0
          ? data.segments
          : data.text.trim()
            ? [{ start_ms: 0, end_ms: Math.max(1500, data.text.length * 60), text: data.text }]
            : [];
      const imported = rawSegments
        .filter((segment) => segment.text.trim())
        .map((segment, index) => {
          const startMs = Math.max(0, segment.start_ms || index * 3000);
          const endMs =
            segment.end_ms > startMs
              ? segment.end_ms
              : startMs + Math.max(1500, segment.text.trim().length * 60);
          return {
            id: createId("dub"),
            startMs,
            endMs,
            sourceText: segment.text.trim(),
            targetText: segment.text.trim(),
            speaker: segment.speaker || "Speaker 1",
            sourceLanguage: data.language || activeProject.sourceLanguage,
            targetLanguage: activeProject.targetLanguage,
            voiceId: selectedVoiceKey,
            controls: { ...controls, format: "wav" as const },
            status: "draft" as const,
            notes: `ASR: ${data.provider}`,
          };
        });
      if (imported.length === 0) throw new Error("No speech segments found");
      persistProject({
        ...activeProject,
        dubbingSegments: imported,
        documents: activeProject.documents.map((document) =>
          document.id === activeProject.activeDocumentId
            ? { ...document, mode: "dubbing" }
            : document
        ),
      });
      setActiveView("dubbing");
      setSuccess(
        `Transcribed ${imported.length} segment${imported.length === 1 ? "" : "s"} with ${data.provider}.`
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not transcribe media");
    } finally {
      setIsTranscribing(false);
    }
  }

  async function requestTranslation(text: string, sourceLanguage: string, targetLanguage: string) {
    const res = await apiFetch(`${apiUrl}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
        glossary: (activeProfile?.glossary || []).map((item) => ({
          term: item.term,
          replacement: item.pronunciation,
          language: item.language || targetLanguage,
          case_sensitive: false,
        })),
      }),
    });
    if (!res.ok) throw new Error(await readApiError(res));
    return (await res.json()) as { text: string; provider: string };
  }

  async function translateSegment(segment: DubbingSegment) {
    if (!activeProject || !segment.sourceText.trim()) return;
    setIsTranslating(true);
    setError("");
    setSuccess("");
    try {
      const result = await requestTranslation(
        segment.sourceText,
        segment.sourceLanguage || activeProject.sourceLanguage,
        segment.targetLanguage || activeProject.targetLanguage
      );
      updateSegment(segment.id, {
        targetText: result.text,
        targetLanguage: activeProject.targetLanguage,
        error: undefined,
        notes: segment.notes
          ? `${segment.notes}; MT: ${result.provider}`
          : `MT: ${result.provider}`,
      });
      setSuccess(`Translated segment with ${result.provider}.`);
    } catch (exc) {
      updateSegment(segment.id, {
        error: exc instanceof Error ? exc.message : "Could not translate segment",
      });
      setError(exc instanceof Error ? exc.message : "Could not translate segment");
    } finally {
      setIsTranslating(false);
    }
  }

  async function translateAllSegments() {
    if (!activeProject || activeProject.dubbingSegments.length === 0) return;
    setIsTranslating(true);
    setError("");
    setSuccess("");
    try {
      const translated: DubbingSegment[] = [];
      let provider = "local";
      for (const segment of activeProject.dubbingSegments) {
        if (!segment.sourceText.trim()) {
          translated.push(segment);
          continue;
        }
        const result = await requestTranslation(
          segment.sourceText,
          segment.sourceLanguage || activeProject.sourceLanguage,
          activeProject.targetLanguage
        );
        provider = result.provider;
        translated.push({
          ...segment,
          targetText: result.text,
          targetLanguage: activeProject.targetLanguage,
          error: undefined,
          notes: segment.notes
            ? `${segment.notes}; MT: ${result.provider}`
            : `MT: ${result.provider}`,
        });
      }
      persistProject({ ...activeProject, dubbingSegments: translated });
      setSuccess(
        `Translated ${translated.length} segment${translated.length === 1 ? "" : "s"} with ${provider}.`
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not translate segments");
    } finally {
      setIsTranslating(false);
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

  function splitSegment(segment: DubbingSegment) {
    if (!activeProject) return;
    const midpoint = Math.max(segment.startMs + 500, Math.floor((segment.startMs + segment.endMs) / 2));
    const sourceParts = segment.sourceText.split(/(?<=[.!?])\s+/);
    const targetParts = segment.targetText.split(/(?<=[.!?])\s+/);
    const sourceLeft =
      sourceParts.length > 1 ? sourceParts.slice(0, Math.ceil(sourceParts.length / 2)).join(" ") : segment.sourceText;
    const sourceRight =
      sourceParts.length > 1 ? sourceParts.slice(Math.ceil(sourceParts.length / 2)).join(" ") : "";
    const targetLeft =
      targetParts.length > 1 ? targetParts.slice(0, Math.ceil(targetParts.length / 2)).join(" ") : segment.targetText;
    const targetRight =
      targetParts.length > 1 ? targetParts.slice(Math.ceil(targetParts.length / 2)).join(" ") : "";
    const replacement: DubbingSegment[] = [
      {
        ...segment,
        endMs: midpoint,
        sourceText: sourceLeft,
        targetText: targetLeft,
        audioAssetId: undefined,
        alignment: undefined,
        status: "draft",
      },
      {
        ...segment,
        id: createId("dub"),
        startMs: midpoint,
        sourceText: sourceRight || segment.sourceText,
        targetText: targetRight || segment.targetText,
        audioAssetId: undefined,
        alignment: undefined,
        status: "draft",
        notes: segment.notes ? `${segment.notes}; split` : "split",
      },
    ];
    persistProject({
      ...activeProject,
      dubbingSegments: activeProject.dubbingSegments.flatMap((candidate) =>
        candidate.id === segment.id ? replacement : [candidate]
      ),
    });
  }

  function mergeSegmentWithNext(segment: DubbingSegment) {
    if (!activeProject) return;
    const sorted = [...activeProject.dubbingSegments].sort((a, b) => a.startMs - b.startMs);
    const index = sorted.findIndex((candidate) => candidate.id === segment.id);
    const next = sorted[index + 1];
    if (!next) return;
    const merged: DubbingSegment = {
      ...segment,
      endMs: Math.max(segment.endMs, next.endMs),
      sourceText: `${segment.sourceText.trim()} ${next.sourceText.trim()}`.trim(),
      targetText: `${segment.targetText.trim()} ${next.targetText.trim()}`.trim(),
      notes: [segment.notes, next.notes, "merged"].filter(Boolean).join("; "),
      audioAssetId: undefined,
      alignment: undefined,
      status: "draft",
    };
    persistProject({
      ...activeProject,
      dubbingSegments: sorted.map((candidate) =>
        candidate.id === segment.id ? merged : candidate
      ).filter((candidate) => candidate.id !== next.id),
    });
  }

  function applySuggestedSegmentSpeed(segment: DubbingSegment) {
    if (!segment.alignment) return;
    const slotMs = Math.max(1, segment.endMs - segment.startMs);
    const suggested = Math.min(
      2,
      Math.max(0.5, segment.controls.speed * (segment.alignment.durationMs / slotMs))
    );
    updateSegment(segment.id, {
      controls: { ...segment.controls, speed: Number(suggested.toFixed(2)) },
      notes: `${segment.notes ? `${segment.notes}; ` : ""}Speed adjusted from alignment`,
    });
  }

  function applySpeakerVoice(speaker: string, voiceId: string) {
    if (!activeProject) return;
    persistProject({
      ...activeProject,
      dubbingSegments: activeProject.dubbingSegments.map((segment) =>
        (segment.speaker || "Speaker 1") === speaker
          ? {
              ...segment,
              voiceId,
              audioAssetId: undefined,
              alignment: undefined,
              status: "draft",
              notes: `${segment.notes ? `${segment.notes}; ` : ""}Speaker voice updated`,
            }
          : segment
      ),
    });
  }

  function applySpeakerSpeed(speaker: string, speed: number) {
    if (!activeProject) return;
    const nextSpeed = Math.min(2, Math.max(0.5, Number.isFinite(speed) ? speed : 1));
    persistProject({
      ...activeProject,
      dubbingSegments: activeProject.dubbingSegments.map((segment) =>
        (segment.speaker || "Speaker 1") === speaker
          ? {
              ...segment,
              controls: { ...segment.controls, speed: Number(nextSpeed.toFixed(2)) },
              audioAssetId: undefined,
              alignment: undefined,
              status: "draft",
            }
          : segment
      ),
    });
  }

  function inferDubbingSpeakers() {
    if (!activeProject) return;
    persistProject({
      ...activeProject,
      dubbingSegments: activeProject.dubbingSegments.map((segment) => {
        const source = inferSpeakerFromText(segment.sourceText);
        const target = inferSpeakerFromText(segment.targetText);
        const speaker =
          source.speaker !== "Speaker 1"
            ? source.speaker
            : target.speaker !== "Speaker 1"
              ? target.speaker
              : segment.speaker || "Speaker 1";
        return {
          ...segment,
          speaker,
          sourceText: source.text || segment.sourceText,
          targetText: target.text || segment.targetText,
          notes: `${segment.notes ? `${segment.notes}; ` : ""}speaker inferred`,
        };
      }),
    });
    setSuccess("Inferred speaker labels from transcript text.");
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
      void alignSegment({ ...segment, status: "ready", audioAssetId: asset.id }, asset);
    } catch (exc) {
      updateSegment(segment.id, {
        status: "error",
        error: exc instanceof Error ? exc.message : "Could not render segment",
      });
    }
  }

  async function renderAllSegments() {
    if (!activeProject) return;
    for (const segment of activeProject.dubbingSegments) {
      if (segment.status === "rendering") continue;
      await renderSegment(segment);
    }
  }

  async function retryFailedSegments() {
    if (!activeProject) return;
    for (const segment of activeProject.dubbingSegments.filter((item) => item.status === "error")) {
      await renderSegment(segment);
    }
  }

  async function alignSegment(segment: DubbingSegment, suppliedAsset?: AudioAsset) {
    if (!activeProject) return;
    const asset =
      suppliedAsset || assets.find((candidate) => candidate.id === segment.audioAssetId);
    if (!asset) {
      updateSegment(segment.id, { error: "Render this segment before alignment." });
      return;
    }
    try {
      const form = new FormData();
      form.append("file", asset.blob, `${asset.name}.${asset.format}`);
      form.append("expected_text", segment.targetText || segment.sourceText);
      form.append("expected_duration_ms", String(segment.endMs - segment.startMs));
      form.append("language", segment.targetLanguage || activeProject.targetLanguage);
      const res = await apiFetch(`${apiUrl}/api/align`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = (await res.json()) as AlignmentResponse;
      const suggestedSpeed =
        data.overrun_ms && data.expected_duration_ms && data.expected_duration_ms > 0
          ? Math.min(
              2,
              Math.max(
                0.5,
                segment.controls.speed *
                  (data.duration_ms / Math.max(1, data.expected_duration_ms))
              )
            )
          : segment.controls.speed;
      updateSegment(segment.id, {
        alignment: {
          provider: data.provider,
          durationMs: data.duration_ms,
          overrunMs: data.overrun_ms || 0,
          words: data.words.map((word) => ({
            text: word.text,
            startMs: word.start_ms,
            endMs: word.end_ms,
            probability: word.probability,
          })),
          checkedAt: new Date().toISOString(),
        },
        notes:
          data.overrun_ms && data.overrun_ms > 0
            ? `${segment.notes ? `${segment.notes}; ` : ""}Align: try speed ${suggestedSpeed.toFixed(2)}`
            : segment.notes,
      });
      setSuccess(
        data.overrun_ms && data.overrun_ms > 0
          ? `Alignment found an overrun. Try speed ${suggestedSpeed.toFixed(2)}.`
          : "Alignment check passed."
      );
    } catch (exc) {
      updateSegment(segment.id, {
        error: exc instanceof Error ? exc.message : "Could not align segment",
      });
      setError(exc instanceof Error ? exc.message : "Could not align segment");
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
      downloadBlob(
        new Blob(
          [
            JSON.stringify(
              {
                app: "Kural",
                kind: "synthetic-audio-provenance",
                exportedAt: new Date().toISOString(),
                projectId: activeProject.id,
                projectName: activeProject.name,
                segments: activeProject.dubbingSegments.map((segment) => ({
                  id: segment.id,
                  speaker: segment.speaker,
                  voiceId: segment.voiceId,
                  sourceLanguage: segment.sourceLanguage,
                  targetLanguage: segment.targetLanguage,
                  startMs: segment.startMs,
                  endMs: segment.endMs,
                  audioAssetId: segment.audioAssetId,
                })),
              },
              null,
              2
            ),
          ],
          { type: "application/json" }
        ),
        `${activeProject.name || "kural"}-dubbing.provenance.json`
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not export dubbing timeline");
    }
  }

  function exportDubbingTranscript(format: "srt" | "vtt" | "csv") {
    if (!activeProject || activeProject.dubbingSegments.length === 0) return;
    const sorted = [...activeProject.dubbingSegments].sort((a, b) => a.startMs - b.startMs);
    const text =
      format === "srt"
        ? exportSegmentsAsSrt(sorted)
        : format === "vtt"
          ? exportSegmentsAsVtt(sorted)
          : exportSegmentsAsCsv(sorted);
    const mime = format === "csv" ? "text/csv" : "text/plain";
    downloadBlob(new Blob([text], { type: mime }), `${activeProject.name || "kural"}.${format}`);
  }

  function exportDubbingRenderPlan() {
    if (!activeProject) return;
    const sorted = [...activeProject.dubbingSegments].sort((a, b) => a.startMs - b.startMs);
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            {
              schemaVersion: 1,
              kind: "kural-dubbing-render-plan",
              exportedAt: new Date().toISOString(),
              projectId: activeProject.id,
              projectName: activeProject.name,
              targetLanguage: activeProject.targetLanguage,
              ffmpeg: {
                muxedMp4: "Use rendered WAV timeline plus original video in ffmpeg when available.",
                commandHint:
                  "ffmpeg -i original.mp4 -i kural-dubbing.wav -map 0:v:0 -map 1:a:0 -c:v copy -shortest dubbed.mp4",
              },
              segments: sorted.map((segment) => ({
                id: segment.id,
                startMs: segment.startMs,
                endMs: segment.endMs,
                speaker: segment.speaker,
                voiceId: segment.voiceId,
                sourceText: segment.sourceText,
                targetText: segment.targetText,
                status: segment.status,
                audioAssetId: segment.audioAssetId,
                alignment: segment.alignment,
              })),
            },
            null,
            2
          ),
        ],
        { type: "application/json" }
      ),
      `${activeProject.name || "kural"}-render-plan.json`
    );
  }

  function exportDubbingMuxScript() {
    if (!activeProject) return;
    const projectSlug = (activeProject.name || "kural")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "kural";
    const script = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "",
      "# Kural Dubbing Pro mux helper",
      "# 1. Export the WAV timeline from Kural as kural-dubbing.wav",
      "# 2. Put the original media next to this script as original.mp4",
      "# 3. Run: bash ./kural-mux.sh",
      "",
      'ORIGINAL="${1:-original.mp4}"',
      `DUBBED_WAV="\${2:-${projectSlug}-dubbing.wav}"`,
      `OUTPUT="\${3:-${projectSlug}-dubbed.mp4}"`,
      "",
      'ffmpeg -y -i "$ORIGINAL" -i "$DUBBED_WAV" \\',
      '  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest "$OUTPUT"',
      "",
      `echo "Wrote $OUTPUT"`,
    ].join("\n");
    downloadBlob(new Blob([script], { type: "text/x-shellscript" }), `${projectSlug}-mux.sh`);
  }

  async function exportDubbingMuxMp4(event: ChangeEvent<HTMLInputElement>) {
    const original = event.target.files?.[0];
    event.target.value = "";
    if (!activeProject || !original) return;
    const rendered = activeProject.dubbingSegments
      .filter((segment) => segment.audioAssetId)
      .sort((a, b) => a.startMs - b.startMs)
      .map((segment) => assets.find((asset) => asset.id === segment.audioAssetId))
      .filter((asset): asset is AudioAsset => Boolean(asset));
    if (rendered.length === 0) {
      setError("Render at least one dubbing segment before exporting MP4.");
      return;
    }
    if (rendered.some((asset) => asset.format !== "wav")) {
      setError("MP4 export needs a WAV timeline. Re-render non-WAV segments as WAV.");
      return;
    }
    try {
      setError("");
      const wav = await stitchWavBlobs(rendered.map((asset) => asset.blob));
      const form = new FormData();
      form.append("original", original);
      form.append("dubbed_audio", wav, `${activeProject.name || "kural"}-dubbing.wav`);
      form.append("output_name", `${activeProject.name || "kural"}-dubbed.mp4`);
      const res = await apiFetch(`${apiUrl}/api/mux`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await readApiError(res));
      downloadBlob(await res.blob(), `${activeProject.name || "kural"}-dubbed.mp4`);
      setSuccess("Exported muxed MP4 with local ffmpeg.");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not export MP4");
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

  async function saveActiveProjectSnapshot() {
    if (!activeProject) return;
    const blob = await exportProjectArchive(activeProject, assets);
    const fileName = `${activeProject.name || "kural"}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.kuralproj`;
    const savedPath = await saveProjectArchiveToVault(fileName, blob);
    if (!savedPath) {
      downloadBlob(blob, fileName);
      setWorkspaceError("Desktop vault is unavailable here, so the snapshot was downloaded.");
      return;
    }
    const next: KuralProject = {
      ...activeProject,
      vaultPath: savedPath,
      lastSnapshotAt: new Date().toISOString(),
      snapshotCount: (activeProject.snapshotCount || 0) + 1,
    };
    persistProject(next);
    setSuccess(`Saved project snapshot to ${savedPath}`);
  }

  function exportConsentLedger() {
    if (!activeProject) return;
    const payload = {
      schemaVersion: 1,
      kind: "kural-consent-ledger",
      exportedAt: new Date().toISOString(),
      project: {
        id: activeProject.id,
        name: activeProject.name,
        targetLanguage: activeProject.targetLanguage,
        tags: activeProject.tags,
      },
      localRuntime: {
        apiUrl,
        localOnly: apiUrl.includes("127.0.0.1") || apiUrl.includes("localhost"),
      },
      clones: clones.map((clone) => ({
        id: clone.id,
        name: clone.name,
        engine: clone.engine,
        language: clone.language,
        locale: clone.locale,
        createdAt: clone.created_at,
        durationSeconds: clone.duration_s,
        consentConfirmed: Boolean(clone.consent_confirmed),
        watermark: clone.watermark,
        allowedUses: clone.allowed_uses || ["personal"],
        cloneTier: clone.clone_tier || "quick",
        qualityScore: clone.quality_score,
        sampleSha256: clone.sample_sha256,
      })),
      generatedAssets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        voiceLabel: asset.voiceLabel,
        language: asset.language,
        format: asset.format,
        bytes: asset.bytes,
        createdAt: asset.createdAt,
        dubbingSegmentId: asset.dubbingSegmentId,
      })),
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `${activeProject.name || "kural"}-consent-ledger.json`
    );
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
      form.append("clone_tier", cloneTier);
      cloneAllowedUses.forEach((use) => form.append("allowed_uses", use));
      if (cloneQualityScore !== null) {
        form.append("quality_score", String(cloneQualityScore));
      }
      const res = await apiFetch(`${apiUrl}/api/voices/clone`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await readApiError(res));
      await refreshClones();
      setCloneName("");
      setCloneFile(null);
      setCloneConsent(false);
      setCloneTier("quick");
      setCloneAllowedUses(["personal"]);
      setCloneQualityScore(null);
      setCloneMessage("Cloned voice is ready.");
    } catch (exc) {
      setCloneMessage(exc instanceof Error ? exc.message : "Could not clone voice");
    } finally {
      setCloneBusy(false);
    }
  }

  async function deleteClone(voiceId: string) {
    const res = await apiFetch(`${apiUrl}/api/voices/clones/${voiceId}`, { method: "DELETE" });
    if (res.ok) {
      await refreshClones();
    }
  }

  async function exportClones() {
    const res = await apiFetch(`${apiUrl}/api/voices/clones/export`);
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
    const res = await apiFetch(`${apiUrl}/api/voices/clones/import`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      setCloneMessage(await readApiError(res));
      return;
    }
    const data = await res.json();
    await refreshClones();
    setCloneMessage(`Imported ${data.total} cloned voice${data.total === 1 ? "" : "s"}.`);
  }

  const mode: Mode = activeDocument?.mode === "batch" ? "batch" : "single";
  const previewText = activeProfile
    ? applyPronunciationPreview(
        activeProfile.previewText,
        activeProfile.rules,
        activeProject?.targetLanguage || ""
      )
    : "";

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to workspace
      </a>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 lg:flex-row">
        <aside
          className="w-full shrink-0 rounded border border-slate-300 bg-white p-3 lg:w-72"
          aria-label="Project navigator"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Workspace</p>
              <h1 className="text-xl font-semibold">Kural</h1>
            </div>
            <button
              type="button"
              className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400"
              onClick={createNewProject}
            >
              New
            </button>
          </div>

          <input
            className="mb-3 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={projectSearch}
            onChange={(event) => setProjectSearch(event.target.value)}
            placeholder="Search projects or tags"
            aria-label="Search projects"
          />

          <div className="space-y-2" role="list">
            {visibleProjects.map((project) => (
              <button
                type="button"
                key={project.id}
                role="listitem"
                aria-current={project.id === activeProjectId ? "true" : "false"}
                className={`w-full rounded border px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                  project.id === activeProjectId
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"
                }`}
                onClick={() => void switchProject(project.id)}
              >
                <span className="block font-medium">{project.name}</span>
                <span className="block text-xs opacity-75">
                  {project.targetLanguage}
                  {project.archived ? " / archived" : ""}
                </span>
              </button>
            ))}
            {visibleProjects.length === 0 && (
              <p className="rounded border border-slate-200 p-3 text-sm text-slate-500">
                No projects match this search.
              </p>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              onClick={exportActiveProject}
            >
              Export
            </button>
            <label className="cursor-pointer rounded border border-slate-300 px-2 py-2 text-center text-sm focus-within:ring-2 focus-within:ring-slate-400">
              Import
              <input
                className="hidden"
                type="file"
                accept=".kuralproj,.zip"
                onChange={importProjectFile}
              />
            </label>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              disabled={!activeProject}
              onClick={() => void duplicateActiveProject()}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="rounded border border-red-300 px-2 py-2 text-sm text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:opacity-40"
              disabled={projects.length <= 1}
              onClick={() => void removeActiveProject(activeProject)}
            >
              Delete Project
            </button>
          </div>

          <LocalRuntimeStatus
            apiUrl={apiUrl}
            backendError={backendError}
            backendStatus={backendStatus}
            onRefresh={refreshBackend}
          />
          {workspaceError && (
            <div className="mt-3 rounded border border-red-200 p-3 text-xs text-red-700">
              <p className="mt-2 text-red-700" role="alert">
                {workspaceError}
              </p>
            </div>
          )}
        </aside>

        <section id="workspace" className="min-w-0 flex-1" aria-label="Workspace">
          <SetupBanner apiUrl={apiUrl} />
          <FirstRunWizard
            backendError={backendError}
            backendStatus={backendStatus}
            clones={clones}
            models={localModels}
            onCreateSampleProject={() => void createSampleProject()}
            onOpenModels={() => setActiveView("models")}
            onRefresh={refreshBackend}
          />
          <div className="rounded border border-slate-300 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_1fr_1fr]">
                <label className="text-sm">
                  Project name
                  <input
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    value={activeProject?.name || ""}
                    onChange={(event) =>
                      updateActiveProjectFields({ name: event.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Source
                  <input
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    value={activeProject?.sourceLanguage || "en-US"}
                    onChange={(event) =>
                      updateActiveProjectFields({ sourceLanguage: event.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Target
                  <input
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    value={activeProject?.targetLanguage || "en-US"}
                    onChange={(event) =>
                      updateActiveProjectFields({ targetLanguage: event.target.value })
                    }
                  />
                </label>
              </div>
              <WorkspaceTabs activeView={activeView} onViewChange={setActiveView} />
            </div>

            {activeView === "write" && (!activeProject || !activeDocument) && (
              <div className="p-4 text-sm text-slate-500" role="status" aria-live="polite">
                Loading workspace...
              </div>
            )}

            {activeView === "write" && activeProject && activeDocument && (
              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={mode === "single"}
                      className={`rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                        mode === "single"
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-300"
                      }`}
                      onClick={() => updateMode("single")}
                    >
                      Single
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === "batch"}
                      className={`rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                        mode === "batch"
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-300"
                      }`}
                      onClick={() => updateMode("batch")}
                    >
                      Batch
                    </button>
                  </div>

                  <ScriptStudio
                    mode={mode}
                    ssmlEnabled={ssmlEnabled}
                    text={activeDocument?.text || ""}
                    versions={(activeProject.scriptVersions || []).filter(
                      (version) => version.documentId === activeDocument.id
                    )}
                    onGenerateSelection={(value) => void generateSelectedScriptAudio(value)}
                    onRestoreVersion={restoreScriptVersion}
                    onSaveVersion={saveScriptVersion}
                    onSsmlEnabledChange={setSsmlEnabled}
                    onTextChange={updateDocumentText}
                  />

                  {error && (
                    <p
                      className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                      role="alert"
                      aria-live="assertive"
                    >
                      {error}
                    </p>
                  )}
                  {success && (
                    <p
                      className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                      role="status"
                      aria-live="polite"
                    >
                      {success}
                    </p>
                  )}

                  <button
                    type="button"
                    className="rounded bg-emerald-700 px-4 py-3 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50"
                    disabled={isGenerating || !selectedVoiceKey}
                    onClick={() => void generateAudio()}
                    aria-busy={isGenerating}
                  >
                    {isGenerating
                      ? "Generating..."
                      : mode === "batch"
                        ? "Generate Batch"
                        : "Generate Audio"}
                  </button>
                </div>

                <div className="space-y-4">
                  <ControlPanel
                    controls={controls}
                    languageFilter={languageFilter}
                    languages={allLanguages}
                    performanceStyleId={performanceStyleId}
                    performanceStyles={PERFORMANCE_STYLES}
                    selectedVoiceKey={selectedVoiceKey}
                    voiceOptions={voiceOptions}
                    onControlsChange={updateControls}
                    onLanguageFilterChange={setLanguageFilter}
                    onPerformanceStyleChange={updatePerformanceStyle}
                    onVoiceChange={setSelectedVoiceKey}
                  />

                  <section
                    className="rounded border border-slate-300 p-3"
                    aria-labelledby="presets-heading"
                  >
                    <h2 id="presets-heading" className="mb-2 font-semibold">Voice Presets</h2>
                    <div className="flex gap-2">
                      <input
                        className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        value={presetName}
                        onChange={(event) => setPresetName(event.target.value)}
                        placeholder="Preset name"
                        aria-label="Preset name"
                      />
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        onClick={saveVoicePreset}
                      >
                        Save
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {activeProject?.voicePresets.map((preset) => (
                        <button
                          type="button"
                          key={preset.id}
                          className="w-full rounded border border-slate-200 px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
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

                  <AudioLibrary
                    assets={assets}
                    audioUrls={audioUrls}
                    onDelete={(id) => void deleteAsset(id)}
                  />
                </div>
              </div>
            )}

            {activeView === "quality" && activeProject && activeDocument && (
              <div className="p-4">
                <QualityStudio
                  controls={controls}
                  defaultText={activeDocument.text}
                  performanceStyles={PERFORMANCE_STYLES}
                  selectedVoiceKey={selectedVoiceKey}
                  voiceOptions={voiceOptions}
                  onRenderSample={renderQualitySample}
                  onUseSample={useQualitySample}
                />
              </div>
            )}

            {activeView === "voices" && (
              <div className="space-y-4 p-4">
                <TtsEnginePanel models={localModels} error={localModelError} />

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <ClonePanel
                    cloneBusy={cloneBusy}
                    cloneConsent={cloneConsent}
                    cloneFile={cloneFile}
                    cloneLanguage={cloneLanguage}
                    cloneMessage={cloneMessage}
                    cloneName={cloneName}
                    cloneTier={cloneTier}
                    cloneAllowedUses={cloneAllowedUses}
                    clones={clones}
                    onCloneAllowedUsesChange={setCloneAllowedUses}
                    onCloneConsentChange={setCloneConsent}
                    onCloneExport={() => void exportClones()}
                    onCloneFileChange={setCloneFile}
                    onCloneImport={importCloneArchive}
                    onCloneLanguageChange={setCloneLanguage}
                    onCloneNameChange={setCloneName}
                    onCloneQualityScoreChange={setCloneQualityScore}
                    onCloneTierChange={setCloneTier}
                    onCloneUpload={() => void uploadClone()}
                    onDeleteClone={(id) => void deleteClone(id)}
                  />

                  <section
                    className="rounded border border-slate-300 p-3"
                    aria-labelledby="available-voices-heading"
                  >
                    <h2 id="available-voices-heading" className="font-semibold">Available Voices</h2>
                    {(() => {
                      const engineVoices = voiceOptions.filter(
                        (voice) => engineFilter === "all" || voice.kind === engineFilter
                      );
                      return (
                        <>
                          <p className="mt-1 text-sm text-slate-500">
                            {engineVoices.length} local voice{engineVoices.length === 1 ? "" : "s"}
                            {engineFilter !== "all" ? ` · ${engineFilter}` : ""}
                          </p>
                          <div
                            className="mt-2 flex flex-wrap gap-1"
                            role="group"
                            aria-label="Filter voices by engine"
                          >
                            {(["all", "kokoro", "supertonic", "clone"] as const).map((option) => (
                              <button
                                type="button"
                                key={option}
                                className={`rounded border px-2 py-1 text-xs capitalize focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                                  engineFilter === option
                                    ? "border-slate-950 bg-slate-950 text-white"
                                    : "border-slate-200"
                                }`}
                                aria-pressed={engineFilter === option}
                                onClick={() => setEngineFilter(option)}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                          <div className="mt-3 space-y-2">
                            {engineVoices.map((voice) => (
                              <button
                                type="button"
                                key={voice.key}
                                className={`w-full rounded border px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                                  selectedVoiceKey === voice.key
                                    ? "border-slate-950 bg-slate-950 text-white"
                                    : "border-slate-200"
                                }`}
                                onClick={() => {
                                  setSelectedVoiceKey(voice.key);
                                  setActiveView("write");
                                }}
                              >
                                <span className="block font-medium">{voice.label}</span>
                                <span className="block text-xs opacity-75">
                                  {voice.kind === "clone" ? "Cloned voice" : "Built-in voice"} /{" "}
                                  {voice.language}
                                </span>
                              </button>
                            ))}
                            {engineVoices.length === 0 && (
                              <p className="rounded border border-slate-200 p-4 text-sm text-slate-500">
                                {voiceOptions.length === 0
                                  ? "No voices loaded yet."
                                  : "No voices match this engine filter."}
                              </p>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </section>
                </div>
              </div>
            )}

            {activeView === "models" && (
              <div className="p-4">
                <ModelPackManager
                  models={localModels}
                  error={localModelError}
                  apiUrl={apiUrl}
                  onRefresh={refreshBackend}
                />
              </div>
            )}

            {activeView === "dubbing" && !activeProject && (
              <div className="p-4 text-sm text-slate-500" role="status" aria-live="polite">
                Loading workspace...
              </div>
            )}

            {activeView === "dubbing" && activeProject && (
              <div className="p-4">
                <DubbingTimeline
                  assetDurations={assetDurations}
                  assets={assets}
                  audioUrls={audioUrls}
                  isTranscribing={isTranscribing}
                  isTranslating={isTranslating}
                  localModelPanel={<LocalModelPanel models={localModels} error={localModelError} />}
                  selectedVoiceKey={selectedVoiceKey}
                  segments={activeProject.dubbingSegments}
                  voiceOptions={voiceOptions}
                  onExportTimeline={exportDubbingTimeline}
                  onExportMuxMp4={exportDubbingMuxMp4}
                  onExportRenderPlan={exportDubbingRenderPlan}
                  onExportTranscript={exportDubbingTranscript}
                  onAlignSegment={(segment) => void alignSegment(segment)}
                  onApplySuggestedSpeed={applySuggestedSegmentSpeed}
                  onApplySpeakerSpeed={applySpeakerSpeed}
                  onApplySpeakerVoice={applySpeakerVoice}
                  onImportMedia={transcribeMediaFile}
                  onImportTranscript={importTranscriptFile}
                  onInferSpeakers={inferDubbingSpeakers}
                  onMergeWithNext={mergeSegmentWithNext}
                  onExportMuxScript={exportDubbingMuxScript}
                  onRenderAll={() => void renderAllSegments()}
                  onRenderSegment={(segment) => void renderSegment(segment)}
                  onRetryFailed={() => void retryFailedSegments()}
                  onSplitSegment={splitSegment}
                  onTranslateAll={() => void translateAllSegments()}
                  onTranslateSegment={(segment) => void translateSegment(segment)}
                  onUpdateSegment={updateSegment}
                />
              </div>
            )}

            {activeView === "pronunciation" && (
              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                <section className="space-y-3" aria-label="Pronunciation rules">
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      value={newRulePattern}
                      onChange={(event) => setNewRulePattern(event.target.value)}
                      placeholder="Pattern"
                      aria-label="New rule pattern"
                    />
                    <input
                      className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      value={newRuleReplacement}
                      onChange={(event) => setNewRuleReplacement(event.target.value)}
                      placeholder="Replacement"
                      aria-label="New rule replacement"
                    />
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      onClick={addPronunciationRule}
                    >
                      Add Rule
                    </button>
                  </div>

                  <div className="space-y-2">
                    {activeProfile?.rules.map((rule) => (
                      <div
                        key={rule.id}
                        className="grid gap-2 rounded border border-slate-300 p-3 md:grid-cols-6"
                      >
                        <input
                          className="rounded border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 md:col-span-2"
                          value={rule.pattern}
                          aria-label="Pattern"
                          onChange={(event) =>
                            updateRule(rule.id, { pattern: event.target.value })
                          }
                        />
                        <input
                          className="rounded border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 md:col-span-2"
                          value={rule.replacement}
                          aria-label="Replacement"
                          onChange={(event) =>
                            updateRule(rule.id, { replacement: event.target.value })
                          }
                        />
                        <select
                          className="rounded border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                          value={rule.mode}
                          aria-label="Mode"
                          onChange={(event) =>
                            updateRule(rule.id, {
                              mode: event.target.value as PronunciationRule["mode"],
                            })
                          }
                        >
                          <option value="word">Word</option>
                          <option value="literal">Literal</option>
                        </select>
                        <button
                          type="button"
                          className="rounded border border-red-300 px-2 py-2 text-sm text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                          aria-label={`Delete rule: ${rule.pattern || "unnamed"}`}
                          onClick={() => deleteRule(rule.id)}
                        >
                          Delete
                        </button>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(event) =>
                              updateRule(rule.id, { enabled: event.target.checked })
                            }
                          />
                          Enabled
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={rule.caseSensitive}
                            onChange={(event) =>
                              updateRule(rule.id, { caseSensitive: event.target.checked })
                            }
                          />
                          Case sensitive
                        </label>
                        <input
                          className="rounded border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                          value={rule.language}
                          aria-label="Language"
                          onChange={(event) =>
                            updateRule(rule.id, { language: event.target.value })
                          }
                          placeholder="Language"
                        />
                        <input
                          className="rounded border border-slate-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                          type="number"
                          value={rule.priority}
                          aria-label="Priority"
                          onChange={(event) =>
                            updateRule(rule.id, { priority: Number(event.target.value) })
                          }
                          placeholder="Priority"
                        />
                      </div>
                    ))}
                  </div>
                </section>

                <section
                  className="rounded border border-slate-300 p-3"
                  aria-labelledby="profile-preview-heading"
                >
                  <h2 id="profile-preview-heading" className="font-semibold">Profile Preview</h2>
                  <textarea
                    className="mt-2 min-h-32 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    value={activeProfile?.previewText || ""}
                    aria-label="Profile preview source text"
                    onChange={(event) =>
                      activeProfile &&
                      updatePronunciationProfile({
                        ...activeProfile,
                        previewText: event.target.value,
                      })
                    }
                  />
                  <div
                    className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm"
                    aria-live="polite"
                  >
                    {previewText}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                      disabled={!activeProfile?.previewText.trim()}
                      onClick={() => void renderPronunciationPreview()}
                    >
                      Render Preview
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                      disabled={!activeProfile}
                      onClick={exportActivePronunciationProfile}
                    >
                      Export Profile
                    </button>
                    <label className="cursor-pointer rounded border border-slate-300 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-slate-400">
                      Import Profile
                      <input
                        className="sr-only"
                        type="file"
                        accept="application/json,.json"
                        onChange={(event) => void importPronunciationProfile(event)}
                      />
                    </label>
                  </div>
                </section>
              </div>
            )}

            {activeView === "agent" && activeProject && (
              <div className="p-4">
                <AgentPanel
                  apiUrl={apiUrl}
                  projectLanguage={activeProject.targetLanguage}
                  selectedVoiceLabel={selectedVoiceLabel(selectedVoiceKey)}
                  onSpeakResponse={synthesizeAgentResponse}
                />
              </div>
            )}

            {activeView === "library" && (
              <div className="p-4">
                <AudioLibrary
                  assets={assets}
                  audioUrls={audioUrls}
                  onDelete={(id) => void deleteAsset(id)}
                />
              </div>
            )}

            {activeView === "settings" && (
              <div className="p-4">
                <SettingsView
                  activeProject={activeProject}
                  apiUrl={apiUrl}
                  assets={assets}
                  backendError={backendError}
                  backendStatus={backendStatus}
                  clones={clones}
                  models={localModels}
                  projects={projects}
                  onUpdateProject={updateActiveProjectFields}
                  onSaveProjectSnapshot={saveActiveProjectSnapshot}
                  onExportConsentLedger={exportConsentLedger}
                />
              </div>
            )}
          </div>
          {voicesError && (
            <p
              className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              {voicesError}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
