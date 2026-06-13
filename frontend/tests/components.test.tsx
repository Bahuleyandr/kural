import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AudioLibrary } from "../app/components/AudioLibrary";
import { ClonePanel } from "../app/components/ClonePanel";
import { FirstRunWizard } from "../app/components/FirstRunWizard";
import { LocalModelPanel } from "../app/components/LocalModelPanel";
import { ModelPackManager } from "../app/components/ModelPackManager";
import { QualityStudio } from "../app/components/QualityStudio";
import { SettingsView } from "../app/components/SettingsView";
import { TtsEnginePanel } from "../app/components/TtsEnginePanel";
import { SetupBanner } from "../app/components/SetupBanner";
import { WorkspaceTabs } from "../app/components/WorkspaceTabs";
import { PERFORMANCE_STYLES } from "../app/lib/performanceStyles";
import {
  DEFAULT_CONTROLS,
  createProject,
  type AudioAsset,
} from "../app/lib/workspace";

describe("AudioLibrary", () => {
  it("shows the empty state when no clips exist", () => {
    render(<AudioLibrary assets={[]} audioUrls={{}} onDelete={() => undefined} />);
    expect(screen.getByText(/no clips yet/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /audio library/i })).toBeInTheDocument();
  });

  it("renders one clip with its voice and format metadata", () => {
    const asset: AudioAsset = {
      id: "asset-1",
      projectId: "p1",
      name: "Test clip",
      text: "Hello world",
      voiceLabel: "Bella",
      format: "wav",
      createdAt: new Date().toISOString(),
      bytes: 2048,
      blob: new Blob([new Uint8Array(8)], { type: "audio/wav" }),
      language: "en-US",
      controls: {
        speed: 1,
        pitchSemitones: 0,
        volumeDb: 0,
        normalize: false,
        trimSilence: false,
        pauseScale: 1,
        format: "wav",
      },
    };
    render(
      <AudioLibrary
        assets={[asset]}
        audioUrls={{ "asset-1": "blob:fake" }}
        onDelete={() => undefined}
      />
    );
    expect(screen.getByText(/1 local clips/i)).toBeInTheDocument();
    expect(screen.getByText(/Bella \/ WAV/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete clip: Test clip/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download clip: Test clip/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save clip to folder: Test clip/i })
    ).toBeInTheDocument();
  });
});

describe("LocalModelPanel", () => {
  it("counts ready ASR/translation models", () => {
    render(
      <LocalModelPanel
        models={[
          {
            id: "fw",
            name: "faster-whisper",
            category: "asr",
            provider: "fw",
            status: "ready",
          },
          {
            id: "argos",
            name: "Argos",
            category: "translation",
            provider: "argos",
            status: "not_configured",
          },
          {
            id: "kokoro",
            name: "Kokoro",
            category: "tts",
            provider: "kokoro",
            status: "ready",
          },
        ]}
        error={null}
      />
    );
    // Kokoro is TTS — should not be counted in the workflow tally
    expect(screen.getByText(/1\/2 ready/)).toBeInTheDocument();
  });

  it("surfaces an error message", () => {
    render(<LocalModelPanel models={[]} error="boom" />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});

describe("ModelPackManager", () => {
  it("shows all local pack categories and can start Kokoro provisioning", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/model-packs") && !init?.method) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              packs: [
                {
                  id: "kokoro-v1-onnx",
                  name: "Kokoro v1.0 ONNX",
                  category: "tts",
                  provider: "kokoro",
                  status: "not_configured",
                  version: "1.0",
                  source_url: null,
                  checksum: null,
                  license: "Apache-2.0",
                  disk_size_mb: 92,
                  installed_path: "/models/kokoro",
                  languages: ["en-US"],
                  capabilities: ["tts"],
                  requires_confirmation: false,
                  non_commercial: false,
                  trust_level: "built_in",
                  manifest_digest: "sha256:kma",
                  recommended: true,
                  quality_score: 82,
                  latency_tier: "interactive",
                  routing_hints: ["default-tts", "long-form"],
                  detail: null,
                  actions: ["install"],
                },
                {
                  id: "faster-whisper",
                  name: "Faster-Whisper Tiny",
                  category: "asr",
                  provider: "faster-whisper",
                  status: "ready",
                  version: "tiny",
                  source_url: null,
                  checksum: null,
                  license: "MIT",
                  disk_size_mb: 150,
                  installed_path: "/models/asr",
                  languages: ["multilingual"],
                  capabilities: ["transcribe"],
                  requires_confirmation: true,
                  non_commercial: false,
                  trust_level: "verified_manifest",
                  manifest_digest: "sha256:fw",
                  recommended: true,
                  quality_score: 84,
                  latency_tier: "batch",
                  routing_hints: ["media-transcription"],
                  detail: null,
                  actions: ["install"],
                },
                {
                  id: "argos-translate",
                  name: "Argos Translate",
                  category: "translation",
                  provider: "argos",
                  status: "not_installed",
                  version: "starter",
                  source_url: null,
                  checksum: null,
                  license: "MIT",
                  disk_size_mb: 250,
                  installed_path: "/models/argos",
                  languages: ["en->hi"],
                  capabilities: ["translate"],
                  requires_confirmation: true,
                  non_commercial: false,
                  trust_level: "verified_manifest",
                  manifest_digest: "sha256:argos",
                  recommended: true,
                  quality_score: 72,
                  latency_tier: "interactive",
                  routing_hints: ["offline-translation"],
                  detail: null,
                  actions: ["install"],
                },
              ],
              jobs: [],
              total: 3,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url.includes("/api/model-packs/benchmarks")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              benchmarks: [
                {
                  id: "kokoro-v1-onnx",
                  name: "Kokoro v1.0 ONNX",
                  category: "tts",
                  status: "not_configured",
                  quality_score: 82,
                  naturalness_score: 86,
                  language_quality: 82,
                  latency_ms_estimate: 650,
                  memory_mb_estimate: 2048,
                  best_for: ["default-tts"],
                  measured: false,
                  detail: null,
                },
              ],
              total: 1,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url.includes("/api/model-packs/recommend")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              language: "en-US",
              capability: "tts",
              pack: {
                id: "kokoro-v1-onnx",
                name: "Kokoro v1.0 ONNX",
                category: "tts",
                provider: "kokoro",
                status: "not_configured",
                version: "1.0",
                source_url: null,
                checksum: null,
                license: "Apache-2.0",
                disk_size_mb: 92,
                installed_path: "/models/kokoro",
                languages: ["en-US"],
                capabilities: ["tts"],
                requires_confirmation: false,
                non_commercial: false,
                trust_level: "built_in",
                manifest_digest: "sha256:kma",
                recommended: true,
                quality_score: 82,
                latency_tier: "interactive",
                routing_hints: ["default-tts"],
                compatibility: { ram_mb: 2048, gpu: false },
                community_pack: false,
                provenance_required: false,
                detail: null,
                actions: ["install"],
              },
              reason: "Kokoro has the best local score for tts.",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url.endsWith("/api/model-packs/kokoro-v1-onnx/install")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "job-1",
              kind: "model-pack:install:kokoro-v1-onnx",
              status: "queued",
              progress: 0,
              message: "Queued install.",
            }),
            { status: 202, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ModelPackManager
        apiUrl="http://backend"
        error={null}
        onRefresh={() => undefined}
        models={[
          {
            id: "kokoro-v1-onnx",
            name: "Kokoro v1.0 ONNX",
            category: "tts",
            provider: "kokoro",
            status: "not_configured",
          },
          {
            id: "faster-whisper",
            name: "faster-whisper",
            category: "asr",
            provider: "faster-whisper",
            status: "ready",
          },
          {
            id: "argos-translate",
            name: "Argos Translate",
            category: "translation",
            provider: "argos",
            status: "not_installed",
          },
        ]}
      />
    );
    expect(screen.getByRole("heading", { name: /model pack manager/i })).toBeInTheDocument();
    expect(await screen.findByText(/tts packs/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /local quality router/i })).toBeInTheDocument();
    const kokoroCard = screen.getAllByText("Kokoro v1.0 ONNX")
      .find((element) => element.closest("article"))
      ?.closest("article");
    expect(kokoroCard).not.toBeNull();
    expect(within(kokoroCard as HTMLElement).getByText(/recommended/i)).toBeInTheDocument();
    expect(within(kokoroCard as HTMLElement).getByText(/built in/i)).toBeInTheDocument();
    expect(within(kokoroCard as HTMLElement).getByText(/82\/100/i)).toBeInTheDocument();
    await user.click(within(kokoroCard as HTMLElement).getByRole("button", { name: /install/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend/api/model-packs/kokoro-v1-onnx/install",
      expect.objectContaining({ method: "POST" })
    );
    vi.unstubAllGlobals();
  });
});

describe("FirstRunWizard", () => {
  it("shows local runtime language and setup actions", async () => {
    window.localStorage.removeItem("kural.firstRunWizard.dismissed.v1");
    render(
      <FirstRunWizard
        backendStatus={null}
        backendError=""
        clones={[]}
        models={[]}
        onCreateSampleProject={() => undefined}
        onOpenModels={() => undefined}
        onRefresh={() => undefined}
      />
    );

    expect(
      await screen.findByText(/Kural runs the speech engine locally on this computer/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create sample project/i })).toBeInTheDocument();
  });
});

describe("WorkspaceTabs", () => {
  it("includes the expanded workstation views", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<WorkspaceTabs activeView="write" onViewChange={onViewChange} />);
    expect(screen.getByRole("button", { name: "quality" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "models" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "quality" }));
    expect(onViewChange).toHaveBeenCalledWith("quality");
  });
});

describe("QualityStudio", () => {
  it("renders a comparison sample and exposes it for reuse", async () => {
    const user = userEvent.setup();
    const onUseSample = vi.fn();
    const blob = new Blob([new Uint8Array(8)], { type: "audio/wav" });
    const createObjectURL = vi.fn(() => "blob:quality");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    render(
      <QualityStudio
        controls={DEFAULT_CONTROLS}
        defaultText="Hello"
        performanceStyles={PERFORMANCE_STYLES.slice(0, 2)}
        selectedVoiceKey="kokoro:af_bella"
        voiceOptions={[
          {
            key: "kokoro:af_bella",
            id: "af_bella",
            kind: "kokoro",
            label: "[Kokoro] Bella",
            shortLabel: "Bella",
            language: "en-US",
          },
        ]}
        onRenderSample={async (request) => ({
          id: "sample-1",
          label: "Neutral",
          styleId: request.styleId,
          voiceKey: request.voiceKey,
          voiceLabel: "Bella",
          controls: request.controls,
          blob,
          format: "wav",
          bytes: 8,
        })}
        onUseSample={onUseSample}
      />
    );
    await user.click(screen.getByRole("button", { name: /render neutral/i }));
    expect(await screen.findByText("1 sample")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /use settings/i }));
    expect(onUseSample).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("SettingsView", () => {
  it("groups dictation, release diagnostics, and privacy panels", () => {
    const project = createProject("Settings test");
    render(
      <SettingsView
        activeProject={project}
        apiUrl="http://127.0.0.1:8000"
        assets={[]}
        backendError={null}
        backendStatus="kokoro 0.2.0"
        clones={[]}
        models={[]}
        projects={[project]}
        onUpdateProject={() => undefined}
        onSaveProjectSnapshot={async () => undefined}
        onExportConsentLedger={() => undefined}
      />
    );
    expect(screen.getByRole("heading", { name: /dictation settings/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /project vault/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /desktop release diagnostics/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /privacy and safety/i })).toBeInTheDocument();
  });
});

describe("TtsEnginePanel", () => {
  const ttsModels = [
    {
      id: "kokoro-v1-onnx",
      name: "Kokoro v1.0 ONNX",
      category: "tts" as const,
      provider: "kokoro",
      status: "ready" as const,
      languages: ["en-US", "hi-IN"],
      license: "Apache-2.0",
    },
    {
      id: "supertonic-3-onnx",
      name: "Supertonic 3 ONNX",
      category: "tts" as const,
      provider: "supertonic",
      status: "not_installed" as const,
      languages: ["en-US", "hi-IN", "ja-JP"],
      license: "MIT",
      detail: "Install backend/requirements-supertonic.txt to enable Supertonic.",
    },
    // An ASR model must be ignored — this panel is TTS-only.
    {
      id: "fw",
      name: "faster-whisper",
      category: "asr" as const,
      provider: "fw",
      status: "ready" as const,
    },
  ];

  it("shows only TTS-category engines and a ready tally", () => {
    render(<TtsEnginePanel models={ttsModels} error={null} />);
    expect(screen.getByText(/1\/2 ready/)).toBeInTheDocument();
    expect(screen.getByText("Kokoro v1.0 ONNX")).toBeInTheDocument();
    expect(screen.getByText("Supertonic 3 ONNX")).toBeInTheDocument();
    expect(screen.queryByText("faster-whisper")).not.toBeInTheDocument();
  });

  it("surfaces the install hint for an engine that isn't ready", () => {
    render(<TtsEnginePanel models={ttsModels} error={null} />);
    // The actionable detail must be visible so the user knows what to install.
    expect(
      screen.getByText(/requirements-supertonic\.txt/i)
    ).toBeInTheDocument();
  });

  it("renders the empty state when no engines are reported", () => {
    render(<TtsEnginePanel models={[]} error={null} />);
    expect(screen.getByText(/no tts engines reported/i)).toBeInTheDocument();
  });
});

describe("ClonePanel", () => {
  it("disables Clone Voice while busy", () => {
    render(
      <ClonePanel
        cloneBusy
        cloneConsent
        cloneFile={null}
        cloneLanguage="en-US"
        cloneMessage=""
        cloneName="x"
        cloneTier="quick"
        cloneAllowedUses={["personal"]}
        clones={[]}
        onCloneAllowedUsesChange={() => undefined}
        onCloneConsentChange={() => undefined}
        onCloneExport={() => undefined}
        onCloneFileChange={() => undefined}
        onCloneImport={() => undefined}
        onCloneLanguageChange={() => undefined}
        onCloneNameChange={() => undefined}
        onCloneQualityScoreChange={() => undefined}
        onCloneTierChange={() => undefined}
        onCloneUpload={() => undefined}
        onDeleteClone={() => undefined}
      />
    );
    const button = screen.getByRole("button", { name: /cloning/i });
    expect(button).toBeDisabled();
  });

  it("shows clone guidance and the local recording script", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ClonePanel
        cloneBusy={false}
        cloneConsent={false}
        cloneFile={null}
        cloneLanguage="en-US"
        cloneMessage=""
        cloneName=""
        cloneTier="quick"
        cloneAllowedUses={["personal"]}
        clones={[]}
        onCloneAllowedUsesChange={() => undefined}
        onCloneConsentChange={() => undefined}
        onCloneExport={() => undefined}
        onCloneFileChange={() => undefined}
        onCloneImport={() => undefined}
        onCloneLanguageChange={() => undefined}
        onCloneNameChange={() => undefined}
        onCloneQualityScoreChange={() => undefined}
        onCloneTierChange={() => undefined}
        onCloneUpload={() => undefined}
        onDeleteClone={() => undefined}
      />
    );
    const view = within(container);

    expect(view.getByText(/5 to 30 second sample/i)).toBeInTheDocument();
    await user.click(view.getByRole("tab", { name: /record/i }));
    expect(view.getByText(/read this aloud/i)).toBeInTheDocument();
    expect(view.getByText(/this is my Kural voice sample/i)).toBeInTheDocument();
    expect(view.getByLabelText(/script/i)).toBeInTheDocument();
    expect(view.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
  });
});

describe("SetupBanner", () => {
  it("hides when models are ready", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kokoro_ready: true,
          model_dir: "/tmp",
          model_files: ["a", "b"],
          provision_status: "complete",
          provision_detail: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<SetupBanner apiUrl="http://x" />);
    // Wait for the effect; nothing should render in the banner slot
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toBe("");
    vi.unstubAllGlobals();
  });

  it("renders the install button when models are missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kokoro_ready: false,
          model_dir: "/tmp/kokoro",
          model_files: ["kokoro-v1.0.int8.onnx", "voices-v1.0.bin"],
          provision_status: "idle",
          provision_detail: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SetupBanner apiUrl="http://x" />);
    const button = await screen.findByRole("button", { name: /Download Kokoro models/i });
    expect(button).toBeInTheDocument();
    await user.hover(button);
    vi.unstubAllGlobals();
  });
});
