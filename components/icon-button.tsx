import Link from "next/link";

export function IconButton({
  label,
  onClick,
  href,
  danger,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const className = `inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--hub-muted-strong)] hover:bg-[var(--hub-accent-soft)] disabled:opacity-40 ${
    danger
      ? "hover:bg-red-50 hover:text-red-700"
      : "hover:text-[var(--hub-accent)]"
  }`;
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path strokeLinecap="round" d="M13.5 6.5l3 3" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 7V5h6v2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l1 12h8l1-12" />
    </svg>
  );
}
