import { describe, expect, it } from "vitest";
import { forecastQuery, maturityQuery } from "./statQuery";

describe("statQuery (S4)", () => {
  it("escapes quotes in deck names inside drill-down queries", () => {
    const deckWithQuotes = 'Deck "With" Quotes';
    const query = maturityQuery("young", deckWithQuotes);
    expect(query).toBe('deck:"Deck \\"With\\" Quotes*" is:review prop:ivl<21');

    const forecast = forecastQuery(3, 10, 'Pathology "GI"');
    expect(forecast).toBe('deck:"Pathology \\"GI\\"*" is:review prop:due=13');
  });

  it("handles deck names without quotes normally", () => {
    const query = maturityQuery("new", "Japanese::Kanji");
    expect(query).toBe('deck:"Japanese::Kanji*" is:new');
  });

  it("escapes backslashes before quotes in deck names", () => {
    const deckWithBackslashes = 'Unit\\1\\"Final"\\';
    const query = maturityQuery("new", deckWithBackslashes);
    expect(query).toBe('deck:"Unit\\\\1\\\\\\"Final\\"\\\\*" is:new');
  });
});
