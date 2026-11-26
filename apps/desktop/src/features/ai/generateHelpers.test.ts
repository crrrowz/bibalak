import { describe, expect, it } from "vitest";
import { buildClozePreviewHtml, plainTextToFieldHtml } from "@/lib/aiFormat";
import {
  buildGeneratedBrowseQuery,
  distributeCardCounts,
  matchingNotetypesForKind,
} from "./generateHelpers";

describe("generateHelpers & aiFormat (AI1)", () => {
  it("distributes requested cards evenly across chunks without exceeding the total", () => {
    expect(distributeCardCounts(15, 3)).toEqual([5, 5, 5]);
    expect(distributeCardCounts(10, 3)).toEqual([4, 3, 3]);
    expect(distributeCardCounts(5, 9)).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0]);
    expect(distributeCardCounts(2, 4).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2);
    expect(distributeCardCounts(15, 0)).toEqual([]);
  });

  it("filters notetypes by Basic/Cloze kind and excludes Image Occlusion", () => {
    const list = [
      {
        id: 1,
        name: "Basic",
        kind: 0n,
        field_names: ["Front", "Back"],
        note_count: 1,
      },
      {
        id: 2,
        name: "Cloze",
        kind: 1n,
        field_names: ["Text", "Back Extra"],
        note_count: 1,
      },
      {
        id: 3,
        name: "Image Occlusion",
        kind: 1n,
        field_names: ["Image", "Occlusion", "Header"],
        note_count: 0,
      },
    ];
    expect(matchingNotetypesForKind(list, "basic").map((n) => n.name)).toEqual(["Basic"]);
    expect(matchingNotetypesForKind(list, "cloze").map((n) => n.name)).toEqual(["Cloze"]);
  });

  it("builds Browse search queries with tag filter and escaped deck names", () => {
    expect(buildGeneratedBrowseQuery("Anatomy", true)).toBe('tag:ai-generated deck:"Anatomy"');
    expect(buildGeneratedBrowseQuery('Bio "101"', false)).toBe('deck:"Bio \\"101\\""');
  });

  it("escapes untrusted HTML and turns newlines into <br> while keeping cloze syntax", () => {
    const out = plainTextToFieldHtml("Check <script>x</script>\n{{c1::SA node}} & AV node");
    expect(out).toBe("Check &lt;script&gt;x&lt;/script&gt;<br>{{c1::SA node}} &amp; AV node");
    expect(out).not.toContain("<script>");

    const front = buildClozePreviewHtml(out, "front");
    expect(front).toContain('<span class="cloze">[…]</span>');
    expect(front).not.toContain("SA node");

    const back = buildClozePreviewHtml(out, "back");
    expect(back).toContain('<span class="cloze">SA node</span>');
  });
});
