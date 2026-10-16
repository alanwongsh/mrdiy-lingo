import { marketName, normalizeMarket } from "@/lib/markets";
import type { AppAccess } from "@/lib/types";

/**
 * Business unit rules with no database access, so client components can use them too.
 * Loading and saving units lives in lib/auth/business-units.ts.
 */

/** A group of markets inside one application. Members see articles in these markets only. */
export type BusinessUnit = {
  id: string;
  application_id: string;
  name: string;
  description: string;
  /** Every market, including ones added later. markets is ignored when true. */
  all_markets: boolean;
  markets: string[];
};

/** Upper-case, de-duplicated, sorted market codes. */
export function cleanMarkets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes = value.flatMap((code) => normalizeMarket(String(code)) ?? []);
  return [...new Set(codes)].sort();
}

/** Markets a set of units covers. Null means every market. */
export function marketsForUnits(units: Pick<BusinessUnit, "all_markets" | "markets">[]): string[] | null {
  if (units.some((unit) => unit.all_markets)) return null;
  return [...new Set(units.flatMap((unit) => unit.markets))].sort();
}

/** Matches no market. PostgREST rejects an empty `in` list, so an empty scope uses this. */
const NO_MARKET = "-";

/**
 * Markets to filter article queries by: `query.in("market", scope)`. Null means no filter.
 * Every article query that is not already limited to one checked article must apply it.
 */
export function marketScope(access: Pick<AppAccess, "markets">): string[] | null {
  if (access.markets === null) return null;
  return access.markets.length > 0 ? access.markets : [NO_MARKET];
}

/** Whether this access covers an article in the given market. */
export function canSeeMarket(access: Pick<AppAccess, "markets">, market: string | null | undefined) {
  if (access.markets === null) return true;
  const code = normalizeMarket(market ?? "");
  return code !== null && access.markets.includes(code);
}

/**
 * Whether this access covers every market of a unit. Someone may only create, change,
 * or hand out a unit they fully cover, and only change people whose units they cover.
 */
export function coversUnit(
  access: Pick<AppAccess, "markets">,
  unit: Pick<BusinessUnit, "all_markets" | "markets">
) {
  if (access.markets === null) return true;
  if (unit.all_markets) return false;
  return unit.markets.every((code) => access.markets!.includes(code));
}

/** Short label for a unit's markets: "All countries", "MY, SG", or "MY, SG, TH +4 more". */
export function unitMarketsLabel(
  unit: Pick<BusinessUnit, "all_markets" | "markets">,
  max = 3
) {
  if (unit.all_markets) return "All countries";
  if (unit.markets.length === 0) return "No countries";
  const shown = unit.markets.slice(0, max).join(", ");
  const rest = unit.markets.length - max;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}

/** Every country of a unit by name, for a tooltip: "Malaysia, Singapore, Thailand". */
export function unitMarketsFull(unit: Pick<BusinessUnit, "all_markets" | "markets">) {
  if (unit.all_markets) return "All countries, including ones added later";
  if (unit.markets.length === 0) return "No countries";
  return unit.markets.map((code) => marketName(code)).join(", ");
}
