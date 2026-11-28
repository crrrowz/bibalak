import { useContext } from "react";
import { render, screen } from "@testing-library/react";
import { MotionConfigContext } from "framer-motion";
import { describe, expect, it } from "vitest";
import { Providers } from "./providers";

function ReducedMotionProbe() {
  const ctx = useContext(MotionConfigContext);
  return <span data-testid="motion-policy">{String(ctx.reducedMotion)}</span>;
}

describe("Providers (A5-13)", () => {
  it("configures MotionConfig reducedMotion='user' at the app root", () => {
    render(
      <Providers>
        <ReducedMotionProbe />
      </Providers>,
    );
    expect(screen.getByTestId("motion-policy")).toHaveTextContent("user");
  });
});
