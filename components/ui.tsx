import Link from "next/link";

export function BackLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="hub-text-button mb-3 inline-flex items-center gap-1.5 text-sm no-underline hover:underline"
    >
      <span aria-hidden="true">←</span>
      {label}
    </Link>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-8 border-b border-[var(--hub-border)] pb-6">
      {back ? <BackLink href={back.href} label={back.label} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex h-1.5 w-12 overflow-hidden rounded-full">
            <span className="w-2/3 bg-[var(--diy-red)]" />
            <span className="w-1/3 bg-[var(--diy-yellow)]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight break-words text-[var(--hub-fg)] sm:text-[1.75rem]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--hub-muted-strong)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const styles = {
    primary:
      "bg-[var(--hub-accent)] text-white shadow-sm hover:bg-[var(--hub-accent-hover)] hover:-translate-y-px active:translate-y-0 focus-visible:ring-2 focus-visible:ring-[var(--hub-accent-ring)]",
    secondary:
      "border border-[var(--hub-border-strong)] bg-white text-slate-800 shadow-sm hover:border-[var(--hub-accent)] hover:bg-[var(--hub-accent-soft)] hover:text-[var(--hub-accent)] focus-visible:ring-2 focus-visible:ring-[var(--hub-accent-ring)]",
    danger:
      "bg-red-700 text-white shadow-sm hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-300",
    ghost:
      "hub-text-button hover:bg-[var(--diy-yellow-soft)] hover:no-underline",
  }[variant];
  return (
    <button
      className={`inline-flex h-9 items-center justify-center rounded-lg px-3.5 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-45 ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  const styles =
    variant === "primary"
      ? "bg-[var(--hub-accent)] text-white shadow-sm hover:bg-[var(--hub-accent-hover)] hover:-translate-y-px"
      : "border border-[var(--hub-border-strong)] bg-white text-slate-800 shadow-sm hover:border-[var(--hub-accent)] hover:bg-[var(--hub-accent-soft)] hover:text-[var(--hub-accent)]";
  return (
    <Link
      href={href}
      className={`inline-flex h-9 items-center justify-center rounded-lg px-3.5 text-sm font-semibold transition ${styles}`}
    >
      {children}
    </Link>
  );
}

export function Card({
  children,
  className = "",
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--hub-border)] bg-[var(--hub-panel)] shadow-[var(--hub-shadow)] ${
        interactive
          ? "transition hover:-translate-y-0.5 hover:border-[var(--hub-border-strong)] hover:shadow-[var(--hub-shadow-hover)]"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "accent" | "good" | "warn" | "info";
}) {
  const bar = {
    default: "bg-slate-300",
    accent: "bg-[var(--hub-accent)]",
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    info: "bg-sky-500",
  }[tone];

  return (
    <Card className="relative overflow-hidden p-5">
      <div className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <div className="pl-2">
        <div className="text-[11px] font-semibold tracking-[0.08em] text-[var(--hub-muted)] uppercase">
          {label}
        </div>
        <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-[var(--hub-fg)]">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {hint ? (
          <div className="mt-1.5 text-xs font-medium text-[var(--hub-muted-strong)]">
            {hint}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  const tones = {
    neutral: "border-slate-200 bg-slate-100 text-slate-700",
    good: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    bad: "border-red-200 bg-red-50 text-red-800",
    info: "border-sky-200 bg-sky-50 text-sky-900",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${tones}`}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  children,
  htmlFor,
  action,
}: {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
  action?: React.ReactNode;
}) {
  // Do NOT wrap controls in <label> — nested TipTap/toolbars steal focus
  // (caret flashes then jumps to the first button, e.g. Bold).
  // Keep `action` outside the label so the button click does not focus the field.
  return (
    <div className="block space-y-1.5">
      <div className="flex items-center gap-1">
        <label
          htmlFor={htmlFor}
          className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]"
        >
          {label}
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border border-[var(--hub-border-strong)] bg-white px-3 text-sm text-[var(--hub-fg)] outline-none placeholder:text-slate-400 hover:border-slate-400 focus:border-[var(--hub-accent)] focus:ring-2 focus:ring-[var(--hub-accent-ring)]";

export const textareaClass =
  "w-full rounded-lg border border-[var(--hub-border-strong)] bg-white px-3 py-2 text-sm text-[var(--hub-fg)] outline-none placeholder:text-slate-400 hover:border-slate-400 focus:border-[var(--hub-accent)] focus:ring-2 focus:ring-[var(--hub-accent-ring)]";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="px-6 py-14 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--hub-accent-soft)] text-sm font-bold text-[var(--hub-accent)]">
        !
      </div>
      <div className="text-base font-semibold">{title}</div>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-[var(--hub-muted-strong)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </Card>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  query,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  query?: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function href(p: number) {
    const params = new URLSearchParams();
    Object.entries(query ?? {}).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    params.set("page", String(p));
    return `${basePath}?${params.toString()}`;
  }

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="font-medium text-[var(--hub-muted-strong)]">
        Showing{" "}
        <span className="text-[var(--hub-fg)]">{from.toLocaleString()}</span>–
        <span className="text-[var(--hub-fg)]">{to.toLocaleString()}</span> of{" "}
        <span className="text-[var(--hub-fg)]">{total.toLocaleString()}</span>
      </div>
      <div className="flex gap-2">
        <Link
          href={href(Math.max(1, page - 1))}
          className={`rounded-lg border border-[var(--hub-border-strong)] bg-white px-3 py-1.5 font-medium text-slate-700 shadow-sm ${
            page <= 1
              ? "pointer-events-none opacity-40"
              : "hover:border-[var(--hub-accent)] hover:text-[var(--hub-accent)]"
          }`}
        >
          Previous
        </Link>
        <span className="rounded-lg bg-[var(--hub-panel-soft)] px-3 py-1.5 font-semibold tabular-nums text-slate-900">
          {page} / {totalPages}
        </span>
        <Link
          href={href(Math.min(totalPages, page + 1))}
          className={`rounded-lg border border-[var(--hub-border-strong)] bg-white px-3 py-1.5 font-medium text-slate-700 shadow-sm ${
            page >= totalPages
              ? "pointer-events-none opacity-40"
              : "hover:border-[var(--hub-accent)] hover:text-[var(--hub-accent)]"
          }`}
        >
          Next
        </Link>
      </div>
    </div>
  );
}

export function statusTone(
  status: string
): "neutral" | "good" | "warn" | "bad" | "info" {
  switch (status) {
    case "ACTIVE":
    case "APPROVED":
    case "PUBLISHED":
    case "NEW":
      return "good";
    case "INACTIVE":
    case "MISSING":
    case "DRAFT":
    case "UNCHANGED":
      return "neutral";
    case "SYSTEM_GENERATED":
    case "TRANSLATING":
    case "REVIEW":
    case "UPDATED":
      return "info";
    case "MANUALLY_MODIFIED":
      return "warn";
    case "ERROR":
      return "bad";
    default:
      return "neutral";
  }
}
