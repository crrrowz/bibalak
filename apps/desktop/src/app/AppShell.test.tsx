import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { useTheme } from "@/stores/theme";
import { useSound } from "@/stores/sound";
import { useStyle } from "@/stores/style";
import { useLocale } from "@/lib/i18n";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    activeOptions: _activeOptions,
    activeProps: _activeProps,
    inactiveProps: _inactiveProps,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    activeOptions?: unknown;
    activeProps?: unknown;
    inactiveProps?: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  Outlet: () => <div>outlet</div>,
  useMatchRoute: () => (opts: { to: string }) => opts.to === "/",
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/useCoreEvents", () => ({
  useCoreEvents: () => {},
}));

vi.mock("@/components/TitleBar", () => ({
  TitleBar: ({
    onToggleSidebar,
    showSidebarDock,
  }: {
    onToggleSidebar?: () => void;
    showSidebarDock?: boolean;
  }) => (
    <div>
      {showSidebarDock && onToggleSidebar && (
        <button type="button" onClick={onToggleSidebar} aria-label="Show navigation">
          Menu
        </button>
      )}
    </div>
  ),
}));

vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: () => null,
}));

vi.mock("@/components/KeyboardShortcutsDialog", () => ({
  KeyboardShortcutsDialog: () => null,
}));

vi.mock("@/features/progress/CelebrationHost", () => ({
  CelebrationHost: () => null,
}));

vi.mock("@/features/progress/StyleHud", () => ({
  StyleHud: () => null,
}));

vi.mock("@/components/ui/toast", () => ({
  Toaster: () => null,
}));

describe("AppShell accessibility (B2)", () => {
  it("gives compact nav links accessible names, marks active route with aria-current, and makes main focusable", () => {
    localStorage.setItem("sb-width", "60");
    render(<AppShell />);

    const decksLink = screen.getByRole("link", { name: "Decks" });
    expect(decksLink).toHaveAttribute("aria-current", "page");

    const statsLink = screen.getByRole("link", { name: "Stats" });
    expect(statsLink).not.toHaveAttribute("aria-current");

    const assistantLink = screen.getByRole("link", { name: "Assistant" });
    expect(assistantLink).toHaveAttribute("href", "/assistant");

    const links = screen.getAllByRole("link");
    const statsIdx = links.indexOf(statsLink);
    const assistantIdx = links.indexOf(assistantLink);
    expect(assistantIdx).toBe(statsIdx + 1);

    const settingsLink = screen.getByRole("link", { name: "Settings" });
    expect(settingsLink).toBeInTheDocument();

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("M2: renders Plan sidebar group under the study items with Matrix link", () => {
    localStorage.setItem("sb-width", "220");
    render(<AppShell />);

    expect(screen.getByText("Plan")).toBeInTheDocument();
    const matrixLink = screen.getByRole("link", { name: "Matrix" });
    expect(matrixLink).toHaveAttribute("href", "/plan/matrix");

    const habitsLink = screen.getByRole("link", { name: "Habits" });
    expect(habitsLink).toHaveAttribute("href", "/plan/habits");

    const calendarLink = screen.getByRole("link", { name: "Calendar" });
    expect(calendarLink).toHaveAttribute("href", "/plan/calendar");

    const links = screen.getAllByRole("link");
    const assistantLink = screen.getByRole("link", { name: "Assistant" });
    expect(links.indexOf(matrixLink)).toBeGreaterThan(links.indexOf(assistantLink));
    expect(links.indexOf(habitsLink)).toBeGreaterThan(links.indexOf(matrixLink));
    expect(links.indexOf(calendarLink)).toBeGreaterThan(links.indexOf(habitsLink));
  });

  it("OT-11: renders icon-only Settings and quick toggles row with language, theme, and sound", async () => {
    localStorage.setItem("sb-width", "220");
    const user = userEvent.setup();
    render(<AppShell />);

    // Settings is icon-only in wide mode too (no visible text label)
    const settingsLink = screen.getByRole("link", { name: "Settings" });
    expect(settingsLink).toBeInTheDocument();
    expect(settingsLink).toHaveAttribute("title", "Settings");
    expect(settingsLink.textContent?.trim()).toBe("");

    // Quick toggles exist with accessible labels and tooltips
    const langBtn = screen.getByRole("button", { name: /language|switch to/i });
    expect(langBtn).toBeInTheDocument();
    expect(langBtn).toHaveTextContent(/EN|AR/);

    const themeBtn = screen.getByRole("button", { name: /theme/i });
    expect(themeBtn).toBeInTheDocument();

    const soundBtn = screen.getByRole("button", { name: /sound|volume/i });
    expect(soundBtn).toBeInTheDocument();

    // Clicking language toggles locale
    const initialLocale = useLocale.getState().locale;
    await user.click(langBtn);
    expect(useLocale.getState().locale).toBe(initialLocale === "en" ? "ar" : "en");

    // Clicking theme toggles theme light <-> dark
    const initialTheme = useTheme.getState().resolved;
    await user.click(themeBtn);
    expect(useTheme.getState().resolved).toBe(initialTheme === "dark" ? "light" : "dark");

    // Clicking sound opens volume popover with Card audio + App sounds sliders and mute toggles
    expect(
      screen.queryByRole("slider", { name: /card audio|صوت البطاقات/i }),
    ).not.toBeInTheDocument();
    await user.click(soundBtn);
    const cardSlider = await screen.findByRole("slider", { name: /card audio|صوت البطاقات/i });
    const appSlider = screen.getByRole("slider", { name: /app sounds|أصوات التطبيق/i });
    expect(cardSlider).toBeInTheDocument();
    expect(appSlider).toBeInTheDocument();
    expect(cardSlider).toHaveAttribute("aria-valuemin", "0");
    expect(cardSlider).toHaveAttribute("aria-valuemax", "100");
    const muteBtns = screen.getAllByRole("button", { name: /mute|كتم/i });
    expect(muteBtns).toHaveLength(2);
  });

  it("OT-11: stacks quick toggles in a column in compact mode", () => {
    localStorage.setItem("sb-width", "60");
    const { container } = render(<AppShell />);

    const footer = container.querySelector("[data-testid='sidebar-footer']");
    expect(footer).toBeInTheDocument();
    expect(footer?.className).toMatch(/flex-col/);
  });

  it("H1: renders volume popover in a document.body portal above main content and handles arrows/Escape without leaking", async () => {
    useLocale.getState().setLocale("en");
    localStorage.setItem("sb-width", "220");
    useSound.getState().setCardVolume(50);
    useSound.getState().setCardMuted(false);
    const user = userEvent.setup();
    render(<AppShell />);

    const soundBtn = screen.getByRole("button", { name: /sound|volume/i });
    await user.click(soundBtn);

    const slider = await screen.findByRole("slider", { name: "Card audio" });
    expect(slider.closest("aside")).toBeNull();
    const popover = screen.getByTestId("volume-popover");
    expect(popover.parentElement).toBe(document.body);
    expect(popover.className).toMatch(/\bz-50\b/);

    // Arrow keys on the focused slider change volume and do not leak to window listeners.
    const windowKeySpy = vi.fn();
    window.addEventListener("keydown", windowKeySpy);
    try {
      slider.focus();
      await user.keyboard("{ArrowRight}");
      expect(useSound.getState().cardVolume).toBe(51);
      await user.keyboard("{ArrowDown}");
      expect(useSound.getState().cardVolume).toBe(50);
      expect(windowKeySpy).not.toHaveBeenCalled();

      // Escape closes the popover without leaking to underlying window Escape handlers.
      await user.keyboard("{Escape}");
      expect(soundBtn).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => {
        expect(screen.queryByTestId("volume-popover")).not.toBeInTheDocument();
      });
      expect(windowKeySpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", windowKeySpy);
    }
  });

  it("14d: shows Character in Game and Scholar, Shop only in Game, and neither in Default", () => {
    localStorage.setItem("sb-width", "220");
    useStyle.getState().setStyle("default");
    const { rerender } = render(<AppShell />);

    expect(screen.queryByRole("link", { name: "Character" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Shop" })).not.toBeInTheDocument();

    useStyle.getState().setStyle("scholar");
    rerender(<AppShell />);
    expect(screen.getByRole("link", { name: "Character" })).toHaveAttribute("href", "/character");
    expect(screen.queryByRole("link", { name: "Shop" })).not.toBeInTheDocument();

    useStyle.getState().setStyle("game");
    rerender(<AppShell />);
    expect(screen.getByRole("link", { name: "Character" })).toHaveAttribute("href", "/character");
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute("href", "/shop");

    useStyle.getState().setStyle("default");
  });

  it("footer_volume_popover_has_card_and_app_sliders_with_own_mute", async () => {
    useLocale.getState().setLocale("en");
    localStorage.setItem("sb-width", "60");
    useSound.getState().setCardVolume(60);
    useSound.getState().setCardMuted(false);
    useSound.getState().setAppVolume(40);
    useSound.getState().setAppMuted(false);
    const user = userEvent.setup();
    render(<AppShell />);

    const soundBtn = screen.getByRole("button", { name: /sound|volume/i });
    expect(soundBtn.querySelector(".lucide-volume-x")).toBeNull();

    await user.click(soundBtn);
    const popover = await screen.findByTestId("volume-popover");
    expect(popover.parentElement).toBe(document.body);

    const cardSlider = screen.getByRole("slider", { name: "Card audio" });
    const appSlider = screen.getByRole("slider", { name: "App sounds" });
    expect(cardSlider).toHaveAttribute("aria-valuenow", "60");
    expect(appSlider).toHaveAttribute("aria-valuenow", "40");

    // Arrow keys move the focused slider
    cardSlider.focus();
    await user.keyboard("{ArrowRight}");
    expect(useSound.getState().cardVolume).toBe(61);
    appSlider.focus();
    await user.keyboard("{ArrowDown}");
    expect(useSound.getState().appVolume).toBe(39);

    // Muting only one channel keeps footer icon unmuted
    const muteCardBtn = screen.getByRole("button", { name: "Mute card audio" });
    const muteAppBtn = screen.getByRole("button", { name: "Mute app sounds" });
    await user.click(muteCardBtn);
    expect(useSound.getState().cardMuted).toBe(true);
    expect(useSound.getState().appMuted).toBe(false);
    expect(soundBtn.querySelector(".lucide-volume-x")).toBeNull();

    // Muting both channels shows muted icon on footer button
    await user.click(muteAppBtn);
    expect(useSound.getState().appMuted).toBe(true);
    expect(soundBtn.querySelector(".lucide-volume-x")).not.toBeNull();

    // Esc closes and returns focus to footer sound button
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("volume-popover")).not.toBeInTheDocument();
    });
    expect(soundBtn).toHaveFocus();
  });

  it("footer_style_switcher_changes_style_and_matches_settings", async () => {
    useLocale.getState().setLocale("en");
    localStorage.setItem("sb-width", "60");
    useStyle.getState().setStyle("default");
    const user = userEvent.setup();
    render(<AppShell />);

    const styleBtn = screen.getByRole("button", { name: /^Style$/i });
    await user.click(styleBtn);

    const popover = await screen.findByTestId("style-popover");
    expect(popover.parentElement).toBe(document.body);
    expect(popover.className).toMatch(/\bz-50\b/);

    const defaultOpt = screen.getByRole("radio", { name: "Default" });
    const scholarOpt = screen.getByRole("radio", { name: "Scholar" });
    const gameOpt = screen.getByRole("radio", { name: "Game" });
    expect(defaultOpt).toHaveAttribute("aria-checked", "true");

    await user.click(scholarOpt);
    expect(useStyle.getState().style).toBe("scholar");
    expect(document.documentElement).toHaveAttribute("data-style", "scholar");

    // Reopen and verify external Settings change is reflected, plus Esc returns focus
    await user.click(styleBtn);
    expect(screen.getByRole("radio", { name: "Scholar" })).toHaveAttribute("aria-checked", "true");
    await user.click(gameOpt);
    expect(useStyle.getState().style).toBe("game");
    expect(document.documentElement).toHaveAttribute("data-style", "game");

    await user.click(styleBtn);
    const reopened = await screen.findByTestId("style-popover");
    expect(reopened).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("style-popover")).not.toBeInTheDocument();
    });
    expect(styleBtn).toHaveFocus();
    useStyle.getState().setStyle("default");
  });

  it("H4 / A1-22: docks CommandPaletteTip in header flow so it never covers sidebar-footer or screen CTAs", () => {
    localStorage.removeItem("keepsake:cmdk-tip-dismissed");
    const { container } = render(<AppShell />);

    const tip = screen.getByTestId("command-palette-tip");
    const main = container.querySelector("#main-content");
    const sidebar = container.querySelector("aside");

    expect(tip).toBeInTheDocument();
    expect(tip.className).not.toMatch(/\b(absolute|fixed)\b/);
    expect(sidebar?.contains(tip)).toBe(false);
    expect(main?.contains(tip)).toBe(false);
  });

  it("BW2-11: stacks footer controls before overlap at narrow widths and shows tooltips at minimum width in EN and AR", () => {
    for (const loc of ["en", "ar"] as const) {
      useLocale.getState().setLocale(loc);
      localStorage.setItem("sb-width", "120");
      const { container, unmount } = render(<AppShell />);
      const narrowFooter = container.querySelector("[data-testid='sidebar-footer']");
      expect(narrowFooter?.className).toMatch(/flex-col/);
      unmount();

      localStorage.setItem("sb-width", "44");
      const minRender = render(<AppShell />);
      const minFooter = minRender.container.querySelector("[data-testid='sidebar-footer']");
      expect(minFooter?.className).toMatch(/flex-col/);
      const navLinks = minRender.container.querySelectorAll("nav a");
      expect(navLinks.length).toBeGreaterThan(0);
      navLinks.forEach((link) => {
        expect(link.getAttribute("title")).toBeTruthy();
        expect(link.getAttribute("aria-label")).toBeTruthy();
      });
      minRender.unmount();
    }
    useLocale.getState().setLocale("en");
  });

  it("A5-05: toggles sidebar mode with physical Alt+KeyZ under Arabic keyboard layout", async () => {
    localStorage.setItem("sb-mode", "docked");
    render(<AppShell />);

    fireEvent.keyDown(document, { key: "ئ", code: "KeyZ", altKey: true });
    await waitFor(() => expect(localStorage.getItem("sb-mode")).toBe("hover"));
    localStorage.removeItem("sb-mode");
  });

  it("A5-14: collapses sidebar into an overlay drawer below 768px and closes on backdrop or Escape", async () => {
    const user = userEvent.setup();
    const prevWidth = window.innerWidth;
    localStorage.setItem("sb-mode", "docked");
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true, writable: true });

    try {
      const { container } = render(<AppShell />);

      // Docked sidebar must not take horizontal space when viewport is < 768px.
      expect(container.querySelector("aside")).toBeNull();
      expect(screen.queryByRole("navigation")).toBeNull();

      const toggleBtn = screen.getByRole("button", { name: /show navigation/i });
      await user.click(toggleBtn);

      const drawer = await screen.findByTestId("mobile-sidebar-drawer");
      expect(drawer).toHaveAttribute("aria-modal", "true");
      expect(screen.getByRole("navigation")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByTestId("mobile-sidebar-drawer")).not.toBeInTheDocument();
      });

      await user.click(toggleBtn);
      await user.click(await screen.findByTestId("mobile-sidebar-backdrop"));
      await waitFor(() => {
        expect(screen.queryByTestId("mobile-sidebar-drawer")).not.toBeInTheDocument();
      });
    } finally {
      Object.defineProperty(window, "innerWidth", {
        value: prevWidth,
        configurable: true,
        writable: true,
      });
      localStorage.removeItem("sb-mode");
    }
  });
});
