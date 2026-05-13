import { describe, expect, it } from "vitest";

import { parseVoiceKey } from "../app/lib/clientUtils";

describe("parseVoiceKey", () => {
  it("treats a bare Kokoro id as the kokoro kind", () => {
    // Defensive path — a saved preset might predate the engine: prefix
    // convention. Falling back to kokoro preserves backward compatibility.
    expect(parseVoiceKey("af_bella")).toEqual({ kind: "kokoro", id: "af_bella" });
  });

  it("parses kokoro: prefix", () => {
    expect(parseVoiceKey("kokoro:af_bella")).toEqual({
      kind: "kokoro",
      id: "af_bella",
    });
  });

  it("parses clone: prefix", () => {
    expect(parseVoiceKey("clone:user-voice-1")).toEqual({
      kind: "clone",
      id: "user-voice-1",
    });
  });

  it("parses supertonic: prefix", () => {
    // The Supertonic dispatch on the backend relies on the id surviving
    // round-trip intact (st_<style>_<lang>). A stray strip here would
    // break multilingual synthesis silently.
    expect(parseVoiceKey("supertonic:st_m1_en")).toEqual({
      kind: "supertonic",
      id: "st_m1_en",
    });
  });

  it("preserves ids that themselves contain a colon", () => {
    expect(parseVoiceKey("clone:custom:1")).toEqual({
      kind: "clone",
      id: "custom:1",
    });
  });
});
