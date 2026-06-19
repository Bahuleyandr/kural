import { describe, expect, it } from "vitest";

import { wsAuthProtocols } from "../app/lib/api";

describe("wsAuthProtocols", () => {
  it("offers no subprotocol when no key is set (auth disabled)", () => {
    expect(wsAuthProtocols("")).toEqual([]);
  });

  it("carries the key as a base64url subprotocol token, not in the URL", () => {
    const protocols = wsAuthProtocols("s3cret-key_42");
    expect(protocols).toHaveLength(2);
    expect(protocols[1]).toBe("kural.v1");
    expect(protocols[0].startsWith("kural-apikey.")).toBe(true);

    const token = protocols[0].slice("kural-apikey.".length);
    // base64url alphabet only — these would be illegal in a WS subprotocol token.
    expect(token).not.toMatch(/[+/=]/);

    // round-trips back to the original key
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    expect(Buffer.from(b64, "base64").toString("utf-8")).toBe("s3cret-key_42");
  });
});
