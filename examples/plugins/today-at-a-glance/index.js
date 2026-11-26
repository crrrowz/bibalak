/* global BibalakPlugin */
// Today at a Glance sample plugin (MIT License).

BibalakPlugin.definePlugin({
  activate(ctx) {
    let cachedDecks = [];
    let isLoading = true;
    let lastError = null;

    function nextDueDeck(decks) {
      return decks.find((d) => !d.isFiltered && d.dueToday > 0) || null;
    }

    function renderBlocks() {
      if (isLoading) {
        return [{ type: "text", text: "Loading due counts…", tone: "muted" }];
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

      const active = cachedDecks.filter((d) => !d.isFiltered);
      const dueDecks = active.filter((d) => d.dueToday > 0);
      const totalDue = dueDecks.reduce((sum, d) => sum + d.dueToday, 0);
      const next = nextDueDeck(cachedDecks);

      const blocks = [
        { type: "heading", text: "Due today" },
        { type: "stat", label: "Total cards due", value: String(totalDue) },
        {
          type: "stat",
          label: "Next deck",
          value: next ? next.name : "All caught up",
        },
        {
          type: "actions",
          buttons: [
            ...(next ? [{ id: "study-next", label: "Study next deck", variant: "primary" }] : []),
            { id: "refresh", label: "Refresh", variant: "secondary" },
          ],
        },
        { type: "divider" },
        {
          type: "list",
          emptyText: "No due cards across your decks.",
          items: dueDecks.slice(0, 20).map((d) => ({
            id: String(d.id),
            title: d.name,
            subtitle:
              "New " + d.newCount + " · Learning " + d.learningCount + " · Review " + d.reviewCount,
            badge: String(d.dueToday),
            actionLabel: "Study",
            actionId: "open-deck",
            actionPayload: d.id,
          })),
        },
      ];
      return blocks;
    }

    async function refresh() {
      isLoading = true;
      lastError = null;
      panel.update(renderBlocks());
      try {
        cachedDecks = await ctx.decks.list();
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      } finally {
        isLoading = false;
        panel.update(renderBlocks());
      }
    }

    const panel = ctx.addSidebarPanel({
      id: "today-glance",
      title: "Today at a Glance",
      blocks: renderBlocks(),
      async onAction(actionId, payload) {
        if (actionId === "refresh") {
          await refresh();
        } else if (actionId === "study-next") {
          const next = nextDueDeck(cachedDecks);
          if (next) {
            ctx.navigation.openDeck(next.id);
          } else {
            ctx.showToast("All caught up — no due cards left today.");
          }
        } else if (actionId === "open-deck" && typeof payload === "number") {
          ctx.navigation.openDeck(payload);
        }
      },
    });

    ctx.registerCommand({
      id: "study-next-deck",
      title: "Today at a Glance: Study next due deck",
      async run() {
        const decks = await ctx.decks.list();
        cachedDecks = decks;
        panel.update(renderBlocks());
        const next = nextDueDeck(decks);
        if (next) {
          ctx.navigation.openDeck(next.id);
        } else {
          ctx.showToast("All caught up — no due cards left today.");
        }
      },
    });

    void refresh();
  },
});
