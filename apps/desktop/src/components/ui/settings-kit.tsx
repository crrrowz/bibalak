import { useId, type ReactNode } from "react";

interface SettingsCardProps {
  id?: string;
  children: ReactNode;
  className?: string;
}

/** Standard surface container for a group of related settings controls. */
export function SettingsCard({ id, children, className = "" }: SettingsCardProps) {
  return (
    <section
      id={id}
      className={`rounded-xl border border-border bg-card p-5 space-y-4 ${className}`.trim()}
    >
      {children}
    </section>
  );
}

interface SettingsSectionHeaderProps {
  title: string;
  description?: string;
  as?: "h2" | "h3";
}

/** Consistent heading + helper description inside a SettingsCard. */
export function SettingsSectionHeader({
  title,
  description,
  as = "h3",
}: SettingsSectionHeaderProps) {
  const Heading = as;
  return (
    <div>
      <Heading className="text-sm font-medium text-foreground">{title}</Heading>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  );
}

interface SettingsToggleRowProps {
  id?: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
  children?: ReactNode;
  divider?: boolean;
}

/** Unified accessible switch row with inline helper text. */
export function SettingsToggleRow({
  id,
  label,
  hint,
  checked,
  disabled = false,
  onToggle,
  children,
  divider = false,
}: SettingsToggleRowProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const labelId = `${controlId}-label`;
  const hintId = `${controlId}-hint`;

  return (
    <div
      className={
        divider
          ? "space-y-2 border-t border-border/60 pt-3 first:border-t-0 first:pt-0"
          : "space-y-2"
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span id={labelId} className="text-sm font-medium text-foreground">
            {label}
          </span>
          {hint && (
            <p id={hintId} className="text-xs text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
        <button
          id={controlId}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          disabled={disabled}
          onClick={() => onToggle(!checked)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
            checked ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none block size-5 rounded-full bg-background shadow-sm transition-transform ${
              checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      {children}
    </div>
  );
}
