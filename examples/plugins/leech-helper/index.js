/* global BibalakPlugin */
// Leech Helper sample plugin (MIT License).

BibalakPlugin.definePlugin({
  activate(ctx) {
    let leeches = [];
    let isLoading = false;
    let lastError = null;

    function previewText(note) {
      const first = note.fields && note.fields[0] ? note.fields[0].text : note.sortField;
      const clean = String(first || "")
        .replace(/\s+/g, " ")
        .trim();
      return clean.length > 72 ? clean.slice(0, 71) + "…" : clean || "(Empty note)";
    }

    function renderBlocks() {
      if (isLoading) {
        return [{ type: "text", text: "Searching for leech notes…", tone: "muted" }];
      }
      if (lastError) {
        return [
          { type: "text", text: lastError, tone: "danger" },
          {
            type: "actions",
            buttons: [{ id: "refresh", label: "Retry", variant: "secondary" }],
          },
        ];
      }

      return [
        { type: "heading", text: "Leech notes" },
        { type: "stat", label: "Tagged leech", value: String(leeches.length) },
        {
          type: "actions",
          buttons: [
            { id: "browse-all", label: "Open all in Browse", variant: "primary" },
            { id: "refresh", label: "Refresh", variant: "secondary" },
          ],
        },
        { type: "divider" },
        {
          type: "list",
          emptyText: "No leech notes found.",
          items: leeches.map((n) => ({
            id: String(n.noteId),
            title: previewText(n),
            subtitle: (n.deck || "Default") + " · " + n.notetype,
            badge: "leech",
            actionLabel: "Open in Browse",
            actionId: "open-note",
            actionPayload: n.sortField || "tag:leech",
          })),
        },
      ];
    }

    async function loadLeeches() {
      isLoading = true;
      lastError = null;
      panel.update(renderBlocks());
      try {
        leeches = await ctx.notes.search("tag:leech", { limit: 50 });
        return leeches;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        return [];
      } finally {
        isLoading = false;
        panel.update(renderBlocks());
      }
    }

    const panel = ctx.addSidebarPanel({
      id: "leech-helper",
      title: "Leech Helper",
      blocks: renderBlocks(),
      async onAction(actionId, payload) {
        if (actionId === "refresh") {
          await loadLeeches();
        } else if (actionId === "browse-all") {
          ctx.navigation.openBrowse("tag:leech");
        } else if (actionId === "open-note") {
          const query =
            typeof payload === "string" && payload.trim().length > 0
              ? "tag:leech " + payload.trim().slice(0, 80)
              : "tag:leech";
          ctx.navigation.openBrowse(query);
        }
      },
    });

    ctx.registerCommand({
      id: "list-leeches",
      title: "Leech Helper: List leech cards",
      async run() {
        const found = await loadLeeches();
        if (found.length === 0) {
          ctx.showToast("No leech notes found.");
        } else {
          ctx.showToast("Found " + String(found.length) + " leech note(s). Opening Browse…");
          ctx.navigation.openBrowse("tag:leech");
        }
      },
    });

    void loadLeeches();
  },
});
