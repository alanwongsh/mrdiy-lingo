"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { UserFacingError } from "@/lib/errors";
import { requireAppCapability } from "@/lib/auth/access";
import {
  cleanMarkets,
  coversUnit,
  isMissingBusinessUnits,
  listBusinessUnits,
  type BusinessUnit,
} from "@/lib/auth/business-units";
import { MARKETS } from "@/lib/markets";

/** Units of an application with how many people are in each. Null before migration 032. */
export async function listBusinessUnitsForSettings(applicationId: string): Promise<{
  units: BusinessUnit[];
  memberCounts: Record<string, number>;
} | null> {
  await requireAppCapability(applicationId, "roles.manage");
  const units = await listBusinessUnits(applicationId);
  if (!units) return null;
  const memberCounts: Record<string, number> = {};
  if (units.length > 0) {
    const db = await getDb();
    const { data, error } = await db
      .from("application_member_business_units")
      .select("business_unit_id")
      .in(
        "business_unit_id",
        units.map((unit) => unit.id)
      );
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const id = String(row.business_unit_id);
      memberCounts[id] = (memberCounts[id] ?? 0) + 1;
    }
  }
  return { units, memberCounts };
}

function revalidateUnits(applicationId: string) {
  revalidatePath(`/applications/${applicationId}/settings/business-units`);
  revalidatePath(`/applications/${applicationId}/settings/people`);
  revalidatePath(`/applications/${applicationId}`, "layout");
}

/** Creates a unit, or changes one when id is given. */
export async function saveBusinessUnit(input: {
  applicationId: string;
  id?: string;
  name: string;
  description?: string;
  allMarkets: boolean;
  markets: string[];
}): Promise<{ id: string }> {
  const { access } = await requireAppCapability(input.applicationId, "roles.manage");
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new UserFacingError("Give the business unit a name.");
  const markets = input.allMarkets ? [] : cleanMarkets(input.markets);
  const unknown = markets.filter((code) => !MARKETS.some((market) => market.code === code));
  if (unknown.length > 0) {
    throw new UserFacingError(`Unknown countries: ${unknown.join(", ")}.`);
  }
  if (!input.allMarkets && markets.length === 0) {
    throw new UserFacingError("Choose at least one country, or All countries.");
  }
  const next = { all_markets: input.allMarkets, markets };
  if (!coversUnit(access, next)) {
    throw new UserFacingError("You can only set up business units within your own countries.");
  }

  const units = await listBusinessUnits(input.applicationId);
  if (!units) throw new UserFacingError("Run migration 032 from Setup to add business units.");
  const clash = units.find(
    (unit) => unit.id !== input.id && unit.name.toLowerCase() === name.toLowerCase()
  );
  if (clash) throw new UserFacingError(`There is already a business unit called ${clash.name}.`);

  const db = await getDb();
  const row = {
    name,
    description: input.description?.trim().slice(0, 300) ?? "",
    all_markets: input.allMarkets,
    markets,
  };
  if (input.id) {
    const current = units.find((unit) => unit.id === input.id);
    if (!current) throw new UserFacingError("That business unit is no longer in this application.");
    if (!coversUnit(access, current)) {
      throw new UserFacingError(
        `${current.name} covers countries outside yours, so you cannot change it.`
      );
    }
    const { error } = await db
      .from("business_units")
      .update(row)
      .eq("id", input.id)
      .eq("application_id", input.applicationId);
    if (error) throw new Error(error.message);
    revalidateUnits(input.applicationId);
    return { id: input.id };
  }

  const { data, error } = await db
    .from("business_units")
    .insert({ application_id: input.applicationId, ...row })
    .select("id")
    .single();
  if (error) {
    if (isMissingBusinessUnits(error)) {
      throw new UserFacingError("Run migration 032 from Setup to add business units.");
    }
    throw new Error(error.message);
  }
  revalidateUnits(input.applicationId);
  return { id: String(data.id) };
}

/** Deletes a unit nobody is in. */
export async function deleteBusinessUnit(input: {
  applicationId: string;
  id: string;
}): Promise<void> {
  const { access } = await requireAppCapability(input.applicationId, "roles.manage");
  const units = await listBusinessUnits(input.applicationId);
  const unit = units?.find((item) => item.id === input.id);
  if (!unit) throw new UserFacingError("That business unit is no longer in this application.");
  if (!coversUnit(access, unit)) {
    throw new UserFacingError(`${unit.name} covers countries outside yours, so you cannot delete it.`);
  }
  const db = await getDb();
  const { count, error: countError } = await db
    .from("application_member_business_units")
    .select("member_id", { count: "exact", head: true })
    .eq("business_unit_id", input.id);
  if (countError) throw new Error(countError.message);
  if (count) {
    throw new UserFacingError(
      `Move the ${count} ${count === 1 ? "person" : "people"} in ${unit.name} to another unit first.`
    );
  }
  const { error } = await db
    .from("business_units")
    .delete()
    .eq("id", input.id)
    .eq("application_id", input.applicationId);
  if (error) throw new Error(error.message);
  revalidateUnits(input.applicationId);
}
