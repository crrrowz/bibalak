import { describe, expect, it } from "vitest";
import { buildBrowseFilterQuery, deckSearchToken } from "./browseHelpers";

describe("deckSearchToken (SUB1 F4)", () => {
  it("quotes the deck name and escapes Anki search syntax", () => {
    expect(deckSearchToken("Lang::Verbs")).toBe('deck:"Lang::Verbs"');
    expect(deckSearchToken('Bio "101"')).toBe('deck:"Bio \\"101\\""');
    expect(deckSearchToken("My_Deck*")).toBe('deck:"My\\_Deck\\*"');
    expect(deckSearchToken("A\\B")).toBe('deck:"A\\\\B"');
  });

  it("is used by buildBrowseFilterQuery without dropping quotes", () => {
    expect(buildBrowseFilterQuery('Bio "101"', null)).toBe('deck:"Bio \\"101\\""');
    expect(buildBrowseFilterQuery("My_Deck", "verbs")).toBe('deck:"My\\_Deck" tag:verbs');
  });
});
