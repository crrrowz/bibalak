import type { EmptyStateScene } from "./GameEmptyIllustrations";

interface SceneProps {
  scene: EmptyStateScene;
  testId: string;
  label: string;
}

export function ScholarEmptyIllustration({ scene, testId, label }: SceneProps) {
  if (scene === "decks") {
    return (
      <svg
        viewBox="0 0 128 96"
        className="h-24 w-32 shrink-0"
        role="img"
        aria-label={label}
        data-testid={testId}
      >
        {/* Library shelf frame */}
        <rect
          x="14"
          y="12"
          width="100"
          height="72"
          rx="8"
          fill="hsl(var(--secondary))"
          stroke="hsl(var(--border))"
          strokeWidth="2"
        />
        {/* Shelf line */}
        <line
          x1="26"
          y1="70"
          x2="102"
          y2="70"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Standing volumes */}
        <rect x="34" y="30" width="14" height="40" rx="2" fill="hsl(var(--primary))" />
        <line
          x1="37"
          y1="38"
          x2="45"
          y2="38"
          stroke="hsl(var(--primary-foreground))"
          strokeWidth="1.5"
        />
        <rect x="50" y="24" width="16" height="46" rx="2" fill="hsl(var(--scholar-accent))" />
        <line
          x1="53"
          y1="33"
          x2="63"
          y2="33"
          stroke="hsl(var(--scholar-accent-foreground))"
          strokeWidth="1.5"
        />
        <rect
          x="68"
          y="34"
          width="13"
          height="36"
          rx="2"
          fill="hsl(var(--card))"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
        />
        {/* Leaning volume */}
        <rect
          x="84"
          y="36"
          width="12"
          height="34"
          rx="2"
          fill="hsl(var(--card))"
          stroke="hsl(var(--border))"
          strokeWidth="2"
          transform="rotate(-10 90 53)"
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
          rx="8"
          fill="hsl(var(--secondary))"
          stroke="hsl(var(--border))"
          strokeWidth="2"
        />
        {/* Open attendance ledger */}
        <rect
          x="28"
          y="24"
          width="72"
          height="48"
          rx="4"
          fill="hsl(var(--card))"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
        />
        <line x1="64" y1="24" x2="64" y2="72" stroke="hsl(var(--border))" strokeWidth="1.5" />
        {/* Ledger lines */}
        <line
          x1="36"
          y1="36"
          x2="56"
          y2="36"
          stroke="hsl(var(--border))"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="36"
          y1="46"
          x2="56"
          y2="46"
          stroke="hsl(var(--border))"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="36"
          y1="56"
          x2="52"
          y2="56"
          stroke="hsl(var(--border))"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Checkmarks on right page */}
        <path
          d="M72 36l3 3 6-6"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="84"
          y1="36"
          x2="92"
          y2="36"
          stroke="hsl(var(--border))"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M76 24h8v14l-4-3-4 3V24z" fill="hsl(var(--scholar-accent))" opacity="0.85" />
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
        rx="8"
        fill="hsl(var(--secondary))"
        stroke="hsl(var(--border))"
        strokeWidth="2"
      />
      {/* Desk index card */}
      <rect
        x="30"
        y="26"
        width="68"
        height="44"
        rx="4"
        fill="hsl(var(--card))"
        stroke="hsl(var(--primary))"
        strokeWidth="2"
      />
      {/* Rule line */}
      <line x1="30" y1="38" x2="98" y2="38" stroke="hsl(var(--scholar-accent))" strokeWidth="1.5" />
      <line
        x1="38"
        y1="48"
        x2="78"
        y2="48"
        stroke="hsl(var(--border))"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="38"
        y1="58"
        x2="66"
        y2="58"
        stroke="hsl(var(--border))"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Fountain nib accent */}
      <path d="M88 50l6-10 4 4-10 6z" fill="hsl(var(--primary))" />
    </svg>
  );
}
