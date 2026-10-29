import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { RuntimeMode } from "./providerPolicy.ts";

/**
 * One server setting an administrator manages, keyed in the policy by its dot path in the
 * encoded `ServerSettings` (for example `storageCleanup.logsAfterDays`). `locked: false`
 * replaces the built-in default; `locked: true` also stops users and agents from changing it.
 */
export const ManagedPolicySetting = Schema.Struct({
  value: Schema.Unknown,
  locked: Schema.Boolean,
});
export type ManagedPolicySetting = typeof ManagedPolicySetting.Type;

/** A kind of client the server may accept, mapped onto `ServerAuthPolicy`. */
export const ManagedPolicyClient = Schema.Literals(["desktop", "local-browser", "remote"]);
export type ManagedPolicyClient = typeof ManagedPolicyClient.Type;

/**
 * Restrictions that are not settings: users cannot opt out of them anywhere. For the boolean
 * capabilities, omitted means allowed and only `false` restricts.
 */
export const ManagedPolicyLimits = Schema.Struct({
  /** The broadest runtime mode any thread may be created in, switched to, or run turns in. */
  maxRuntimeMode: Schema.optionalKey(RuntimeMode),
  /** Clients the server accepts. Without `remote`, nothing off this machine can pair. */
  clients: Schema.optionalKey(Schema.NonEmptyArray(ManagedPolicyClient)),
  /** `false` turns T3 Connect off and unlinks this machine. */
  connect: Schema.optionalKey(Schema.Boolean),
  webhookTasks: Schema.optionalKey(Schema.Boolean),
  /** Can only turn product analytics off, never force it on. */
  telemetry: Schema.optionalKey(Schema.Boolean),
  browserCookieImport: Schema.optionalKey(Schema.Boolean),
});
export type ManagedPolicyLimits = typeof ManagedPolicyLimits.Type;

/** The limits clients see: what the server enforces, which can be broader than the file says. */
export const ManagedPolicySummaryLimits = Schema.Struct({
  maxRuntimeMode: Schema.optionalKey(RuntimeMode),
  clients: Schema.optionalKey(Schema.NonEmptyArray(ManagedPolicyClient)),
  /** `false` also when `clients` leaves out `remote`, since Connect is remote access. */
  connect: Schema.optionalKey(Schema.Boolean),
  webhookTasks: Schema.optionalKey(Schema.Boolean),
  telemetry: Schema.optionalKey(Schema.Boolean),
  browserCookieImport: Schema.optionalKey(Schema.Boolean),
});
export type ManagedPolicySummaryLimits = typeof ManagedPolicySummaryLimits.Type;

/**
 * The machine-wide policy file an administrator deploys. Decoded with excess properties
 * rejected: a key this build does not know might be a restriction it cannot enforce, and
 * starting anyway would look managed without being managed.
 */
export const ManagedPolicyDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  /** Shown to users as "Managed by <organization>". */
  organization: TrimmedNonEmptyString,
  supportUrl: Schema.optionalKey(TrimmedNonEmptyString),
  settings: Schema.optionalKey(Schema.Record(Schema.String, ManagedPolicySetting)),
  limits: Schema.optionalKey(ManagedPolicyLimits),
});
export type ManagedPolicyDocument = typeof ManagedPolicyDocument.Type;

/** What clients learn about the policy: enough to explain a locked control, no values. */
export const ManagedPolicySummary = Schema.Struct({
  organization: TrimmedNonEmptyString,
  supportUrl: Schema.optionalKey(TrimmedNonEmptyString),
  /** Dot paths into `ServerSettings` that users cannot change. */
  lockedSettings: Schema.Array(Schema.String),
  /** What the server enforces; a missing key means no limit. */
  limits: Schema.optionalKey(ManagedPolicySummaryLimits),
});
export type ManagedPolicySummary = typeof ManagedPolicySummary.Type;

/** Whether `path` is locked itself, sits inside a locked setting, or contains one. */
export function isManagedSettingPath(
  summary: Pick<ManagedPolicySummary, "lockedSettings"> | undefined,
  path: string,
): boolean {
  if (summary === undefined) return false;
  return summary.lockedSettings.some(
    (locked) => locked === path || locked.startsWith(`${path}.`) || path.startsWith(`${locked}.`),
  );
}

/** The one shape users see when policy refuses something: "Example Corp's policy does not allow webhook tasks." */
export function managedPolicyDeniedMessage(organization: string, capability: string): string {
  return `${organization}'s policy does not allow ${capability}.`;
}
