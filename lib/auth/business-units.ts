import { getDb } from "@/lib/db/client";
import { UserFacingError } from "@/lib/errors";
import {
  cleanMarkets,
  coversUnit,
  marketsForUnits,
  type BusinessUnit,
} from "@/lib/business-unit-rules";
import type { AppAccess } from "@/lib/types";

export {
  canSeeMarket,
  cleanMarkets,
  coversUnit,
  marketScope,
  marketsForUnits,
  type BusinessUnit,
} from "@/lib/business-unit-rules";

export const ALL_COUNTRIES_UNIT = "All countries";

export function isMissingBusinessUnits(error: { message: string; code?: string }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST200" ||
    error.code === "PGRST205" ||
    /business_unit/i.test(error.message)
  );
}

function toUnit(row: Record<string, unknown>): BusinessUnit {
  return {
    id: String(row.id),
    application_id: String(row.application_id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    all_markets: !!row.all_markets,
    markets: cleanMarkets(row.markets),
  };
}

/**
 * Markets a member may work in, from all of their units. Null means every market,
 * including before migration 032. Empty means the member is in no unit.
 */
export async function loadMemberMarkets(memberId: string): Promise<string[] | null> {
  const db = await getDb();
  const { data, error } = await db
    .from("application_member_business_units")
    .select("unit:business_units(all_markets, markets)")
    .eq("member_id", memberId);
  if (error) {
    if (isMissingBusinessUnits(error)) return null;
    throw new Error(error.message);
  }
  const units = (data ?? []).flatMap((row) => {
    const unit = (row as { unit: unknown }).unit;
    const list = (Array.isArray(unit) ? unit : unit ? [unit] : []) as Record<string, unknown>[];
    return list.map((item) => ({ all_markets: !!item.all_markets, markets: cleanMarkets(item.markets) }));
  });
  return marketsForUnits(units);
}

/** Business units of one application, by name. Null when migration 032 has not been run. */
export async function listBusinessUnits(applicationId: string): Promise<BusinessUnit[] | null> {
  const db = await getDb();
  const { data, error } = await db
    .from("business_units")
    .select("id, application_id, name, description, all_markets, markets")
    .eq("application_id", applicationId)
    .order("name", { ascending: true });
  if (error) {
    if (isMissingBusinessUnits(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => toUnit(row as Record<string, unknown>));
}

/** Unit ids per membership. Null when migration 032 has not been run. */
export async function loadMemberUnitIds(memberIds: string[]): Promise<Map<string, string[]> | null> {
  const byMember = new Map<string, string[]>();
  if (memberIds.length === 0) return byMember;
  const db = await getDb();
  const { data, error } = await db
    .from("application_member_business_units")
    .select("member_id, business_unit_id")
    .in("member_id", memberIds);
  if (error) {
    if (isMissingBusinessUnits(error)) return null;
    throw new Error(error.message);
  }
  for (const row of data ?? []) {
    const memberId = String(row.member_id);
    byMember.set(memberId, [...(byMember.get(memberId) ?? []), String(row.business_unit_id)]);
  }
  return byMember;
}

/**
 * The units someone may be put in: they must belong to this application, at least one is
 * required, and the person making the change must cover every one of them.
 */
export function assignableUnits(
  units: BusinessUnit[],
  unitIds: string[],
  actor: Pick<AppAccess, "markets">
): BusinessUnit[] {
  const ids = [...new Set(unitIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) throw new UserFacingError("Choose a business unit.");
  return ids.map((id) => {
    const unit = units.find((item) => item.id === id);
    if (!unit) throw new UserFacingError("That business unit is no longer in this application.");
    if (!coversUnit(actor, unit)) {
      throw new UserFacingError(
        `You can only give business units within your own countries. ${unit.name} covers more.`
      );
    }
    return unit;
  });
}

/** Throws unless the actor covers every unit a member is in now. */
export function assertCanChangeUnitHolder(
  units: BusinessUnit[],
  currentUnitIds: string[],
  actor: Pick<AppAccess, "markets">
) {
  const outside = units.filter(
    (unit) => currentUnitIds.includes(unit.id) && !coversUnit(actor, unit)
  );
  if (outside.length > 0) {
    throw new UserFacingError(
      `This person is in ${outside.map((unit) => unit.name).join(", ")}, which covers countries outside yours. Ask someone who covers them.`
    );
  }
}

/** Puts a member in exactly these units. */
export async function replaceMemberUnits(memberId: string, unitIds: string[]) {
  const db = await getDb();
  const { error: removeError } = await db
    .from("application_member_business_units")
    .delete()
    .eq("member_id", memberId);
  if (removeError) throw new Error(removeError.message);
  if (unitIds.length === 0) return;
  const { error } = await db
    .from("application_member_business_units")
    .insert(unitIds.map((business_unit_id) => ({ member_id: memberId, business_unit_id })));
  if (error) throw new Error(error.message);
}

/** Gives a new article application its "All countries" unit. Does nothing before migration 032. */
export async function ensureAllCountriesUnit(applicationId: string) {
  const units = await listBusinessUnits(applicationId);
  if (!units || units.some((unit) => unit.name.toLowerCase() === ALL_COUNTRIES_UNIT.toLowerCase())) {
    return;
  }
  const db = await getDb();
  const { error } = await db.from("business_units").insert({
    application_id: applicationId,
    name: ALL_COUNTRIES_UNIT,
    description: "Every market.",
    all_markets: true,
  });
  if (error) throw new Error(error.message);
}
