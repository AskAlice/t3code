import {
  DEFAULT_SERVER_SETTINGS,
  type ManagedPolicySetting,
  ProjectSettingsOverrides,
  ServerSettings,
} from "@t3tools/contracts";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

const encodeSettings = Schema.encodeSync(ServerSettings);
const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeSettingsExit = Schema.decodeUnknownExit(ServerSettings);

/** Project overrides mirror these top-level keys, so a lock on one applies inside each project. */
const PROJECT_OVERRIDE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(ProjectSettingsOverrides.fields),
);
/** Per-project stores; admins lock the top-level key and the lock reaches every project. */
const UNMANAGEABLE_KEYS: ReadonlySet<string> = new Set([
  "projectSettingsOverrides",
  "projectAgentBrowserAccessOverrides",
  "projectAutoPullOverrides",
  "projectScriptOverrides",
]);

type Segments = ReadonlyArray<string>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const getPath = (tree: unknown, segments: Segments): unknown => {
  let current = tree;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
};

const setPath = (tree: unknown, segments: Segments, value: unknown): unknown => {
  const [head, ...rest] = segments;
  if (head === undefined) return value;
  const record = isRecord(tree) ? tree : {};
  if (value === undefined && rest.length === 0) {
    const { [head]: _removed, ...remaining } = record;
    return remaining;
  }
  return { ...record, [head]: setPath(record[head], rest, value) };
};

/** Fills keys `target` lacks from `defaults`, recursing into objects both sides hold. */
const fillMissing = (target: unknown, defaults: unknown): unknown => {
  if (!isRecord(target) || !isRecord(defaults)) return target;
  const next: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(defaults)) {
    next[key] = key in target ? fillMissing(target[key], value) : value;
  }
  return next;
};

const jsonEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => jsonEqual(left[key], right[key]))
  );
};

/**
 * How a policy's `settings` shape the server's settings. Policy values are never written to
 * the user's settings file: defaults fill keys the file leaves out, and locks are laid over the
 * result on every read, so removing the policy brings the user's own settings back.
 */
export interface ManagedSettings {
  /** Fill policy defaults into a parsed settings file before it is decoded. */
  readonly withDefaults: (persisted: unknown) => unknown;
  /** Built-in defaults with the policy's defaults applied; the settings file omits values equal to these. */
  readonly defaults: ServerSettings;
  /** Lay locked values over settings, including inside each project's overrides. */
  readonly applyLocks: (settings: ServerSettings) => ServerSettings;
  /**
   * Vet a write from `current` to `next`. It is refused when it tries to move a locked path off
   * its locked value, whether set in `patch` or changed by another route such as a legacy patch
   * key. An allowed write keeps the user's stored values at locked paths, so a client re-sending
   * the locked value does not overwrite what applies once the policy is gone.
   */
  readonly vetWrite: (
    current: ServerSettings,
    next: ServerSettings,
    patch: unknown,
  ) =>
    | { readonly _tag: "Allowed"; readonly settings: ServerSettings }
    | { readonly _tag: "Locked"; readonly path: string };
  readonly lockedPaths: ReadonlyArray<string>;
}

export const unmanagedSettings: ManagedSettings = {
  withDefaults: (persisted) => persisted,
  defaults: DEFAULT_SERVER_SETTINGS,
  applyLocks: (settings) => settings,
  vetWrite: (_current, next) => ({ _tag: "Allowed", settings: next }),
  lockedPaths: [],
};

interface Entry {
  readonly path: string;
  readonly segments: Segments;
  /** As written in the policy, the encoded form. */
  readonly value: unknown;
}

interface Lock extends Entry {
  /** The decoded form, which is what patches carry. */
  readonly decodedValue: unknown;
}

/** Locked paths as stored in the top level and in each project's overrides of `encoded`. */
const lockTargets = (encoded: unknown, entry: Entry): ReadonlyArray<Segments> => {
  const [head] = entry.segments;
  if (head === undefined || !PROJECT_OVERRIDE_KEYS.has(head)) return [entry.segments];
  const projects = getPath(encoded, ["projectSettingsOverrides"]);
  const projectTargets = isRecord(projects)
    ? Object.entries(projects)
        .filter(([, overrides]) => isRecord(overrides) && overrides[head] !== undefined)
        .map(([projectId]) => ["projectSettingsOverrides", projectId, ...entry.segments])
    : [];
  return [entry.segments, ...projectTargets];
};

/** Build the overlay for a policy's settings, or describe the first entry this build cannot apply. */
export function makeManagedSettings(
  settings: Readonly<Record<string, ManagedPolicySetting>>,
):
  | { readonly _tag: "Valid"; readonly settings: ManagedSettings }
  | { readonly _tag: "Invalid"; readonly reason: string } {
  const defaults: Entry[] = [];
  const locks: Entry[] = [];
  for (const [path, setting] of Object.entries(settings)) {
    const segments = path.split(".");
    const [head] = segments;
    if (head === undefined || segments.some((segment) => segment.length === 0)) {
      return { _tag: "Invalid", reason: `"${path}" is not a settings path` };
    }
    if (!(head in ServerSettings.fields) || UNMANAGEABLE_KEYS.has(head)) {
      return { _tag: "Invalid", reason: `"${path}" is not a setting this version can manage` };
    }
    (setting.locked ? locks : defaults).push({ path, segments, value: setting.value });
  }

  // Apply every entry to the built-in defaults at once, and read each value back: a typo in a
  // nested key or a value of the wrong type does not survive the round trip.
  const builtIn = encodeSettings(DEFAULT_SERVER_SETTINGS);
  const all = [...defaults, ...locks];
  const applied = all.reduce<unknown>(
    (tree, entry) => setPath(tree, entry.segments, entry.value),
    builtIn,
  );
  const decoded = decodeSettingsExit(applied);
  if (Exit.isFailure(decoded)) {
    return { _tag: "Invalid", reason: "a managed setting has a value of the wrong type" };
  }
  const roundTrip = encodeSettings(decoded.value);
  const lost = all.find((entry) => !jsonEqual(getPath(roundTrip, entry.segments), entry.value));
  if (lost !== undefined) {
    return {
      _tag: "Invalid",
      reason: `"${lost.path}" is not a setting this version can manage, or its value is invalid`,
    };
  }

  const defaultsTree = defaults.reduce<unknown>(
    (tree, entry) => setPath(tree, entry.segments, entry.value),
    {},
  );
  const lockEntries: ReadonlyArray<Lock> = locks.map((entry) => ({
    ...entry,
    decodedValue: getPath(decoded.value, entry.segments),
  }));
  const lockedPaths = locks.map((entry) => entry.path);
  const lockCache = new WeakMap<ServerSettings, ServerSettings>();

  const applyLocks = (current: ServerSettings): ServerSettings => {
    if (locks.length === 0) return current;
    const cached = lockCache.get(current);
    if (cached !== undefined) return cached;
    const encoded = encodeSettings(current);
    const locked = locks.reduce<unknown>(
      (tree, entry) =>
        lockTargets(tree, entry).reduce<unknown>(
          (next, target) => setPath(next, target, entry.value),
          tree,
        ),
      encoded,
    );
    // Validated against the built-in defaults above, so a failure here is a bug, not bad input.
    const result = decodeSettings(locked);
    lockCache.set(current, result);
    return result;
  };

  const vetWrite: ManagedSettings["vetWrite"] = (current, next, patch) => {
    if (locks.length === 0) return { _tag: "Allowed", settings: next };
    const before = encodeSettings(current);
    const after = encodeSettings(next);
    const changed = lockEntries.find(
      (entry) =>
        // Re-sending a stored value the lock overrides changes nothing on disk, but it is still
        // an attempt to change what the user sees.
        lockTargets(patch, entry).some((target) => {
          const value = getPath(patch, target);
          return value !== undefined && !jsonEqual(value, entry.decodedValue);
        }) ||
        lockTargets(after, entry).some((target) => {
          const value = getPath(after, target);
          // Removing a project's override of a locked key is harmless; the lock applies either way.
          return (
            value !== undefined &&
            !jsonEqual(value, getPath(before, target)) &&
            !jsonEqual(value, entry.value)
          );
        }),
    );
    if (changed !== undefined) return { _tag: "Locked", path: changed.path };
    const kept = locks.reduce<unknown>(
      (tree, entry) =>
        lockTargets(tree, entry).reduce<unknown>(
          (result, target) => setPath(result, target, getPath(before, target)),
          tree,
        ),
      after,
    );
    return { _tag: "Allowed", settings: decodeSettings(kept) };
  };

  return {
    _tag: "Valid",
    settings: {
      withDefaults: (persisted) => fillMissing(persisted, defaultsTree),
      defaults: decodeSettings(
        defaults.reduce<unknown>(
          (tree, entry) => setPath(tree, entry.segments, entry.value),
          builtIn,
        ),
      ),
      applyLocks,
      vetWrite,
      lockedPaths,
    },
  };
}
