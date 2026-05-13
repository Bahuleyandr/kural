import JSZip from "jszip";

import { loadAudioItems } from "./audioLibrary";
import type { VoiceKind } from "./types";

export type OutputFormat = "wav" | "mp3";
export type PronunciationMode = "literal" | "word";
export type DubbingStatus = "draft" | "rendering" | "ready" | "error";

export interface AudioControls {
  speed: number;
  pitchSemitones: number;
  volumeDb: number;
  normalize: boolean;
  trimSilence: boolean;
  pauseScale: number;
  format: OutputFormat;
}

export interface PronunciationRule {
  id: string;
  pattern: string;
  replacement: string;
  mode: PronunciationMode;
  caseSensitive: boolean;
  language: string;
  enabled: boolean;
  priority: number;
}

export interface PronunciationProfile {
  id: string;
  name: string;
  language: string;
  previewText: string;
  rules: PronunciationRule[];
  updatedAt: string;
}

export interface VoicePreset {
  id: string;
  name: string;
  voiceKind: VoiceKind;
  voiceId: string;
  voiceLabel: string;
  language: string;
  controls: AudioControls;
  updatedAt: string;
}

export interface ProjectDocument {
  id: string;
  title: string;
  text: string;
  mode: "single" | "batch" | "dubbing";
  updatedAt: string;
}

export interface DubbingSegment {
  id: string;
  startMs: number;
  endMs: number;
  sourceText: string;
  targetText: string;
  sourceLanguage: string;
  targetLanguage: string;
  voiceId: string;
  controls: AudioControls;
  status: DubbingStatus;
  audioAssetId?: string;
  notes: string;
  error?: string;
}

export interface KuralProject {
  id: string;
  name: string;
  description: string;
  sourceLanguage: string;
  targetLanguage: string;
  createdAt: string;
  updatedAt: string;
  activeDocumentId: string;
  activePronunciationProfileId: string;
  documents: ProjectDocument[];
  voicePresets: VoicePreset[];
  pronunciationProfiles: PronunciationProfile[];
  dubbingSegments: DubbingSegment[];
}

export interface AudioAsset {
  id: string;
  projectId: string;
  name: string;
  text: string;
  voiceLabel: string;
  format: OutputFormat;
  createdAt: string;
  bytes: number;
  blob: Blob;
  dubbingSegmentId?: string;
  language?: string;
  controls?: AudioControls;
}

export interface WorkspaceState {
  projects: KuralProject[];
  activeProjectId: string;
  assets: AudioAsset[];
}

interface ProjectArchiveManifest {
  schemaVersion: 1;
  exportedAt: string;
  project: KuralProject;
  assets: Array<Omit<AudioAsset, "blob"> & { path: string }>;
}

export const DEFAULT_CONTROLS: AudioControls = {
  speed: 1,
  pitchSemitones: 0,
  volumeDb: 0,
  normalize: false,
  trimSilence: false,
  pauseScale: 1,
  format: "wav",
};

const DB_NAME = "kural-workspace";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";
const ASSET_STORE = "audioAssets";
const ACTIVE_PROJECT_KEY = "kural.workspace.activeProject.v1";
const LEGACY_MIGRATION_KEY = "kural.workspace.legacyHistoryMigrated.v1";

export function createId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function canUseIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function storageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

function storageSet(key: string, value: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, value);
  }
}

function openDb(): Promise<IDBDatabase> {
  if (!canUseIndexedDb()) {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        const store = db.createObjectStore(ASSET_STORE, { keyPath: "id" });
        store.createIndex("projectId", "projectId");
        store.createIndex("createdAt", "createdAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open workspace"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Workspace transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Workspace transaction aborted"));
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error(`Could not read ${storeName}`));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
}

export function createDefaultPronunciationProfile(language = "en-US"): PronunciationProfile {
  return {
    id: createId("pron"),
    name: "Default profile",
    language,
    previewText: "Kural reads AI, TTS, and product names consistently.",
    rules: [
      {
        id: createId("rule"),
        pattern: "Kural",
        replacement: "koo-ral",
        mode: "word",
        caseSensitive: false,
        language,
        enabled: true,
        priority: 10,
      },
    ],
    updatedAt: nowIso(),
  };
}

export function createProject(name = "Untitled project"): KuralProject {
  const createdAt = nowIso();
  const documentId = createId("doc");
  const profile = createDefaultPronunciationProfile();
  return {
    id: createId("project"),
    name,
    description: "",
    sourceLanguage: "en-US",
    targetLanguage: "en-US",
    createdAt,
    updatedAt: createdAt,
    activeDocumentId: documentId,
    activePronunciationProfileId: profile.id,
    documents: [
      {
        id: documentId,
        title: "Script",
        text: "",
        mode: "single",
        updatedAt: createdAt,
      },
    ],
    voicePresets: [],
    pronunciationProfiles: [profile],
    dubbingSegments: [],
  };
}

export async function saveProject(project: KuralProject): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(PROJECT_STORE, "readwrite");
  transaction.objectStore(PROJECT_STORE).put({ ...project, updatedAt: nowIso() });
  await transactionDone(transaction);
  db.close();
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction([PROJECT_STORE, ASSET_STORE], "readwrite");
  transaction.objectStore(PROJECT_STORE).delete(projectId);
  const index = transaction.objectStore(ASSET_STORE).index("projectId");
  const request = index.openCursor(IDBKeyRange.only(projectId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await transactionDone(transaction);
  db.close();
}

export async function saveAudioAsset(asset: AudioAsset): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(ASSET_STORE, "readwrite");
  transaction.objectStore(ASSET_STORE).put(asset);
  await transactionDone(transaction);
  db.close();
}

export async function deleteAudioAsset(assetId: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(ASSET_STORE, "readwrite");
  transaction.objectStore(ASSET_STORE).delete(assetId);
  await transactionDone(transaction);
  db.close();
}

export async function loadAudioAssets(projectId: string): Promise<AudioAsset[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const items: AudioAsset[] = [];
    const transaction = db.transaction(ASSET_STORE, "readonly");
    const index = transaction.objectStore(ASSET_STORE).index("projectId");
    const request = index.openCursor(IDBKeyRange.only(projectId), "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      items.push(cursor.value as AudioAsset);
      cursor.continue();
    };
    transaction.oncomplete = () => {
      db.close();
      resolve(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not load audio assets"));
    };
  });
}

async function migrateLegacyHistory(projectId: string): Promise<void> {
  if (storageGet(LEGACY_MIGRATION_KEY)) return;

  try {
    const legacyItems = await loadAudioItems(50);
    await Promise.all(
      legacyItems.map((item) =>
        saveAudioAsset({
          id: `legacy_${item.id}`,
          projectId,
          name: item.text.slice(0, 48) || "Imported clip",
          text: item.text,
          voiceLabel: item.voiceLabel,
          format: item.format,
          createdAt: item.createdAt,
          bytes: item.bytes,
          blob: item.blob,
        })
      )
    );
  } catch {
    // Migration is best-effort; the old audio library remains untouched.
  } finally {
    storageSet(LEGACY_MIGRATION_KEY, "true");
  }
}

export async function loadWorkspace(): Promise<WorkspaceState> {
  let projects = await getAll<KuralProject>(PROJECT_STORE);
  if (projects.length === 0) {
    const inbox = createProject("Inbox");
    await saveProject(inbox);
    projects = [inbox];
    await migrateLegacyHistory(inbox.id);
  }

  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const storedActiveId = storageGet(ACTIVE_PROJECT_KEY);
  const activeProjectId = projects.some((project) => project.id === storedActiveId)
    ? storedActiveId!
    : projects[0].id;
  storageSet(ACTIVE_PROJECT_KEY, activeProjectId);
  const assets = await loadAudioAssets(activeProjectId);

  return { projects, activeProjectId, assets };
}

export function setActiveProject(projectId: string) {
  storageSet(ACTIVE_PROJECT_KEY, projectId);
}

export async function exportProjectArchive(
  project: KuralProject,
  assets: AudioAsset[]
): Promise<Blob> {
  const zip = new JSZip();
  const manifestAssets: ProjectArchiveManifest["assets"] = [];

  for (const asset of assets) {
    const path = `audio/${asset.id}.${asset.format}`;
    zip.file(path, await asset.blob.arrayBuffer());
    manifestAssets.push({
      id: asset.id,
      projectId: asset.projectId,
      name: asset.name,
      text: asset.text,
      voiceLabel: asset.voiceLabel,
      format: asset.format,
      createdAt: asset.createdAt,
      bytes: asset.bytes,
      dubbingSegmentId: asset.dubbingSegmentId,
      language: asset.language,
      controls: asset.controls,
      path,
    });
  }

  const manifest: ProjectArchiveManifest = {
    schemaVersion: 1,
    exportedAt: nowIso(),
    project,
    assets: manifestAssets,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export async function importProjectArchive(file: File): Promise<KuralProject> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("Project archive is missing manifest.json");
  }

  const manifest = JSON.parse(await manifestFile.async("string")) as ProjectArchiveManifest;
  if (manifest.schemaVersion !== 1 || !manifest.project) {
    throw new Error("Project archive schema is not supported");
  }

  const projectId = createId("project");
  const importedProject: KuralProject = {
    ...manifest.project,
    id: projectId,
    name: `${manifest.project.name} import`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const assetIdMap = new Map<string, string>();

  for (const asset of manifest.assets || []) {
    const audioFile = zip.file(asset.path);
    if (!audioFile) continue;
    const newAssetId = createId("asset");
    assetIdMap.set(asset.id, newAssetId);
    await saveAudioAsset({
      ...asset,
      id: newAssetId,
      projectId,
      blob: await audioFile.async("blob"),
    });
  }

  importedProject.dubbingSegments = importedProject.dubbingSegments.map((segment) => ({
    ...segment,
    audioAssetId: segment.audioAssetId ? assetIdMap.get(segment.audioAssetId) : undefined,
  }));
  await saveProject(importedProject);
  setActiveProject(importedProject.id);
  return importedProject;
}
