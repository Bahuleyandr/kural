// @vitest-environment node
// jsdom's Blob shim is missing arrayBuffer/stream; we need Node's native Blob
// for jszip + workspace export logic to roundtrip correctly.
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, test } from "vitest";

import {
  DEFAULT_CONTROLS,
  createId,
  exportProjectArchive,
  importProjectArchive,
  loadWorkspace,
  saveAudioAsset,
  saveProject,
  type AudioAsset,
} from "../app/lib/workspace";

const localStorageMock = (() => {
  let store = new Map<string, string>();
  return {
    clear: () => {
      store = new Map();
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
})();

beforeEach(async () => {
  localStorageMock.clear();
  Object.defineProperty(globalThis, "window", {
    value: {
      indexedDB: globalThis.indexedDB,
      localStorage: localStorageMock,
    },
    configurable: true,
  });
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("kural-workspace");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("kural-audio-library");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("workspace storage", () => {
  test("creates an Inbox project on first load", async () => {
    const workspace = await loadWorkspace();

    expect(workspace.projects).toHaveLength(1);
    expect(workspace.projects[0].name).toBe("Inbox");
    expect(workspace.activeProjectId).toBe(workspace.projects[0].id);
  });

  test("exports and imports .kuralproj archives", async () => {
    const workspace = await loadWorkspace();
    const project = { ...workspace.projects[0], name: "Launch reads" };
    project.scriptVersions = [
      {
        id: createId("scriptver"),
        documentId: project.activeDocumentId,
        label: "Version 1",
        text: "Hello Kural",
        createdAt: new Date().toISOString(),
      },
    ];
    project.voiceUseLog = [
      {
        id: createId("voiceuse"),
        createdAt: new Date().toISOString(),
        voiceId: "kokoro:af_bella",
        voiceLabel: "Bella",
        purpose: "synthesis",
        language: "en-US",
        textPreview: "Hello Kural",
      },
    ];
    await saveProject(project);
    const asset: AudioAsset = {
      id: createId("asset"),
      projectId: project.id,
      name: "Line one",
      text: "Hello Kural",
      voiceLabel: "Bella",
      format: "wav",
      createdAt: new Date().toISOString(),
      bytes: 4,
      blob: new Blob(["RIFF"], { type: "audio/wav" }),
      controls: DEFAULT_CONTROLS,
      mediaKind: "generated",
    };
    project.dubbingMediaAssetId = asset.id;
    await saveAudioAsset(asset);

    const archive = await exportProjectArchive(project, [asset]);
    const imported = await importProjectArchive(new File([archive], "launch.kuralproj"));
    const reloaded = await loadWorkspace();

    expect(imported.name).toContain("Launch reads");
    expect(imported.scriptVersions).toHaveLength(1);
    expect(imported.voiceUseLog).toHaveLength(1);
    expect(imported.dubbingMediaAssetId).toBeTruthy();
    expect(reloaded.projects).toHaveLength(2);
  });
});
