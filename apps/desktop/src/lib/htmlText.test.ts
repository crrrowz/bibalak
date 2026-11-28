import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText, stripTags } from "./htmlText";

describe("htmlText", () => {
  it("strips nested and broken-up tags until none are left", () => {
    expect(stripTags("<b>bold</b> <i>it</i>")).toBe("bold it");
    expect(stripTags("<<b>script>x")).toBe("x");
    expect(stripTags("a<br>b", " ")).toBe("a b");
  });

  it("decodes each entity once (no double unescaping)", () => {
    expect(decodeEntities("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(decodeEntities("&lt;i&gt; &quot;q&quot; &apos;a&#39; &#x27;")).toBe("<i> \"q\" 'a' '");
    expect(decodeEntities("x&nbsp;y &#1576;")).toBe("x y ب");
    expect(decodeEntities("&#99999999; &unknown;")).toBe("&#99999999; &unknown;");
  });

  it("turns card HTML into plain text", () => {
    expect(htmlToText("<div>Tom &amp;amp; Jerry</div>")).toBe("Tom &amp; Jerry");
    expect(htmlToText("  <p>&nbsp;</p> ")).toBe("");
    expect(htmlToText('<img src="diagram.png">')).toBe("diagram.png");
    expect(htmlToText("<audio src='clip.mp3'></audio>")).toBe("clip.mp3");
  });
});
