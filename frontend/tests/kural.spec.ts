import { expect, test } from "@playwright/test";

const wav = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=", "base64");

async function mockBackend(page: import("@playwright/test").Page) {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok", version: "0.2.0", engine: "kokoro-onnx" } })
  );
  await page.route("**/api/voices", (route) =>
    route.fulfill({
      json: {
        voices: [
          {
            id: "af_bella",
            name: "Bella",
            language: "en-US",
            gender: "female",
            description: "Warm",
          },
        ],
        total: 1,
      },
    })
  );
  await page.route("**/api/voices/clones", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { clones: [], total: 0 } });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/local-models", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "faster-whisper",
            name: "faster-whisper",
            category: "asr",
            provider: "faster-whisper",
            status: "ready",
            license: "MIT",
          },
          {
            id: "argos-translate",
            name: "Argos Translate",
            category: "translation",
            provider: "argos",
            status: "ready",
            license: "MIT / CC0 model packages",
          },
        ],
        total: 2,
      },
    })
  );
  await page.route("**/api/synthesize", (route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: wav,
    })
  );
}

test("generates audio and records it in the library", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");

  await page.getByLabel("Text").fill("Hello Kural");
  await page.getByRole("button", { name: "Generate Audio" }).click();

  await expect(page.getByLabel("Audio Library").getByText("Hello Kural")).toBeVisible();
  await expect(page.getByText(/Bella \/ WAV/)).toBeVisible();
});

test("persists generated audio across reloads", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");

  await page.getByLabel("Text").fill("Saved for later");
  await page.getByRole("button", { name: "Generate Audio" }).click();
  await expect(page.getByLabel("Audio Library").getByText("Saved for later")).toBeVisible();

  await page.reload();

  await expect(page.getByLabel("Audio Library").getByText("Saved for later")).toBeVisible();
  await expect(page.getByText(/Bella \/ WAV/)).toBeVisible();
});

test("batch mode sends one request per item", async ({ page }) => {
  await mockBackend(page);
  let calls = 0;
  await page.route("**/api/synthesize", (route) => {
    calls += 1;
    return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Batch" }).click();
  await page.getByLabel("Text").fill("One\n\nTwo");
  await page.getByRole("button", { name: "Generate Batch" }).click();

  await expect(page.getByLabel("Audio Library").getByText("Two")).toBeVisible();
  expect(calls).toBe(2);
});

test("chunks long text and stores one stitched library item", async ({ page }) => {
  await mockBackend(page);
  let calls = 0;
  await page.route("**/api/synthesize", (route) => {
    calls += 1;
    return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
  });
  await page.goto("/");

  const longText = "Sentence ".repeat(500).trim();
  await page.getByLabel("Text").fill(longText);
  await page.getByRole("button", { name: "Generate Audio" }).click();

  await expect(page.getByLabel("Audio Library").getByText(longText)).toBeVisible();
  expect(calls).toBeGreaterThan(1);
});

test("sends SSML input to the backend without client chunking", async ({ page }) => {
  await mockBackend(page);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/synthesize", (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
  });
  await page.goto("/");

  const ssmlText = 'Hello <break time="250ms"/> world';
  await page.getByLabel("SSML").check();
  await page.getByLabel("Text").fill(ssmlText);
  await page.getByRole("button", { name: "Generate Audio" }).click();

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    text: ssmlText,
    ssml: true,
    format: "wav",
  });
});

test("surfaces clone upload errors", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/api/voices/clone", (route) =>
    route.fulfill({
      status: 422,
      json: {
        detail: {
          code: "invalid_audio_sample",
          message: "Sample too short (1.0s); minimum is 5 seconds.",
        },
      },
    })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "voices" }).click();

  await page.locator('input[type="file"][accept*="audio/wav"]').setInputFiles({
    name: "short.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await page.getByLabel("Voice name").fill("Short");
  await page.getByLabel("I have consent to clone and use this voice.").check();
  await page.getByRole("button", { name: "Clone Voice" }).click();

  await expect(page.getByText(/Sample too short/)).toBeVisible();
});

test("exports and imports cloned voices", async ({ page }) => {
  await mockBackend(page);
  let exportCalls = 0;
  let importCalls = 0;
  const clone = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Portable",
    engine: "chatterbox",
    duration_s: 5.0,
    sample_rate: 8000,
    created_at: "2026-04-28T00:00:00Z",
    consent_confirmed: true,
    watermark: "kural-voice-clone-consent-v1",
  };
  await page.route("**/api/voices/clones/export", (route) => {
    exportCalls += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/zip",
      body: Buffer.from("zip"),
    });
  });
  await page.route("**/api/voices/clones/import", (route) => {
    importCalls += 1;
    return route.fulfill({ status: 200, json: { imported: [clone], total: 1 } });
  });
  await page.route("**/api/voices/clones", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { clones: [clone], total: 1 } });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "voices" }).click();

  await page.getByRole("button", { name: "Export Voices" }).click();
  await page.locator("#clone-archive-file").setInputFiles({
    name: "voices.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("zip"),
  });

  await expect(page.getByText(/Imported 1 cloned voice/)).toBeVisible();
  expect(exportCalls).toBe(1);
  expect(importCalls).toBe(1);
});

test("imports subtitle segments into the dubbing workspace", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");

  await page.getByRole("button", { name: "dubbing" }).click();
  await page.locator('input[accept=".srt,.vtt,.csv,.txt"]').setInputFiles({
    name: "scene.srt",
    mimeType: "text/plain",
    buffer: Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nHello from scene\n"),
  });

  await expect(page.getByText("Segment 1 - 00:00:01.000")).toBeVisible();
  await expect(page.locator("textarea").first()).toHaveValue("Hello from scene");
});

test("translates a dubbing segment with the local translation endpoint", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/api/translate", (route) =>
    route.fulfill({
      status: 200,
      json: {
        text: "Hola escena",
        source_language: "en-US",
        target_language: "en-US",
        provider: "argos",
      },
    })
  );
  await page.goto("/");

  await page.getByRole("button", { name: "dubbing" }).click();
  await page.locator('input[accept=".srt,.vtt,.csv,.txt"]').setInputFiles({
    name: "scene.srt",
    mimeType: "text/plain",
    buffer: Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nHello scene\n"),
  });
  await page.getByRole("button", { name: "Translate", exact: true }).click();

  await expect(page.getByLabel("Target text")).toHaveValue("Hola escena");
});

test("imports audio through the local ASR endpoint", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/api/transcribe", (route) =>
    route.fulfill({
      status: 200,
      json: {
        text: "audio scene",
        language: "en",
        provider: "faster-whisper",
        segments: [{ start_ms: 250, end_ms: 1750, text: "audio scene" }],
      },
    })
  );
  await page.goto("/");

  await page.getByRole("button", { name: "dubbing" }).click();
  await page.locator('input[accept="audio/*,video/mp4,video/quicktime"]').setInputFiles({
    name: "scene.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });

  await expect(page.getByText("Segment 1 - 00:00:00.250")).toBeVisible();
  await expect(page.getByLabel("Source text")).toHaveValue("audio scene");
});
