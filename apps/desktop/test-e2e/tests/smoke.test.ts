/**
 * E2E smoke suite for Bibalak (runs via tauri-driver + WebDriverIO).
 *
 * Scenarios:
 *   1. Dismiss first-run onboarding and verify the deck browser is reachable.
 *   2. Create a deck.
 *   3. Navigate to Add Note.
 *   4. Navigate to Settings.
 *
 * Selectors use ARIA roles, stable ids/hrefs, and `data-testid` rather than
 * visible locale strings so they stay independent of UI copy and language.
 */

const TIMEOUT = 10_000;

describe("Bibalak smoke", () => {
  before(async () => {
    // Wait for the shell to mount, then dismiss first-run onboarding if shown.
    const nav = await browser.$("nav[aria-label]");
    await nav.waitForExist({ timeout: TIMEOUT });

    const skipBtn = await browser.$("[data-testid='onboarding-skip']");
    const hasOnboarding = await skipBtn.waitForExist({ timeout: 5_000 }).catch(() => false);
    if (hasOnboarding) {
      await skipBtn.waitForClickable({ timeout: TIMEOUT });
      await skipBtn.click();
    }

    // Ensure the modal and its backdrop have finished closing before interacting.
    const dialog = await browser.$("[role='dialog']");
    await dialog.waitForExist({ timeout: TIMEOUT, reverse: true });
    const backdrop = await browser.$("[data-testid='dialog-backdrop']");
    await backdrop.waitForExist({ timeout: TIMEOUT, reverse: true });
  });

  it("shows the deck browser on launch", async () => {
    const nav = await browser.$("nav[aria-label]");
    await expect(nav).toExist();
    const newDeckBtn = await browser.$("[data-testid='new-deck-button']");
    await expect(newDeckBtn).toBeDisplayed();
  });

  it("can create a new deck", async () => {
    const newDeckBtn = await browser.$("[data-testid='new-deck-button']");
    await newDeckBtn.waitForClickable({ timeout: TIMEOUT });
    await newDeckBtn.click();

    const input = await browser.$("[data-testid='create-deck-input']");
    await input.waitForDisplayed({ timeout: TIMEOUT });
    await input.setValue("E2E Test Deck");

    // Click Create directly — synthetic Enter keypresses don't reliably
    // trigger form submit on the GTK webview used in CI.
    const createBtn = await browser.$("[data-testid='create-deck-submit']");
    await createBtn.waitForClickable({ timeout: TIMEOUT });
    await createBtn.click();

    // The deck now appears in the list. Bare `*=` only matches <a> tags
    // (WebdriverIO's "partial link text" strategy) — the deck name renders
    // in a <span>, so scope the text match to that tag.
    const deckEntry = await browser.$("span*=E2E Test Deck");
    await deckEntry.waitForExist({ timeout: TIMEOUT });
    await expect(deckEntry).toExist();
  });

  it("can navigate to Add Note", async () => {
    const addLink = await browser.$("a[href='/add']");
    await addLink.waitForClickable({ timeout: TIMEOUT });
    await addLink.click();

    const notetypeSelect = await browser.$("#add-notetype");
    await notetypeSelect.waitForExist({ timeout: TIMEOUT });
    const heading = await browser.$("h1");
    await expect(heading).toExist();
  });

  it("can navigate to Settings", async () => {
    const settingsLink = await browser.$("a[href='/settings']");
    await settingsLink.waitForClickable({ timeout: TIMEOUT });
    await settingsLink.click();

    const categoriesTablist = await browser.$("[role='tablist']");
    await categoriesTablist.waitForExist({ timeout: TIMEOUT });
    const heading = await browser.$("h1");
    await expect(heading).toExist();
  });
});
