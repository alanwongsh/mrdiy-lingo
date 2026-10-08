import { Badge, Button, Card, Pagination } from "@/components/ui";
import type { ServiceLog } from "@/lib/service-log";

function usageLabel(metadata: Record<string, unknown>) {
  const usage = metadata.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return "";
  const row = usage as Record<string, unknown>;
  const parts: string[] = [];
  for (const [name, value] of [
    ["prompt", row.promptTokens],
    ["output", row.outputTokens],
    ["total", row.totalTokens],
    ["thoughts", row.thoughtsTokens],
    ["cached", row.cachedTokens],
  ] as const) {
    if (typeof value === "number") parts.push(`${name} ${value.toLocaleString()}`);
  }
  return parts.join(" · ");
}

function when(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
      <pre className="mt-1 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 break-words whitespace-pre-wrap text-slate-100">
        {text}
      </pre>
    </div>
  );
}

export function ServiceLogList({
  logs,
  page,
  pageSize,
  total,
  source,
}: {
  logs: ServiceLog[];
  page: number;
  pageSize: number;
  total: number;
  source: string;
}) {
  return (
    <div>
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          name="source"
          defaultValue={source}
          placeholder="Source, such as gemini"
          className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--hub-border-strong)] bg-white px-3 text-sm sm:max-w-xs"
        />
        <Button type="submit">Filter</Button>
      </form>
      {logs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-[var(--hub-muted)]">
          {source ? "No logs for that source." : "No service logs yet."}
        </Card>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const tokens = usageLabel(log.metadata);
            const model = typeof log.metadata.model === "string" ? log.metadata.model : "";
            return (
              <Card key={log.id} className="overflow-hidden">
                <details>
                  <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={log.ok ? "good" : "bad"}>{log.ok ? "OK" : "Failed"}</Badge>
                      <Badge tone="info">{log.source}</Badge>
                      {model ? <span className="text-sm text-slate-700">{model}</span> : null}
                      <span className="text-sm text-slate-500">{when(log.createdAt)}</span>
                      {log.durationMs != null ? (
                        <span className="text-sm text-slate-500">{log.durationMs.toLocaleString()} ms</span>
                      ) : null}
                    </div>
                    {log.message ? (
                      <p className="mt-2 text-sm text-slate-800">{log.message}</p>
                    ) : null}
                    {tokens ? <p className="mt-1 text-xs text-slate-500">{tokens}</p> : null}
                  </summary>
                  <div className="space-y-3 border-t border-[var(--hub-border)] px-4 py-3">
                    {log.error ? <TextBlock label="Error" text={log.error} /> : null}
                    {log.input ? <TextBlock label="Input" text={log.input} /> : null}
                    {log.output ? <TextBlock label="Output" text={log.output} /> : null}
                    {Object.keys(log.metadata).length > 0 ? (
                      <TextBlock label="Details" text={JSON.stringify(log.metadata, null, 2)} />
                    ) : null}
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      )}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/logs"
        query={{ source: source || undefined }}
      />
    </div>
  );
}
