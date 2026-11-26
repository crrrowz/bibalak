import { describe, expect, it } from "vitest";
import { cleanPastedHtml } from "./editorPaste";

describe("cleanPastedHtml", () => {
  it("strips Word styles, classes, Mso wrappers, and conditional comments while keeping allowed formatting", () => {
    const wordHtml = `
      <!--[if gte mso 9]><xml><w:WordDocument><w:View>Normal</w:View></w:WordDocument></xml><![endif]-->
      <style>p.MsoNormal { font-family: Calibri; color: red; }</style>
      <p class="MsoNormal" style="margin:0in;font-family:Calibri">
        <b>Bold</b>, <i>italic</i>, <u>underline</u>, H<sub>2</sub>O, x<sup>2</sup>
        <br><o:p>&nbsp;</o:p>
      </p>
      <ul class="MsoListParagraph" style="color:navy"><li>First</li><li>Second</li></ul>
    `;

    const clean = cleanPastedHtml(wordHtml);
    expect(clean).not.toMatch(/style=/i);
    expect(clean).not.toMatch(/class=/i);
    expect(clean).not.toMatch(/MsoNormal|Calibri|WordDocument|o:p/i);
    expect(clean).toContain("<b>Bold</b>");
    expect(clean).toContain("<i>italic</i>");
    expect(clean).toContain("<u>underline</u>");
    expect(clean).toContain("<sub>2</sub>");
    expect(clean).toContain("<sup>2</sup>");
    expect(clean).toContain("<br>");
    expect(clean).toContain("<ul>");
    expect(clean).toContain("<li>First</li>");
    expect(clean).toContain("<li>Second</li>");
  });

  it("handles Google Docs wrapper <b style='font-weight:normal'> and span-encoded bold/italic/underline", () => {
    const gdocsHtml = `
      <b id="docs-internal-guid-123" style="font-weight:normal;">
        <p dir="ltr" style="line-height:1.38;">
          <span style="font-size:11pt;color:#000000;background-color:transparent;">Plain </span>
          <span style="font-weight:700;color:#ff0000;">Strong</span>
          <span style="font-style:italic;"> Emphasis</span>
          <span style="text-decoration:underline;"> Under</span>
          <span style="vertical-align:super;">3</span>
          <span style="vertical-align:sub;">4</span>
        </p>
      </b>
    `;

    const clean = cleanPastedHtml(gdocsHtml);
    expect(clean).not.toContain("docs-internal-guid");
    expect(clean).not.toMatch(/style=|dir=|font-size|color:/i);
    expect(clean).toContain("Plain");
    expect(clean).toMatch(/<(strong|b)>Strong<\/(strong|b)>/);
    expect(clean).toMatch(/<(em|i)> Emphasis<\/(em|i)>/);
    expect(clean).toContain("<u> Under</u>");
    expect(clean).toContain("<sup>3</sup>");
    expect(clean).toContain("<sub>4</sub>");
    // The outer wrapper was font-weight:normal, so "Plain" must NOT be bold.
    expect(clean).not.toMatch(/<(strong|b)>[^<]*Plain/i);
  });

  it("strips scripts, event handlers, javascript: links, tracking pixels, and disallowed elements from web pages", () => {
    const webHtml = `
      <div class="article-hero" style="background:url(x)">
        <h1 class="title" onclick="alert(1)">Heading Title</h1>
        <p class="lead">Intro text with <a href="https://example.com/docs" onclick="steal()" class="ext">Safe Link</a> and
        <a href="javascript:alert(1)">Bad JS Link</a> and <a href="  JaVaScRiPt:void(0)">Spaced JS</a>.</p>
        <img src="https://tracker.example/pixel.png" width="1" height="1" alt="" />
        <img src="https://tracker.example/hidden.gif" style="display:none;width:10px;height:10px" />
        <img src="diagram.png" class="rounded" style="border:1px solid red" onerror="fetch('evil')" alt="Diagram" />
        <script>window.pwned = true;</script>
        <iframe src="https://evil.example"></iframe>
        <table class="grid" style="width:100%" border="1">
          <thead><tr><th class="col" style="color:red">Term</th><th>Def</th></tr></thead>
          <tbody><tr><td onclick="evil()">Alpha</td><td>Beta</td></tr></tbody>
        </table>
      </div>
    `;

    const clean = cleanPastedHtml(webHtml);
    expect(clean).not.toMatch(/<script|<iframe|alert\(|pwned|steal\(|evil\(/i);
    expect(clean).not.toMatch(/onerror|onclick|javascript:|style=|class=|border=/i);
    expect(clean).not.toContain("tracker.example/pixel.png");
    expect(clean).not.toContain("tracker.example/hidden.gif");
    expect(clean).toContain("Heading Title");
    expect(clean).toContain('<a href="https://example.com/docs">Safe Link</a>');
    expect(clean).not.toContain('<a href="javascript:');
    expect(clean).toContain("Bad JS Link");
    expect(clean).toContain("Spaced JS");
    expect(clean).toContain('<img src="diagram.png" alt="Diagram">');
    expect(clean).toContain("<table>");
    expect(clean).toContain("<th>Term</th>");
    expect(clean).toContain("<td>Alpha</td>");
    expect(clean).toContain("<td>Beta</td>");
  });
});
