import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CertificateIcon,
  GoldIcon,
  KnowledgePointsIcon,
  LectureLogIcon,
  LevelIcon,
  StyleDefaultIcon,
  StyleGameIcon,
  StyleScholarIcon,
  TranscriptIcon,
  XpIcon,
} from "./index";

const ICONS = [
  ["LevelIcon", LevelIcon],
  ["XpIcon", XpIcon],
  ["GoldIcon", GoldIcon],
  ["KnowledgePointsIcon", KnowledgePointsIcon],
  ["StyleDefaultIcon", StyleDefaultIcon],
  ["StyleScholarIcon", StyleScholarIcon],
  ["StyleGameIcon", StyleGameIcon],
  ["CertificateIcon", CertificateIcon],
  ["TranscriptIcon", TranscriptIcon],
  ["LectureLogIcon", LectureLogIcon],
] as const;

describe("progress SVG icons", () => {
  it.each(ICONS)(
    "%s renders a 24x24 currentColor lucide-style SVG with aria-hidden by default",
    (_name, Icon) => {
      const { container } = render(<Icon className="size-4" />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg).toHaveAttribute("stroke", "currentColor");
      expect(svg).toHaveAttribute("fill", "none");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveClass("size-4");
      expect(
        svg?.querySelectorAll("path, circle, rect, line, polyline, polygon").length,
      ).toBeGreaterThan(0);
    },
  );

  it("allows overriding aria-hidden and setting aria-label", () => {
    const { container } = render(<LevelIcon aria-hidden={false} aria-label="Level" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "false");
    expect(svg).toHaveAttribute("aria-label", "Level");
  });
});
