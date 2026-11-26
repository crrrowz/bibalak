import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MountLayer, PET_SPECIES, PetLayer, VARIANT_TINTS } from "./index";

describe("Pet and Mount 16x16 SVG layers (14e)", () => {
  afterEach(() => {
    document.documentElement.dir = "ltr";
  });

  it("renders all 9 species with variant tints on a 16x16 grid without RTL mirroring", () => {
    document.documentElement.dir = "rtl";
    expect(PET_SPECIES).toHaveLength(9);

    for (const species of PET_SPECIES) {
      for (const variant of Object.keys(VARIANT_TINTS)) {
        const { container, unmount } = render(
          <PetLayer itemKey={`${species}:${variant}`} width={32} height={32} />,
        );
        const svg = container.querySelector("svg[data-layer='pet']");
        expect(svg).not.toBeNull();
        expect(svg).toHaveAttribute("viewBox", "0 0 16 16");
        expect(svg).toHaveAttribute("direction", "ltr");
        expect((svg as SVGSVGElement).style.direction).toBe("ltr");
        expect(svg?.getAttribute("data-item")).toBe(`${species}:${variant}`);
        expect(svg?.getAttribute("data-variant")).toBe(variant);
        expect(svg?.querySelectorAll("rect").length).toBeGreaterThan(2);
        unmount();
      }
    }
  });

  it("renders distinct variant tint fills and mount pose layers", () => {
    const classic = render(<PetLayer itemKey="owl:classic" />);
    const gilded = render(<PetLayer itemKey="owl:gilded" />);
    const classicColors = Array.from(classic.container.querySelectorAll("rect")).map((r) =>
      r.getAttribute("fill"),
    );
    const gildedColors = Array.from(gilded.container.querySelectorAll("rect")).map((r) =>
      r.getAttribute("fill"),
    );
    expect(classicColors).not.toEqual(gildedColors);
    classic.unmount();
    gilded.unmount();

    for (const species of PET_SPECIES) {
      const { container, unmount } = render(<MountLayer itemKey={`${species}:classic`} />);
      const svg = container.querySelector("svg[data-layer='mount']");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("viewBox", "0 0 16 16");
      expect(svg).toHaveAttribute("direction", "ltr");
      expect((svg as SVGSVGElement).style.direction).toBe("ltr");
      expect(svg?.querySelectorAll("rect").length).toBeGreaterThan(3);
      unmount();
    }
  });
});
