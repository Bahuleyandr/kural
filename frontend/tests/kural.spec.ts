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

  await expect(page.getByRole("button", { name: "Hello Kural" })).toBeVisible();
  await expect(page.getByText(/Bella \/ WAV/)).toBeVisible();
});

test("persists generated audio across reloads", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");

  await page.getByLabel("Text").fill("Saved for later");
  await page.getByRole("button", { name: "Generate Audio" }).click();
  await expect(page.getByRole("button", { name: "Saved for later" })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("button", { name: "Saved for later" })).toBeVisible();
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

  await expect(page.getByRole("button", { name: "Two" })).toBeVisible();
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

  await expect(page.getByRole("button", { name: longText })).toBeVisible();
  expect(calls).toBeGreaterThan(1);
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

  await page.getByLabel("Audio sample").setInputFiles({
    name: "short.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await page.getByLabel("Voice name").fill("Short");
  await page.getByLabel("I have consent to clone and use this voice.").check();
  await page.getByRole("button", { name: "Clone Voice" }).click();

  await expect(page.getByText(/Sample too short/)).toBeVisible();
});
