import type { Style } from "@/stores/style";

export type EmptyStateScene = "decks" | "habits" | "tasks";
export type ActiveIllustrationStyle = Exclude<Style, "default">;

interface SceneProps {
  testId: string;
  label: string;
}

export function GameEmptyIllustration({
  scene,
  testId,
  label,
}: SceneProps & { scene: EmptyStateScene }) {
  if (scene === "decks") {
    return (
      <svg
        viewBox="0 0 128 96"
        className="h-24 w-32 shrink-0"
        role="img"
        aria-label={label}
        data-testid={testId}
      >
        {/* Guild study hearth backdrop */}
        <rect
          x="14"
          y="12"
          width="100"
          height="72"
          rx="12"
          fill="hsl(var(--secondary))"
          stroke="hsl(var(--border))"
          strokeWidth="2"
        />
        {/* Stacked quest cards */}
        <rect
          x="32"
          y="30"
          width="42"
          height="42"
          rx="6"
          fill="hsl(var(--card))"
          stroke="hsl(var(--border))"
          strokeWidth="2"
          transform="rotate(-8 53 51)"
        />
        <rect
          x="44"
          y="24"
          width="46"
          height="48"
          rx="6"
          fill="hsl(var(--card))"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
        />
        {/* Guild banner & crest */}
        <path d="M58 24h18v20l-9-5-9 5V24z" fill="hsl(var(--primary))" />
        {/* Spark / Gold coin */}
        <circle cx="94" cy="64" r="9" fill="hsl(var(--game-gold))" />
        <circle cx="94" cy="64" r="5" fill="hsl(var(--card))" opacity="0.35" />
        {/* Corner stars */}
        <path d="M27 25l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4z" fill="hsl(var(--game-xp))" />
        <path
          d="M101 23l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5 1.5-3z"
          fill="hsl(var(--game-gold))"
        />
      </svg>
    );
  }

  if (scene === "habits") {
    return (
      <svg
        viewBox="0 0 128 96"
        className="h-24 w-32 shrink-0"
        role="img"
        aria-label={label}
        data-testid={testId}
      >
        <rect
          x="14"
          y="12"
          width="100"
          height="72"
          rx="12"
          fill="hsl(var(--secondary))"
          stroke="hsl(var(--border))"
          strokeWidth="2"
        />
        {/* Quest trail path */}
        <path
          d="M28 66 C44 48, 60 66, 76 46 S94 34, 102 32"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="4 4"
        />
        {/* Milestone nodes */}
        <circle cx="28" cy="66" r="5" fill="hsl(var(--game-xp))" />
        <circle cx="52" cy="56" r="5" fill="hsl(var(--game-xp))" />
        <circle cx="76" cy="46" r="5" fill="hsl(var(--game-gold))" />
        {/* Shield emblem at peak */}
        <path
          d="M94 22h16v12c0 7-8 11-8 11s-8-4-8-11V22z"
          fill="hsl(var(--primary))"
          stroke="hsl(var(--card))"
          strokeWidth="1.5"
        />
        <path
          d="M99 31l3 3 5-6"
          fill="none"
          stroke="hsl(var(--primary-foreground))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 128 96"
      className="h-24 w-32 shrink-0"
      role="img"
      aria-label={label}
      data-testid={testId}
    >
      <rect
        x="14"
        y="12"
        width="100"
        height="72"
        rx="12"
        fill="hsl(var(--secondary))"
        stroke="hsl(var(--border))"
        strokeWidth="2"
      />
      {/* Guild quest board */}
      <rect
        x="34"
        y="22"
        width="60"
        height="52"
        rx="6"
        fill="hsl(var(--card))"
        stroke="hsl(var(--primary))"
        strokeWidth="2"
      />
      {/* Board pin */}
      <circle cx="64" cy="22" r="4" fill="hsl(var(--game-gold))" />
      {/* Checklist lines */}
      <rect x="44" y="34" width="8" height="8" rx="2" fill="hsl(var(--game-xp))" />
      <line
        x1="58"
        y1="38"
        x2="84"
        y2="38"
        stroke="hsl(var(--border))"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect
        x="44"
        y="50"
        width="8"
        height="8"
        rx="2"
        fill="hsl(var(--muted))"
        stroke="hsl(var(--border))"
        strokeWidth="1.5"
      />
      <line
        x1="58"
        y1="54"
        x2="80"
        y2="54"
        stroke="hsl(var(--border))"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Compass star */}
      <path
        d="M98 60l2.5 5 5 2.5-5 2.5-2.5 5-2.5-5-5-2.5 5-2.5 2.5-5z"
        fill="hsl(var(--game-gold))"
      />
    </svg>
  );
}
