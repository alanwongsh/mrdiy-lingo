"use server";

import { isProduction } from "@/lib/env";

/** isProduction for client components. */
export async function checkIsProduction(): Promise<boolean> {
  return isProduction();
}
