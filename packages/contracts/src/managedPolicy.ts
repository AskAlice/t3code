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

/** Restrictions that are not settings: users cannot opt out of them anywhere. */
export const ManagedPolicyLimits = Schema.Struct({
  /** The broadest runtime mode any thread may be created in, switched to, or run turns in. */
  maxRuntimeMode: Schema.optionalKey(RuntimeMode),
});
export type ManagedPolicyLimits = typeof ManagedPolicyLimits.Type;

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
  limits: Schema.optionalKey(ManagedPolicyLimits),
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
