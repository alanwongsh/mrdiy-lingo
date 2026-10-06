export const APP_ROLES = ["EDITOR", "HOD", "ADMIN"] as const;

export type AppRole = (typeof APP_ROLES)[number];

const RANK: Record<AppRole, number> = {
  EDITOR: 1,
  HOD: 2,
  ADMIN: 3,
};

const APPROVE_RANK = RANK.HOD;

export const APP_ROLE_LABEL: Record<AppRole, string> = {
  EDITOR: "Editor",
  HOD: "HOD",
  ADMIN: "Admin",
};

/** Account roles are grouped into one of these. HOD means HOD and above. */
export const ORG_BANDS = ["EDITOR", "HOD"] as const;

export type OrgRoleBand = (typeof ORG_BANDS)[number];

export const ORG_BAND_LABEL: Record<OrgRoleBand, string> = {
  EDITOR: "Edit and draft",
  HOD: "HOD and above",
};

export function parseOrgBand(value: unknown): OrgRoleBand | null {
  if (value === "HOD" || value === "ADMIN") return "HOD";
  if (value === "EDITOR") return "EDITOR";
  return null;
}

export function parseAppRole(value: unknown): AppRole | null {
  if (typeof value !== "string") return null;
  return (APP_ROLES as readonly string[]).includes(value)
    ? (value as AppRole)
    : null;
}

export function capabilitiesForRole(role: AppRole): {
  can_edit: boolean;
  can_approve: boolean;
} {
  return {
    can_edit: true,
    can_approve: RANK[role] >= APPROVE_RANK,
  };
}

export function roleFromApprovalFlag(canApprove: boolean): AppRole {
  return canApprove ? "HOD" : "EDITOR";
}
