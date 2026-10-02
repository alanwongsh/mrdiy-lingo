import Link from "next/link";
import { Card, LinkButton } from "@/components/ui";

export function formatDbError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unknown database error";

  if (
    message.includes("fetch failed") ||
    message.includes("Failed to fetch") ||
    message.includes("ECONNREFUSED") ||
    message.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE") ||
    message.includes("SELF_SIGNED_CERT")
  ) {
    return "Cannot reach Supabase from the server. Check your network/VPN and .env.local values. On a corporate network, set SUPABASE_INSECURE_SSL=true in .env.local and restart npm run dev.";
  }

  if (
    message.includes("relation") ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("PGRST205")
  ) {
    return "Database tables are missing. Run the SQL migration from the Setup page.";
  }

  return message;
}

export function DbErrorPanel({ message }: { message: string }) {
  return (
    <Card className="p-6">
      <div className="font-medium">Database connection error</div>
      <p className="mt-2 text-sm text-[var(--hub-muted)]">{message}</p>
      <div className="mt-4 flex gap-2">
        <LinkButton href="/setup">Open Setup</LinkButton>
        <Link
          href="/"
          className="inline-flex h-9 items-center rounded-md border border-[var(--hub-border)] px-3 text-sm hover:bg-[var(--hub-hover)]"
        >
          Dashboard
        </Link>
      </div>
    </Card>
  );
}
