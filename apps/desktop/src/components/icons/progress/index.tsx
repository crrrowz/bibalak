import type { SVGProps } from "react";

export type ProgressIconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: ProgressIconProps) {
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

export function LevelIcon(props: ProgressIconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
      <path d="M9 12.5l3-3 3 3" />
    </IconBase>
  );
}

export function XpIcon(props: ProgressIconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" />
    </IconBase>
  );
}

export function GoldIcon(props: ProgressIconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 9.5v5" />
    </IconBase>
  );
}

export function KnowledgePointsIcon(props: ProgressIconProps) {
  return (
    <IconBase {...props}>
      <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H11v16H4.5A2.5 2.5 0 0 0 2 21.5v-16z" />
      <path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H13v16h6.5a2.5 2.5 0 0 1 2.5 2.5v-16z" />
      <path d="M6 8h2.5M6 12h2.5M15.5 8H18M15.5 12H18" />
    </IconBase>
  );
}

export function StyleDefaultIcon(props: ProgressIconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 20h8" />
      <path d="M12 20v-7" />
      <path d="M12 13L8.5 8.5" />
      <path d="M5 9l3-5h6l2 5H5z" />
    </IconBase>
  );
}

export function StyleScholarIcon(props: ProgressIconProps) {
  return (
    <IconBase {...props}>
      <path d="M2 9l10-5 10 5-10 5-10-5z" />
      <path d="M6 11.5v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" />
      <path d="M21 9.5v6" />
    </IconBase>
  );
}

export function StyleGameIcon(props: ProgressIconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="7" width="18" height="10" rx="4" />
      <path d="M8 10v4M6 12h4M15.5 11h.01M17.5 13h.01" />
    </IconBase>
  );
}

export function CertificateIcon(props: ProgressIconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M7 9h10M7 12h6" />
      <circle cx="16.5" cy="15.5" r="2.5" />
      <path d="M15 17.5V21l1.5-1 1.5 1v-3.5" />
    </IconBase>
  );
}

export function TranscriptIcon(props: ProgressIconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M15 3v4h4M8 11h8M8 15h8M8 19h5" />
    </IconBase>
  );
}

export function LectureLogIcon(props: ProgressIconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 19.5v-15z" />
      <path d="M8 3v18M11.5 8h5M11.5 12h5M11.5 16h3" />
    </IconBase>
  );
}
