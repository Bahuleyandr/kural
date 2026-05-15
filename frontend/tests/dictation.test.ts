import { describe, expect, it } from "vitest";

import {
  applyTranscriptFrame,
  floatTo16BitPCM,
  fullTranscript,
  INITIAL_DICTATION_STATE,
  type DictationState,
} from "../app/lib/dictation";

describe("floatTo16BitPCM", () => {
  it("encodes silence as zero bytes", () => {
    const out = new Int16Array(floatTo16BitPCM(new Float32Array([0, 0, 0])));
    expect([...out]).toEqual([0, 0, 0]);
  });

  it("maps the full-scale range to the asymmetric int16 bounds", () => {
    const out = new Int16Array(floatTo16BitPCM(new Float32Array([1, -1, 0.5])));
    expect(out[0]).toBe(32767); // +1.0 -> int16 max
    expect(out[1]).toBe(-32768); // -1.0 -> int16 min
    // setInt16 truncates toward zero (ToInt16), so 0.5 * 0x7fff = 16383.5 -> 16383.
    expect(out[2]).toBe(Math.trunc(0.5 * 0x7fff));
  });

  it("clamps samples that drift outside [-1, 1]", () => {
    const out = new Int16Array(floatTo16BitPCM(new Float32Array([2, -2])));
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
  });

  it("writes little-endian byte order", () => {
    // +1.0 -> 0x7fff -> bytes [0xff, 0x7f] when little-endian.
    const bytes = new Uint8Array(floatTo16BitPCM(new Float32Array([1])));
    expect([...bytes]).toEqual([0xff, 0x7f]);
  });
});

describe("applyTranscriptFrame", () => {
  it("replaces the live partial without touching finalized text", () => {
    const base: DictationState = {
      ...INITIAL_DICTATION_STATE,
      finalizedText: "hello",
      status: "listening",
    };
    const next = applyTranscriptFrame(base, { type: "partial", text: "wor" });
    expect(next.partialText).toBe("wor");
    expect(next.finalizedText).toBe("hello");
    expect(next.status).toBe("listening");
  });

  it("commits a final utterance and clears the partial", () => {
    const base: DictationState = {
      ...INITIAL_DICTATION_STATE,
      finalizedText: "hello",
      partialText: "wor",
      status: "listening",
    };
    const next = applyTranscriptFrame(base, { type: "final", text: "world" });
    expect(next.finalizedText).toBe("hello world");
    expect(next.partialText).toBe("");
    // A non-complete final keeps the session listening.
    expect(next.status).toBe("listening");
  });

  it("flips status to done on the complete final frame", () => {
    const base: DictationState = {
      ...INITIAL_DICTATION_STATE,
      finalizedText: "hello",
      status: "listening",
    };
    const next = applyTranscriptFrame(base, {
      type: "final",
      text: "world",
      complete: true,
    });
    expect(next.status).toBe("done");
    expect(next.finalizedText).toBe("hello world");
  });

  it("surfaces an error frame so the widget can show a fallback", () => {
    const next = applyTranscriptFrame(INITIAL_DICTATION_STATE, {
      type: "error",
      code: "local_asr_unavailable",
      message: "vosk is not installed.",
    });
    expect(next.status).toBe("error");
    expect(next.error).toBe("vosk is not installed.");
  });

  it("does not double-space when finalized text is still empty", () => {
    const next = applyTranscriptFrame(INITIAL_DICTATION_STATE, {
      type: "final",
      text: "first",
    });
    expect(next.finalizedText).toBe("first");
  });
});

describe("fullTranscript", () => {
  it("joins committed utterances with the live partial", () => {
    expect(
      fullTranscript({
        ...INITIAL_DICTATION_STATE,
        finalizedText: "hello world",
        partialText: "and",
      })
    ).toBe("hello world and");
  });

  it("returns an empty string when nothing has been transcribed", () => {
    expect(fullTranscript(INITIAL_DICTATION_STATE)).toBe("");
  });
});
