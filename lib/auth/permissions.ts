/**
 * Every permission the app checks. Which roles hold which permission is
 * stored in access_role_permissions and mapped under each application's Settings → Roles.
 * Add a permission here only together with the server check that uses it.
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
    group: "Settings",
    label: "Review emails",
    hint: "Turn review emails on or off.",
  },
  {
    key: "settings.content_types",
    group: "Settings",
    label: "Article types",
    hint: "Add, rename, and remove article types.",
  },
  {
    key: "settings.fields",
    group: "Settings",
    label: "Catalog fields",
    hint: "Add, change, and switch off catalog fields.",
  },
  {
    key: "settings.quality",
    group: "Settings",
    label: "Quality scoring and publishing",
    hint: "Scoring weights, quality checks, and publish vendors.",
  },
  {
    key: "settings.terminology",
    group: "Settings",
    label: "Terminology",
    hint: "Add, change, and remove terminology entries.",
  },
  {
    key: "people.manage",
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
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((item) => item.key);

export const PERMISSION_GROUPS = [...new Set(PERMISSIONS.map((item) => item.group))];

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
