"use client";

import { errorMessage } from "@/lib/errors";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteBusinessUnit, saveBusinessUnit } from "@/lib/actions/business-units";
import {
  coversUnit,
  unitMarketsFull,
  unitMarketsLabel,
  type BusinessUnit,
} from "@/lib/business-unit-rules";
import { MARKETS } from "@/lib/markets";
import { CollapsibleSection } from "@/components/collapsible-section";
import { Badge, Button, Card, Field, inputClass } from "@/components/ui";

type Run = (action: () => Promise<unknown>, after?: () => void) => void;

function countLabel(count: number) {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

function UnitForm({
  unit,
  actorMarkets,
  pending,
  run,
  applicationId,
  onDone,
}: {
  unit?: BusinessUnit;
  /** Countries of the signed-in person. Null means every country. */
  actorMarkets: string[] | null;
  pending: boolean;
  run: Run;
  applicationId: string;
  onDone?: () => void;
}) {
  const [name, setName] = useState(unit?.name ?? "");
  const [description, setDescription] = useState(unit?.description ?? "");
  const [allMarkets, setAllMarkets] = useState(unit?.all_markets ?? false);
  const [markets, setMarkets] = useState<string[]>(unit?.markets ?? []);
  const choosable = MARKETS.filter(
    (market) => actorMarkets === null || actorMarkets.includes(market.code)
  );

  function reset() {
    setName(unit?.name ?? "");
    setDescription(unit?.description ?? "");
    setAllMarkets(unit?.all_markets ?? false);
    setMarkets(unit?.markets ?? []);
  }

  function toggle(code: string, on: boolean) {
    setMarkets((current) =>
      on ? [...new Set([...current, code])].sort() : current.filter((item) => item !== code)
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    run(
      () =>
        saveBusinessUnit({
          applicationId,
          id: unit?.id,
          name,
          description,
          allMarkets,
          markets,
        }),
      () => {
        if (!unit) reset();
        onDone?.();
      }
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-[16rem_1fr] sm:items-end">
        <Field label="Business unit name" required>
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="MR DIY Thailand"
            maxLength={80}
            required
          />
        </Field>
        <Field label="Description">
          <input
            className={inputClass}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Who this unit is for"
            maxLength={300}
          />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]">
          Countries
        </legend>
        {actorMarkets === null ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={allMarkets}
              disabled={pending}
              onChange={(event) => setAllMarkets(event.target.checked)}
            />
            <span>
              <span className="font-medium text-slate-900">All countries</span>
              <span className="block text-xs text-[var(--hub-muted)]">
                Includes countries added later.
              </span>
            </span>
          </label>
        ) : null}
        {allMarkets ? null : (
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {choosable.map((market) => (
              <label key={market.code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={markets.includes(market.code)}
                  disabled={pending}
                  onChange={(event) => toggle(market.code, event.target.checked)}
                />
                <span className="text-slate-900">
                  {market.name} <span className="text-[var(--hub-muted)]">({market.code})</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending || !name.trim() || (!allMarkets && markets.length === 0)}
        >
          {pending ? "Saving…" : unit ? "Save business unit" : "Add business unit"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            reset();
            if (unit) onDone?.();
          }}
        >
          {unit ? "Cancel" : "Clear"}
        </Button>
      </div>
    </form>
  );
}

function UnitRow({
  unit,
  count,
  pending,
  run,
  applicationId,
  actorMarkets,
}: {
  unit: BusinessUnit;
  count: number;
  pending: boolean;
  run: Run;
  applicationId: string;
  actorMarkets: string[] | null;
}) {
  const [editing, setEditing] = useState(false);
  const changeable = coversUnit({ markets: actorMarkets }, unit);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{unit.name}</span>
            <span title={unitMarketsFull(unit)}>
              <Badge tone={unit.all_markets ? "info" : "neutral"}>{unitMarketsLabel(unit)}</Badge>
            </span>
          </div>
          <div className="text-sm text-[var(--hub-muted)]">
            {unit.description || "No description"} · {countLabel(count)}
          </div>
        </div>
        {editing ? null : (
          <span className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !changeable}
              title={changeable ? undefined : "This unit covers countries outside yours."}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending || !changeable || count > 0}
              title={count > 0 ? "Move these people to another unit first." : undefined}
              onClick={() => {
                if (!confirm(`Delete the “${unit.name}” business unit?`)) return;
                run(() => deleteBusinessUnit({ applicationId, id: unit.id }));
              }}
            >
              Delete
            </Button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-3 rounded-lg border border-[var(--hub-border)] bg-slate-50 p-4">
          <UnitForm
            unit={unit}
            actorMarkets={actorMarkets}
            pending={pending}
            run={run}
            applicationId={applicationId}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}

export function BusinessUnitsManager({
  applicationId,
  units,
  memberCounts,
  actorMarkets,
}: {
  applicationId: string;
  units: BusinessUnit[];
  memberCounts: Record<string, number>;
  /** Countries of the signed-in person. Null means every country. */
  actorMarkets: string[] | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const run: Run = (action, after) => {
    setError("");
    startTransition(async () => {
      try {
        await action();
        after?.();
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, "Could not save the business unit."));
      }
    });
  };

  return (
    <>
      <Card className="p-5">
        <h2 className="text-base font-semibold">Business units</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--hub-muted)]">
          A business unit is a group of countries. People only see and work on articles for the
          countries of their business unit. Owners see every country.
        </p>
        {units.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--hub-muted)]">
            No business units yet. Add one below, then put people in it on the People tab.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--hub-border)]">
            {units.map((unit) => (
              <UnitRow
                key={unit.id}
                unit={unit}
                count={memberCounts[unit.id] ?? 0}
                pending={pending}
                run={run}
                applicationId={applicationId}
                actorMarkets={actorMarkets}
              />
            ))}
          </ul>
        )}
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      </Card>
      <div className="mt-3">
        <CollapsibleSection id="add-business-unit" title="Add business unit">
          <UnitForm
            actorMarkets={actorMarkets}
            pending={pending}
            run={run}
            applicationId={applicationId}
          />
        </CollapsibleSection>
      </div>
    </>
  );
}
