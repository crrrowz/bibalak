import { describe, expect, it } from "vitest";
import { browseQueryForMedia } from "./media";

describe("media helpers (16k)", () => {
  it("browseQueryForMedia_escapes_anki_wildcards_and_quotes", () => {
    expect(browseQueryForMedia("heart-diagram.png")).toBe('"heart-diagram.png"');
    expect(browseQueryForMedia("a_b 1.jpg")).toBe('"a\\_b 1.jpg"');
    expect(browseQueryForMedia("c.mp3")).toBe('"c.mp3"');
    expect(browseQueryForMedia('a*b"c\\d.jpg')).toBe('"a\\*b\\"c\\\\d.jpg"');
  });
});
