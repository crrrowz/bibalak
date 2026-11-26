import type { SVGProps } from "react";

export type GameIconProps = SVGProps<SVGSVGElement>;

function GameIconBase({ children, ...props }: GameIconProps) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function StreakFlameIcon(props: GameIconProps) {
  return (
    <GameIconBase {...props}>
      <path d="M12 2.5c2.2 2.6 5 5.4 5 9.5a5 5 0 0 1-10 0c0-2 1-4 2.4-5.5.4 1.6 1.4 2.5 2.6 2.5-1.2-2.2-1-4.5 0-6.5z" />
    </GameIconBase>
  );
}

export function FrostShieldIcon(props: GameIconProps) {
  return (
    <GameIconBase {...props}>
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
      <path d="M12 8v8M9 10l6 4M15 10l-6 4" />
    </GameIconBase>
  );
}

export function RankEmblemIcon(props: GameIconProps) {
  return (
    <GameIconBase {...props}>
      <path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 3z" />
    </GameIconBase>
  );
}
