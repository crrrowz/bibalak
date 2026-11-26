import type { SVGProps } from "react";
import { RankEmblemIcon } from "@/components/icons/game";
import { CertificateIcon } from "@/components/icons/progress";
import type { Style } from "@/stores/style";

type IconSvgProps = SVGProps<SVGSVGElement>;

function QuestIconBase({ children, ...props }: IconSvgProps) {
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

function DefaultTargetIcon(props: IconSvgProps) {
  return (
    <QuestIconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </QuestIconBase>
  );
}

function ScholarScrollIcon(props: IconSvgProps) {
  return (
    <QuestIconBase {...props}>
      <path d="M5 4h11a3 3 0 0 1 3 3v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z" />
      <path d="M8 9h7M8 13h7M8 17h4" />
    </QuestIconBase>
  );
}

function GameQuestCrestIcon(props: IconSvgProps) {
  return (
    <QuestIconBase {...props}>
      <path d="M12 3l7 4v5c0 4.2-2.8 7.8-7 9.5C7.8 19.8 5 16.2 5 12V7l7-4z" />
      <path d="M9.5 12.5l1.8 1.8 3.5-4" />
    </QuestIconBase>
  );
}

function DefaultMedalIcon(props: IconSvgProps) {
  return (
    <QuestIconBase {...props}>
      <circle cx="12" cy="9" r="5" />
      <path d="M9 13.5V21l3-1.8 3 1.8v-7.5" />
    </QuestIconBase>
  );
}

/** Per-style quest objective icon (target / academic folio / guild crest). */
export function QuestStyleIcon({
  style,
  className = "size-5 shrink-0",
  testId,
}: {
  style: Style;
  className?: string;
  testId?: string;
}) {
  const Icon =
    style === "game"
      ? GameQuestCrestIcon
      : style === "scholar"
        ? ScholarScrollIcon
        : DefaultTargetIcon;
  return <Icon className={className} data-testid={testId ?? `quest-icon-${style}`} />;
}

/** Per-style monthly badge emblem (ribbon medal / scholar certificate / rank star). */
export function MonthlyBadgeStyleIcon({
  style,
  className = "size-5 shrink-0",
  testId,
}: {
  style: Style;
  className?: string;
  testId?: string;
}) {
  const Icon =
    style === "game" ? RankEmblemIcon : style === "scholar" ? CertificateIcon : DefaultMedalIcon;
  return <Icon className={className} data-testid={testId} />;
}
