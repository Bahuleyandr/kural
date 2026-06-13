import { describe, expect, test } from "vitest";

import {
  exportSegmentsAsCsv,
  exportSegmentsAsSrt,
  exportSegmentsAsVtt,
  parseTranscript,
} from "../app/lib/dubbing";

describe("parseTranscript", () => {
  test("imports SRT caption blocks", () => {
    const segments = parseTranscript(
      "scene.srt",
      "1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n2\n00:00:04,000 --> 00:00:05,000\nAgain",
      "en-US",
      "hi-IN"
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      startMs: 1000,
      endMs: 3500,
      speaker: "Speaker 1",
      sourceText: "Hello world",
      targetLanguage: "hi-IN",
      status: "draft",
    });
  });

  test("imports CSV rows with headers", () => {
    const segments = parseTranscript(
      "scene.csv",
      "start_ms,end_ms,speaker,text\n0,1500,Narrator,\"First line\"\n2000,3500,Guest,Second line",
      "en-US",
      "en-US"
    );

    expect(segments.map((segment) => segment.sourceText)).toEqual(["First line", "Second line"]);
    expect(segments[1].startMs).toBe(2000);
    expect(segments[1].speaker).toBe("Guest");
  });

  test("infers speaker labels from transcript text", () => {
    const segments = parseTranscript(
      "scene.srt",
      "1\n00:00:01,000 --> 00:00:03,500\n[Narrator] Hello world",
      "en-US",
      "en-US"
    );

    expect(segments[0].speaker).toBe("Narrator");
    expect(segments[0].sourceText).toBe("Hello world");
  });

  test("falls back to paragraph based plain text segments", () => {
    const segments = parseTranscript("script.txt", "One\n\nTwo", "en-US", "en-US");

    expect(segments).toHaveLength(2);
    expect(segments[1].startMs).toBe(3000);
  });
});

describe("dubbing transcript export", () => {
  test("exports segments as SRT, VTT, and CSV", () => {
    const [segment] = parseTranscript("scene.txt", "Hello world", "en-US", "en-US");
    const ready = {
      ...segment,
      speaker: "Narrator",
      targetText: "Namaste world",
      voiceId: "kokoro:af_bella",
      status: "ready" as const,
      notes: "ok",
    };

    expect(exportSegmentsAsSrt([ready])).toContain("00:00:00,000 -->");
    expect(exportSegmentsAsVtt([ready])).toMatch(/^WEBVTT/);
    expect(exportSegmentsAsCsv([ready])).toContain('"Narrator"');
    expect(exportSegmentsAsCsv([ready])).toContain('"Namaste world"');
  });
});
