"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AudioLibrary } from "./components/AudioLibrary";
import { ClonePanel } from "./components/ClonePanel";
import { ControlPanel } from "./components/ControlPanel";
import { LocalModelPanel } from "./components/LocalModelPanel";
import { SetupBanner } from "./components/SetupBanner";
import { useBackendStatus } from "./hooks/useBackendStatus";
import { useWorkspace } from "./hooks/useWorkspace";
import { apiFetch, getApiUrl, readApiError, rehydrateTauriGlobals } from "./lib/api";
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
import { formatTime, parseTranscript } from "./lib/dubbing";
import type {
  Mode,
  TranscriptionResponse,
  WorkspaceView,
} from "./lib/types";
import { stitchWavBlobs } from "./lib/wav";
import {
  DEFAULT_CONTROLS,
  createId,
  deleteAudioAsset,
  exportProjectArchive,
  importProjectArchive,
  saveAudioAsset,
  type AudioAsset,
  type AudioControls,
  type DubbingSegment,
  type KuralProject,
  type OutputFormat,
  type PronunciationProfile,
  type PronunciationRule,
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
  } = useBackendStatus(apiUrl);

  const {
    projects,
    activeProjectId,
    assets,
    workspaceError,
    setAssets,
    setWorkspaceError,
    refreshWorkspace,
    persistProject,
    createNewProject,
    removeActiveProject,
    switchProject,
  } = useWorkspace();

  const [activeView, setActiveView] = useState<WorkspaceView>("write");
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({});

  const [selectedVoiceKey, setSelectedVoiceKey] = useState("");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [controls, setControls] = useState<AudioControls>(DEFAULT_CONTROLS);
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
          .map((voice) => ({ key: `kokoro:${voice.id}`, shortLabel: voice.name }))
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

  async function synthesizeText(
    text: string,
    segment?: DubbingSegment
  ): Promise<{ blob: Blob; format: OutputFormat }> {
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
      const res = await apiFetch(`${apiUrl}/api/voices/clone`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await readApiError(res));
      await refreshClones();
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

          <div className="space-y-2" role="list">
            {projects.map((project) => (
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
                <span className="block text-xs opacity-75">{project.targetLanguage}</span>
              </button>
            ))}
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
              className="col-span-2 rounded border border-red-300 px-2 py-2 text-sm text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:opacity-40"
              disabled={projects.length <= 1}
              onClick={() => void removeActiveProject(activeProject)}
            >
              Delete Project
            </button>
          </div>

          <div
            className="mt-4 rounded border border-slate-200 p-3 text-xs text-slate-600"
            aria-live="polite"
          >
            <p>Backend: {backendStatus || "checking"}</p>
            <p>API: {apiUrl}</p>
            {backendError && (
              <p className="mt-2 text-red-700" role="alert">
                {backendError}
              </p>
            )}
            {workspaceError && (
              <p className="mt-2 text-red-700" role="alert">
                {workspaceError}
              </p>
            )}
          </div>
        </aside>

        <section id="workspace" className="min-w-0 flex-1" aria-label="Workspace">
          <SetupBanner apiUrl={apiUrl} />
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
              <nav className="flex flex-wrap gap-2" aria-label="Workspace views">
                {(["write", "dubbing", "pronunciation", "library"] as WorkspaceView[]).map(
                  (view) => (
                    <button
                      type="button"
                      key={view}
                      aria-pressed={activeView === view}
                      className={`rounded border px-3 py-2 text-sm capitalize focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                        activeView === view
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-300"
                      }`}
                      onClick={() => setActiveView(view)}
                    >
                      {view}
                    </button>
                  )
                )}
              </nav>
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
                    <label className="flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm">
                      <input
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
                      className="mt-2 min-h-72 w-full resize-y rounded border border-slate-300 px-3 py-3 font-mono text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      value={activeDocument?.text || ""}
                      onChange={(event) => updateDocumentText(event.target.value)}
                      placeholder={
                        mode === "batch"
                          ? "Separate each script with a blank line."
                          : "Write or paste the script for this project."
                      }
                    />
                  </label>

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
                    selectedVoiceKey={selectedVoiceKey}
                    voiceOptions={voiceOptions}
                    onControlsChange={setControls}
                    onLanguageFilterChange={setLanguageFilter}
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

                  <ClonePanel
                    cloneBusy={cloneBusy}
                    cloneConsent={cloneConsent}
                    cloneFile={cloneFile}
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

                  <AudioLibrary
                    assets={assets}
                    audioUrls={audioUrls}
                    onDelete={(id) => void deleteAsset(id)}
                  />
                </div>
              </div>
            )}

            {activeView === "dubbing" && !activeProject && (
              <div className="p-4 text-sm text-slate-500" role="status" aria-live="polite">
                Loading workspace...
              </div>
            )}

            {activeView === "dubbing" && activeProject && (
              <div className="space-y-4 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded border border-slate-300 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-slate-400">
                    Import SRT/VTT/CSV/Text
                    <input
                      className="hidden"
                      type="file"
                      accept=".srt,.vtt,.csv,.txt"
                      onChange={importTranscriptFile}
                    />
                  </label>
                  <label className="cursor-pointer rounded border border-slate-300 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-slate-400">
                    Import Audio/Video
                    <input
                      className="hidden"
                      type="file"
                      accept="audio/*,video/mp4,video/quicktime"
                      onChange={transcribeMediaFile}
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                    disabled={isTranslating || activeProject.dubbingSegments.length === 0}
                    onClick={() => void translateAllSegments()}
                    aria-busy={isTranslating}
                  >
                    {isTranslating ? "Translating..." : "Translate All"}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    onClick={exportDubbingTimeline}
                  >
                    Export WAV Timeline
                  </button>
                  <span className="text-sm text-slate-500" role="status" aria-live="polite">
                    {isTranscribing
                      ? "Transcribing..."
                      : `${activeProject?.dubbingSegments.length || 0} transcript segments`}
                  </span>
                </div>
                <LocalModelPanel models={localModels} error={localModelError} />

                <div className="space-y-3">
                  {activeProject?.dubbingSegments.map((segment, index) => {
                    const asset = assets.find(
                      (candidate) => candidate.id === segment.audioAssetId
                    );
                    const duration = segment.audioAssetId
                      ? assetDurations[segment.audioAssetId] || 0
                      : 0;
                    const limit = segment.endMs - segment.startMs;
                    const overrun = duration > 0 && duration > limit;
                    return (
                      <section
                        key={segment.id}
                        className="rounded border border-slate-300 p-3"
                        aria-label={`Segment ${index + 1}`}
                      >
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="font-medium">
                              Segment {index + 1} - {formatTime(segment.startMs)}
                            </h3>
                            <p className="text-xs text-slate-500">
                              Target {formatTime(segment.endMs)} {overrun ? "- overrun" : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                              disabled={isTranslating}
                              onClick={() => void translateSegment(segment)}
                            >
                              Translate
                            </button>
                            <button
                              type="button"
                              className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                              disabled={segment.status === "rendering"}
                              onClick={() => void renderSegment(segment)}
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
                                updateSegment(segment.id, { sourceText: event.target.value })
                              }
                            />
                          </label>
                          <label className="text-sm">
                            Target text
                            <textarea
                              className="mt-1 min-h-28 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                              value={segment.targetText}
                              onChange={(event) =>
                                updateSegment(segment.id, { targetText: event.target.value })
                              }
                            />
                          </label>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-4">
                          <label className="sr-only" htmlFor={`segment-voice-${segment.id}`}>
                            Voice for segment {index + 1}
                          </label>
                          <select
                            id={`segment-voice-${segment.id}`}
                            className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                            value={segment.voiceId || selectedVoiceKey}
                            onChange={(event) =>
                              updateSegment(segment.id, { voiceId: event.target.value })
                            }
                          >
                            {voiceOptions.map((option) => (
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
                              updateSegment(segment.id, {
                                controls: { ...segment.controls, speed: Number(event.target.value) },
                              })
                            }
                          />
                          <input
                            className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                            value={segment.notes}
                            onChange={(event) =>
                              updateSegment(segment.id, { notes: event.target.value })
                            }
                            placeholder="Notes"
                            aria-label={`Notes for segment ${index + 1}`}
                          />
                          <span
                            className="rounded border border-slate-200 px-3 py-2 text-sm"
                            aria-live="polite"
                          >
                            {segment.status}
                          </span>
                        </div>
                        {asset && audioUrls[asset.id] && (
                          <audio
                            className="mt-3 w-full"
                            controls
                            src={audioUrls[asset.id]}
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
                </section>
              </div>
            )}

            {activeView === "library" && (
              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                <AudioLibrary
                  assets={assets}
                  audioUrls={audioUrls}
                  onDelete={(id) => void deleteAsset(id)}
                />
                <ClonePanel
                  cloneBusy={cloneBusy}
                  cloneConsent={cloneConsent}
                  cloneFile={cloneFile}
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
