import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AudioLibrary } from "../app/components/AudioLibrary";
import { ClonePanel } from "../app/components/ClonePanel";
import { LocalModelPanel } from "../app/components/LocalModelPanel";
import { TtsEnginePanel } from "../app/components/TtsEnginePanel";
import { SetupBanner } from "../app/components/SetupBanner";
import type { AudioAsset } from "../app/lib/workspace";

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
        clones={[]}
        onCloneConsentChange={() => undefined}
        onCloneExport={() => undefined}
        onCloneFileChange={() => undefined}
        onCloneImport={() => undefined}
        onCloneLanguageChange={() => undefined}
        onCloneNameChange={() => undefined}
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
        clones={[]}
        onCloneConsentChange={() => undefined}
        onCloneExport={() => undefined}
        onCloneFileChange={() => undefined}
        onCloneImport={() => undefined}
        onCloneLanguageChange={() => undefined}
        onCloneNameChange={() => undefined}
        onCloneUpload={() => undefined}
        onDeleteClone={() => undefined}
      />
    );
    const view = within(container);

    expect(view.getByText(/5 to 30 second sample/i)).toBeInTheDocument();
    await user.click(view.getByRole("tab", { name: /record/i }));
    expect(view.getByText(/read this aloud/i)).toBeInTheDocument();
    expect(view.getByText(/this is my Kural voice sample/i)).toBeInTheDocument();
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
