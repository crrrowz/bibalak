// Registers jest-dom matchers (toBeInTheDocument, …) on Vitest's `expect`,
// and augments the matcher types globally for the whole test compilation.
import "@testing-library/jest-dom/vitest";
import { ensureLocaleLoaded } from "@/lib/i18n";

await Promise.all([ensureLocaleLoaded("en"), ensureLocaleLoaded("ar")]);
