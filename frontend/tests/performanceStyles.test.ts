import { describe, expect, test } from "vitest";

import {
  PERFORMANCE_STYLES,
  applyPerformanceStyle,
  expandSpeechTokens,
  prepareTextForPerformance,
} from "../app/lib/performanceStyles";
import { DEFAULT_CONTROLS } from "../app/lib/workspace";

describe("performance styles", () => {
  test("applies emotion presets while preserving output format", () => {
    const angry = applyPerformanceStyle({ ...DEFAULT_CONTROLS, format: "mp3" }, "angry");
    const romantic = applyPerformanceStyle(DEFAULT_CONTROLS, "romantic");

    expect(angry.format).toBe("mp3");
    expect(angry.speed).toBeGreaterThan(DEFAULT_CONTROLS.speed);
    expect(angry.volumeDb).toBeGreaterThan(DEFAULT_CONTROLS.volumeDb);
    expect(romantic.speed).toBeLessThan(DEFAULT_CONTROLS.speed);
    expect(romantic.pauseScale).toBeGreaterThan(DEFAULT_CONTROLS.pauseScale);
  });

  test("includes creator pro style recipes", () => {
    const ids = new Set(PERFORMANCE_STYLES.map((style) => style.id));

    expect(ids).toContain("documentary");
    expect(ids).toContain("advertisement");
    expect(ids).toContain("tutorial");
    expect(ids).toContain("audiobook");
    expect(applyPerformanceStyle({ ...DEFAULT_CONTROLS, format: "mp3" }, "advertisement").format).toBe("mp3");
  });

  test("expands common tokens that sound mechanical when read literally", () => {
    expect(expandSpeechTokens("Kural v2.1 uses AI & TTS for WAV export at 90%.")).toBe(
      "Kural version 2 point 1 uses A I and T T S for wave export at 90 percent."
    );
  });

  test("prepares safe SSML breaks for natural styles", () => {
    const prepared = prepareTextForPerformance(
      "AI says <hello>, softly. Are you there?",
      "romantic",
      false
    );

    expect(prepared.ssml).toBe(true);
    expect(prepared.text).toContain("<speak>");
    expect(prepared.text).toContain("A I says &lt;hello&gt;");
    expect(prepared.text).toContain('<break time="470ms"/>');
  });

  test("keeps user-authored SSML untouched", () => {
    const prepared = prepareTextForPerformance(
      '<speak>Hello <break time="250ms"/>world</speak>',
      "dramatic",
      true
    );

    expect(prepared).toEqual({
      text: '<speak>Hello <break time="250ms"/>world</speak>',
      ssml: true,
    });
  });
});
