import { ServiceLogList } from "@/components/service-log-list";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/access";
import { listServiceLogs, serviceLogConfig } from "@/lib/service-log";

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.is_superadmin) {
    return (
      <div>
        <PageHeader
          title="Logs"
          description="Service logs are limited to a Lingo superadmin."
        />
      </div>
    );
  }

  const sp = await searchParams;
  const source = sp.source ?? "";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const retentionDays = serviceLogConfig().retentionDays;
  let logs: Awaited<ReturnType<typeof listServiceLogs>> | null = null;
  let loadError = "";
  try {
    logs = await listServiceLogs({ page, pageSize: 20, source });
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Service logs are unavailable.";
  }

  return (
    <div>
      <PageHeader
        title="Logs"
        description={`Calls made by Lingo services, written to one file per day. Files older than ${retentionDays} days are deleted.`}
      />
      {loadError || !logs ? (
        <p className="text-sm text-red-700">{loadError || "Service logs are unavailable."}</p>
      ) : (
        <ServiceLogList
          logs={logs.items}
          page={logs.page}
          pageSize={logs.pageSize}
          total={logs.total}
          source={source}
        />
      )}
    </div>
  );
}
