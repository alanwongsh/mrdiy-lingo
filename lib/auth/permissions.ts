import type { ApplicationModelType } from "@/lib/types";

/**
 * Every permission the app checks. Which roles hold which permission is
 * stored in access_role_permissions and mapped under each application's Settings → Roles.
 * Add a permission here only together with the server check that uses it.
 * `models` lists the application types the permission means anything in; leave it out when it applies to all.
 */
export const PERMISSIONS = [
  {
    key: "content.edit",
    group: "Content",
    label: "Create and edit content",
    hint: "Articles, strings, catalog items and their translations. Save drafts, submit for review, auto-translate, run quality checks, delete articles.",
  },
  {
    key: "content.import",
    group: "Content",
    label: "Import files",
    hint: "Import articles, strings, or catalog items from a file.",
  },
  {
    key: "content.approve",
    group: "Content",
    label: "Approve content",
    hint: "Approve content and translations, request changes, and move articles to Approved or Published.",
  },
  {
    key: "settings.general",
    group: "Settings",
    label: "Application details",
    hint: "Change the application name, description, and status.",
  },
  {
    key: "settings.notifications",
    models: ["CONTENT"],
    group: "Settings",
    label: "Review emails",
    hint: "Turn review emails on or off.",
  },
  {
    key: "settings.content_types",
    models: ["CONTENT"],
    group: "Settings",
    label: "Article types",
    hint: "Add, rename, and remove article types.",
  },
  {
    key: "settings.fields",
    models: ["CATALOG"],
    group: "Settings",
    label: "Catalog fields",
    hint: "Add, change, and switch off catalog fields.",
  },
  {
    key: "settings.quality",
    models: ["CONTENT"],
    group: "Settings",
    label: "Quality scoring and publishing",
    hint: "Scoring weights, quality checks, and publish vendors.",
  },
  {
    key: "settings.terminology",
    models: ["CONTENT"],
    group: "Settings",
    label: "Terminology",
    hint: "Add, change, and remove terminology entries.",
  },
  {
    key: "settings.boilerplate",
    models: ["CONTENT"],
    group: "Settings",
    label: "Boilerplate",
    hint: "Standard passages, such as the company introduction, that translations must keep word for word.",
  },
  {
    key: "people.manage",
    models: ["CONTENT", "CATALOG"],
    group: "People",
    label: "Manage people",
    hint: "Add and remove people and give them roles. They can only give roles whose permissions they hold.",
  },
  {
    key: "roles.manage",
    group: "People",
    label: "Manage roles",
    hint: "Add, rename, and delete this application's roles and map their permissions. They can only tick permissions they hold.",
  },
] as const satisfies readonly {
  key: string;
  group: string;
  label: string;
  hint: string;
  models?: readonly ApplicationModelType[];
}[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((item) => item.key);

export const PERMISSION_GROUPS = [...new Set(PERMISSIONS.map((item) => item.group))];

const MODEL_LABELS: Record<ApplicationModelType, string> = {
  CONTENT: "Articles",
  CATALOG: "Catalog",
  STRING: "Strings",
};

/** The permissions that mean something in this type of application. Null lists all of them. */
export function permissionsForModel(model: ApplicationModelType | null) {
  return PERMISSIONS.filter(
    (item) => !model || !("models" in item) || (item.models as readonly string[]).includes(model)
  );
}

/** "Articles apps only" style note for a permission limited to some application types. */
export function permissionModelNote(key: PermissionKey): string | null {
  const item = PERMISSIONS.find((entry) => entry.key === key);
  if (!item || !("models" in item)) return null;
  return `${item.models.map((model) => MODEL_LABELS[model]).join(" and ")} apps only`;
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
}

export function parsePermissions(values: unknown): PermissionKey[] {
  if (!Array.isArray(values)) return [];
  return PERMISSION_KEYS.filter((key) => values.includes(key));
}

/** What an editor could do before roles were mapped by hand. Mirrors migration 026. */
export const EDITOR_PERMISSIONS: readonly PermissionKey[] = [
  "content.edit",
  "content.import",
  "settings.content_types",
  "settings.terminology",
  "settings.boilerplate",
];

/** What an approver could do before roles were mapped by hand. Mirrors migration 026. */
export const APPROVER_PERMISSIONS: readonly PermissionKey[] = [
  ...EDITOR_PERMISSIONS,
  "content.approve",
  "settings.notifications",
  "settings.fields",
  "settings.quality",
];

/** True when this access holds the permission. Owners and superadmins hold all of them. */
export function can(access: { permissions: readonly PermissionKey[] }, key: PermissionKey): boolean {
  return access.permissions.includes(key);
}

/** A role can be given only by someone who holds every permission in it. */
export function canGrantRole(
  actor: { permissions: readonly PermissionKey[] },
  role: { permissions: readonly PermissionKey[] }
): boolean {
  return role.permissions.every((key) => actor.permissions.includes(key));
}
