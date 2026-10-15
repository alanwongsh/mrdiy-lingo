import { cookies } from "next/headers";
import { DEFAULT_TIME_ZONE, isTimeZone, TIME_ZONE_COOKIE } from "@/lib/datetime";

/** The viewer's browser time zone as last reported, for server rendering. */
export async function requestTimeZone(): Promise<string> {
  const raw = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  if (!raw) return DEFAULT_TIME_ZONE;
  try {
    const zone = decodeURIComponent(raw);
    return isTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
