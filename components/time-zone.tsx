"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { browserTimeZone, DEFAULT_TIME_ZONE, TIME_ZONE_COOKIE } from "@/lib/datetime";

const TimeZoneContext = createContext(DEFAULT_TIME_ZONE);

const subscribe = () => () => {};

/** Remember the zone so the next server render prints the same times. */
function writeTimeZoneCookie(timeZone: string) {
  const { protocol, hostname } = window.location;
  const secureOk = protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
  // Inside the Joget iframe a Lax cookie is not sent back, same as lingo_actor.
  const embedded = window.self !== window.parent;
  const attrs =
    embedded && secureOk
      ? "; SameSite=None; Secure; Partitioned"
      : `; SameSite=Lax${protocol === "https:" ? "; Secure" : ""}`;
  document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(timeZone)}; Path=/; Max-Age=31536000${attrs}`;
}

/**
 * Server and hydration use the zone from the cookie (Malaysia time on a first
 * visit); the browser then switches to its own zone and saves it.
 */
export function TimeZoneProvider({
  initialTimeZone,
  children,
}: {
  initialTimeZone: string;
  children: React.ReactNode;
}) {
  const timeZone = useSyncExternalStore(subscribe, browserTimeZone, () => initialTimeZone);

  useEffect(() => {
    if (timeZone !== initialTimeZone) writeTimeZoneCookie(timeZone);
  }, [timeZone, initialTimeZone]);

  return <TimeZoneContext.Provider value={timeZone}>{children}</TimeZoneContext.Provider>;
}

export function useTimeZone() {
  return useContext(TimeZoneContext);
}
