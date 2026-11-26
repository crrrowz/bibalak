/* global BibalakPlugin */
// Focus Timer sample plugin (MIT License).

BibalakPlugin.definePlugin({
  activate(ctx) {
    const FOCUS_SEC = 25 * 60;
    const BREAK_SEC = 5 * 60;

    let mode = "focus"; // "focus" | "break"
    let remainingSec = FOCUS_SEC;
    let running = false;
    let cardsAnswered = 0;
    let timerId = null;

    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    }

    function renderBlocks() {
      return [
        { type: "heading", text: mode === "focus" ? "Focus session" : "Break time" },
        { type: "stat", label: "Time remaining", value: formatTime(remainingSec) },
        { type: "stat", label: "Cards answered this session", value: String(cardsAnswered) },
        {
          type: "badge",
          text: running ? "Running" : "Paused",
          tone: running ? "accent" : "muted",
        },
        {
          type: "actions",
          buttons: [
            {
              id: "toggle",
              label: running ? "Pause" : "Start",
              variant: "primary",
            },
            { id: "reset", label: "Reset", variant: "secondary" },
            {
              id: "switch-mode",
              label: mode === "focus" ? "Break (5m)" : "Focus (25m)",
              variant: "secondary",
            },
          ],
        },
      ];
    }

    function stopTick() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    }

    function startTick() {
      stopTick();
      timerId = setInterval(() => {
        if (!running) return;
        if (remainingSec > 0) {
          remainingSec -= 1;
          panel.update(renderBlocks());
          return;
        }
        running = false;
        stopTick();
        if (mode === "focus") {
          ctx.showToast("Focus session complete! Cards answered: " + String(cardsAnswered));
          mode = "break";
          remainingSec = BREAK_SEC;
        } else {
          ctx.showToast("Break finished — ready for the next focus block.");
          mode = "focus";
          remainingSec = FOCUS_SEC;
        }
        panel.update(renderBlocks());
      }, 1000);
    }

    const panel = ctx.addSidebarPanel({
      id: "focus-timer",
      title: "Focus Timer",
      blocks: renderBlocks(),
      onAction(actionId) {
        if (actionId === "toggle") {
          running = !running;
          if (running) {
            startTick();
          } else {
            stopTick();
          }
          panel.update(renderBlocks());
        } else if (actionId === "reset") {
          running = false;
          stopTick();
          remainingSec = mode === "focus" ? FOCUS_SEC : BREAK_SEC;
          cardsAnswered = 0;
          panel.update(renderBlocks());
        } else if (actionId === "switch-mode") {
          running = false;
          stopTick();
          mode = mode === "focus" ? "break" : "focus";
          remainingSec = mode === "focus" ? FOCUS_SEC : BREAK_SEC;
          panel.update(renderBlocks());
        }
      },
    });

    const eventSub = ctx.onEvent((ev) => {
      if (ev.type === "card-answered") {
        cardsAnswered += 1;
        panel.update(renderBlocks());
      }
    });

    this._cleanup = () => {
      stopTick();
      eventSub.dispose();
      panel.dispose();
    };
  },

  deactivate() {
    if (typeof this._cleanup === "function") {
      this._cleanup();
    }
  },
});
