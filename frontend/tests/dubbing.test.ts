import { describe, expect, test } from "vitest";

import { parseTranscript } from "../app/lib/dubbing";

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
      sourceText: "Hello world",
      targetLanguage: "hi-IN",
      status: "draft",
    });
  });

  test("imports CSV rows with headers", () => {
    const segments = parseTranscript(
      "scene.csv",
      "start_ms,end_ms,text\n0,1500,\"First line\"\n2000,3500,Second line",
      "en-US",
      "en-US"
    );

    expect(segments.map((segment) => segment.sourceText)).toEqual(["First line", "Second line"]);
    expect(segments[1].startMs).toBe(2000);
  });

  test("falls back to paragraph based plain text segments", () => {
    const segments = parseTranscript("script.txt", "One\n\nTwo", "en-US", "en-US");

    expect(segments).toHaveLength(2);
    expect(segments[1].startMs).toBe(3000);
  });
});
