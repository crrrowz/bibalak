/* global BibalakPlugin */
// Note Checker sample plugin (MIT License).

BibalakPlugin.definePlugin({
  activate(ctx) {
    let issues = [];
    let scannedCount = 0;
    let isScanning = false;
    let lastError = null;

    function previewTitle(note) {
      const nonEmpty = (note.fields || []).find((f) => f.text.trim().length > 0);
      const raw = nonEmpty ? nonEmpty.text : note.sortField || "Note #" + String(note.noteId);
      const clean = raw.replace(/\s+/g, " ").trim();
      return clean.length > 64 ? clean.slice(0, 63) + "…" : clean;
    }

    function renderBlocks() {
      if (isScanning) {
        return [{ type: "text", text: "Scanning notes for issues…", tone: "muted" }];
      }
      if (lastError) {
        return [
          { type: "text", text: lastError, tone: "danger" },
          {
            type: "actions",
            buttons: [{ id: "scan", label: "Retry scan", variant: "secondary" }],
          },
        ];
      }

      return [
        { type: "heading", text: "Note health check" },
        { type: "stat", label: "Notes scanned", value: String(scannedCount) },
        { type: "stat", label: "Notes with issues", value: String(issues.length) },
        {
          type: "actions",
          buttons: [{ id: "scan", label: "Rescan notes", variant: "primary" }],
        },
        { type: "divider" },
        {
          type: "list",
          emptyText: "All scanned notes look healthy — no empty fields or missing media.",
          items: issues.slice(0, 50).map((item) => ({
            id: String(item.noteId),
            title: item.title,
            subtitle: item.deck + " · " + item.reasons.join("; "),
            badge: item.kind,
            actionLabel: "Open in Browse",
            actionId: "open-note",
            actionPayload: item.browseQuery,
          })),
        },
      ];
    }

    async function runScan() {
      isScanning = true;
      lastError = null;
      panel.update(renderBlocks());
      try {
        const [notes, missingFiles] = await Promise.all([
          ctx.notes.search("", { limit: 100 }),
          ctx.notes.checkMediaMissing(),
        ]);
        const missingSet = new Set(missingFiles);
        scannedCount = notes.length;

        const found = [];
        for (const note of notes) {
          const emptyFields = (note.fields || [])
            .filter((f) => f.text.trim().length === 0 && (note.mediaRefs || []).length === 0)
            .map((f) => f.name);
          const missingRefs = (note.mediaRefs || []).filter((ref) => missingSet.has(ref));

          if (emptyFields.length > 0 || missingRefs.length > 0) {
            const reasons = [];
            if (emptyFields.length > 0) {
              reasons.push("Empty field: " + emptyFields.join(", "));
            }
            if (missingRefs.length > 0) {
              reasons.push("Missing media: " + missingRefs.join(", "));
            }
            const firstText = (note.fields || []).find((f) => f.text.trim().length > 0)?.text ?? "";
            found.push({
              noteId: note.noteId,
              title: previewTitle(note),
              deck: note.deck || "Default",
              kind: missingRefs.length > 0 ? "media" : "empty",
              reasons,
              browseQuery:
                firstText.trim().slice(0, 80) || 'deck:"' + (note.deck || "Default") + '"',
            });
          }
        }
        issues = found;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      } finally {
        isScanning = false;
        panel.update(renderBlocks());
      }
    }

    const panel = ctx.addSidebarPanel({
      id: "note-checker",
      title: "Note Checker",
      blocks: renderBlocks(),
      async onAction(actionId, payload) {
        if (actionId === "scan") {
          await runScan();
        } else if (actionId === "open-note") {
          ctx.navigation.openBrowse(typeof payload === "string" ? payload : "");
        }
      },
    });

    void runScan();
  },
});
