import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  defaultInstanceIdForDriver,
  disallowedProviderMessage,
  type ManagedProviderInstance,
  type ManagedProviderLimits,
  type ManagedPolicySummary,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  type ProviderInstanceId,
  resolveProviderInstanceEnabled,
  type ServerSettings,
} from "@t3tools/contracts";
import { acpRegistryClient } from "@t3tools/provider-acp-registry/client";
import { cursorClient } from "@t3tools/provider-cursor/client";
import { fxClient } from "@t3tools/provider-fx/client";
import { grokClient } from "@t3tools/provider-grok/client";
import { museClient } from "@t3tools/provider-muse/client";
import { openCodeClient } from "@t3tools/provider-opencode/client";
import { piClient } from "@t3tools/provider-pi/client";
import type { ProviderClientDefinition } from "@t3tools/provider-core/client";

interface KnownDriver {
  readonly label: string;
  readonly configFields: ReadonlySet<string>;
  readonly hasDefaultInstance: boolean;
}

const known = (
  driverKind: string,
  label: string,
  settingsSchema: { readonly fields: object },
  hasDefaultInstance = true,
) =>
  [
    ProviderDriverKind.make(driverKind),
    { label, configFields: new Set(Object.keys(settingsSchema.fields)), hasDefaultInstance },
  ] as const;

const PACKAGED_CLIENTS: ReadonlyArray<ProviderClientDefinition> = [
  cursorClient,
  grokClient,
  fxClient,
  museClient,
  openCodeClient,
  piClient,
  acpRegistryClient,
];

/** Drivers this build knows, by the names users see; a policy naming any other is refused. */
const KNOWN_DRIVERS: ReadonlyMap<ProviderDriverKind, KnownDriver> = new Map([
  known("codex", "Codex", CodexSettings),
  known("claudeAgent", "Claude", ClaudeSettings),
  known("antigravity", "Antigravity", AntigravitySettings),
  ...PACKAGED_CLIENTS.map((client) =>
    known(client.driverKind, client.label, client.settingsSchema, client.hasDefaultInstance),
  ),
]);

const PINNED_CONFIG_FIELDS = ["binaryPath", "launchArgs"] as const;
type PinnedConfigField = (typeof PINNED_CONFIG_FIELDS)[number];

export type ProviderWriteVerdict =
  | { readonly _tag: "Allowed"; readonly settings: ServerSettings }
  | { readonly _tag: "Locked"; readonly path: string }
  | {
      readonly _tag: "Disallowed";
      readonly instanceId: ProviderInstanceId;
      readonly label: string;
    };

/**
 * How a policy's `limits.providers` shapes provider instances. Like settings locks, pinned
 * fields are laid over instances on every read and never written to the user's settings file.
 */
export interface ManagedProviders {
  readonly isDriverAllowed: (driver: ProviderDriverKind) => boolean;
  /** Lay pinned fields over every instance of a pinned driver, its default instance included. */
  readonly applyLimits: (settings: ServerSettings) => ServerSettings;
  /**
   * Vet a write from stored `current` to `next`. Refuses enabling a disallowed driver and moving
   * a locked field off its pinned value. Pinned values a client sends back are dropped, so the
   * user's own values return once the policy is gone.
   */
  readonly vetWrite: (current: ServerSettings, next: ServerSettings) => ProviderWriteVerdict;
  /** Per driver, the instance fields users cannot change, for clients. */
  readonly lockedInstanceFields: Readonly<Record<string, ReadonlyArray<string>>>;
}

export const unmanagedProviders: ManagedProviders = {
  isDriverAllowed: () => true,
  applyLimits: (settings) => settings,
  vetWrite: (_current, next) => ({ _tag: "Allowed", settings: next }),
  lockedInstanceFields: {},
};

const labelFor = (driver: ProviderDriverKind) => KNOWN_DRIVERS.get(driver)?.label ?? driver;

/** Why the policy clients were told about keeps `driver` from running, or undefined when it may run. */
export const disallowedDriverReason = (
  summary: ManagedPolicySummary | undefined,
  driver: ProviderDriverKind,
): string | undefined => {
  const allowed = summary?.limits?.providers?.allowedDrivers;
  return allowed === undefined || allowed.includes(driver)
    ? undefined
    : disallowedProviderMessage(summary?.organization, labelFor(driver));
};

const configRecord = (instance: ProviderInstanceConfig | undefined): Record<string, unknown> =>
  instance?.config !== null &&
  typeof instance?.config === "object" &&
  !Array.isArray(instance.config)
    ? (instance.config as Record<string, unknown>)
    : {};

/** Empty strings are how clients clear a field, so they count as unset. */
const configString = (instance: ProviderInstanceConfig | undefined, field: string) => {
  const value = configRecord(instance)[field];
  return value === "" ? undefined : value;
};

const sameVariable = (
  left: ProviderInstanceEnvironmentVariable | undefined,
  right: ProviderInstanceEnvironmentVariable | undefined,
) =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.value === right.value &&
    left.sensitive === right.sensitive);

const pinnedFields = (pin: ManagedProviderInstance): ReadonlyArray<PinnedConfigField> =>
  PINNED_CONFIG_FIELDS.filter((field) => pin[field] !== undefined);

const overlayInstance = (
  instance: ProviderInstanceConfig,
  pin: ManagedProviderInstance,
): ProviderInstanceConfig => {
  const config = { ...configRecord(instance) };
  for (const field of pinnedFields(pin)) {
    if (pin.locked || configString(instance, field) === undefined) config[field] = pin[field];
  }
  const environment = [...(instance.environment ?? [])];
  for (const variable of pin.environment ?? []) {
    const pinned = { name: variable.name, value: variable.value, sensitive: false };
    const index = environment.findIndex((existing) => existing.name === variable.name);
    if (index === -1) environment.push(pinned);
    else if (pin.locked) environment[index] = pinned;
  }
  return {
    ...instance,
    ...(pinnedFields(pin).length === 0 ? {} : { config }),
    ...(environment.length === 0 ? {} : { environment }),
  };
};

/** Build the overlay for a policy's `limits.providers`, or say why this build cannot enforce it. */
export function makeManagedProviders(
  limits: ManagedProviderLimits,
):
  | { readonly _tag: "Valid"; readonly providers: ManagedProviders }
  | { readonly _tag: "Invalid"; readonly reason: string } {
  for (const driver of limits.allowedDrivers ?? []) {
    if (!KNOWN_DRIVERS.has(driver)) {
      return { _tag: "Invalid", reason: `"${driver}" in allowedDrivers is not a known provider` };
    }
  }
  const pins = new Map<ProviderDriverKind, ManagedProviderInstance>();
  for (const [rawDriver, pin] of Object.entries(limits.instances ?? {})) {
    const driver = ProviderDriverKind.make(rawDriver);
    const known = KNOWN_DRIVERS.get(driver);
    if (known === undefined) {
      return { _tag: "Invalid", reason: `"${driver}" in instances is not a known provider` };
    }
    const unsupported = pinnedFields(pin).find((field) => !known.configFields.has(field));
    if (unsupported !== undefined) {
      return {
        _tag: "Invalid",
        reason: `the ${known.label} provider has no ${unsupported} setting`,
      };
    }
    const names = (pin.environment ?? []).map((variable) => variable.name);
    if (new Set(names).size !== names.length) {
      return { _tag: "Invalid", reason: `instances.${driver}.environment repeats a variable` };
    }
    pins.set(driver, pin);
  }

  const allowed =
    limits.allowedDrivers === undefined ? undefined : new Set<string>(limits.allowedDrivers);
  const isDriverAllowed = (driver: ProviderDriverKind) => allowed?.has(driver) ?? true;
  const allowedSelection = (
    settings: ServerSettings,
    selection: { readonly instanceId: ProviderInstanceId } | null | undefined,
  ) =>
    selection == null ||
    isDriverAllowed(
      settings.providerInstances[selection.instanceId]?.driver ??
        ProviderDriverKind.make(selection.instanceId),
    );

  const cache = new WeakMap<ServerSettings, ServerSettings>();
  const applyLimits = (settings: ServerSettings): ServerSettings => {
    const cached = cache.get(settings);
    if (cached !== undefined) return cached;
    const providerInstances: Record<string, ProviderInstanceConfig> = {
      ...settings.providerInstances,
    };
    // Default instances exist without a settings entry until the user edits one; pin them too.
    for (const driver of pins.keys()) {
      const instanceId = defaultInstanceIdForDriver(driver);
      if (KNOWN_DRIVERS.get(driver)?.hasDefaultInstance === false) continue;
      if (providerInstances[instanceId] === undefined) providerInstances[instanceId] = { driver };
    }
    for (const [instanceId, instance] of Object.entries(providerInstances)) {
      const pin = pins.get(instance.driver);
      if (pin !== undefined) providerInstances[instanceId] = overlayInstance(instance, pin);
    }
    // A cleared selection falls back to the text generation model, which is resolved afterwards.
    const result: ServerSettings = {
      ...settings,
      providerInstances: providerInstances as ServerSettings["providerInstances"],
      sourceControlWriterModelSelection: allowedSelection(
        settings,
        settings.sourceControlWriterModelSelection,
      )
        ? settings.sourceControlWriterModelSelection
        : null,
      reviewGuideModelSelection: allowedSelection(settings, settings.reviewGuideModelSelection)
        ? settings.reviewGuideModelSelection
        : null,
    };
    cache.set(settings, result);
    return result;
  };

  const vetInstance = (
    instanceId: string,
    stored: ProviderInstanceConfig | undefined,
    next: ProviderInstanceConfig,
    pin: ManagedProviderInstance,
  ):
    | { readonly _tag: "Locked"; readonly path: string }
    | { readonly _tag: "Kept"; readonly instance: ProviderInstanceConfig | undefined } => {
    const config = { ...configRecord(next) };
    for (const field of pinnedFields(pin)) {
      const value = configString(next, field);
      const storedValue = configString(stored, field);
      if (value === pin[field] || value === storedValue) {
        if (storedValue === undefined) delete config[field];
        else config[field] = configRecord(stored)[field];
      } else if (pin.locked) {
        return { _tag: "Locked", path: `providerInstances.${instanceId}.config.${field}` };
      }
    }
    let environment: ReadonlyArray<ProviderInstanceEnvironmentVariable> = next.environment ?? [];
    for (const variable of pin.environment ?? []) {
      const sent = environment.find((existing) => existing.name === variable.name);
      const storedVariable = stored?.environment?.find(
        (existing) => existing.name === variable.name,
      );
      const resent = sent !== undefined && !sent.sensitive && sent.value === variable.value;
      if (resent || sameVariable(sent, storedVariable)) {
        // Put the user's own value back where it was sent, or drop the echoed policy value.
        environment = environment.flatMap((existing) =>
          existing.name !== variable.name
            ? [existing]
            : storedVariable === undefined
              ? []
              : [storedVariable],
        );
      } else if (pin.locked) {
        return {
          _tag: "Locked",
          path: `providerInstances.${instanceId}.environment.${variable.name}`,
        };
      }
    }
    const { config: _config, environment: _environment, ...envelope } = next;
    const kept: ProviderInstanceConfig = {
      ...envelope,
      ...(Object.keys(config).length === 0 && stored?.config === undefined ? {} : { config }),
      ...(environment.length === 0 ? {} : { environment }),
    };
    // A default instance the client echoed back with only pinned values stays implicit.
    const echoedDefault =
      stored === undefined &&
      instanceId === defaultInstanceIdForDriver(next.driver) &&
      Object.keys(kept).length === 1;
    return { _tag: "Kept", instance: echoedDefault ? undefined : kept };
  };

  const vetWrite = (current: ServerSettings, next: ServerSettings): ProviderWriteVerdict => {
    const providerInstances: Record<string, ProviderInstanceConfig> = {};
    for (const [instanceId, instance] of Object.entries(next.providerInstances)) {
      const stored = current.providerInstances[instanceId as ProviderInstanceId];
      if (
        !isDriverAllowed(instance.driver) &&
        resolveProviderInstanceEnabled(instance) &&
        JSON.stringify(stored) !== JSON.stringify(instance)
      ) {
        return {
          _tag: "Disallowed",
          instanceId: instanceId as ProviderInstanceId,
          label: labelFor(instance.driver),
        };
      }
      const pin = pins.get(instance.driver);
      if (pin === undefined) {
        providerInstances[instanceId] = instance;
        continue;
      }
      const vetted = vetInstance(
        instanceId,
        stored?.driver === instance.driver ? stored : undefined,
        instance,
        pin,
      );
      if (vetted._tag === "Locked") return vetted;
      if (vetted.instance !== undefined) providerInstances[instanceId] = vetted.instance;
    }
    return {
      _tag: "Allowed",
      settings: {
        ...next,
        providerInstances: providerInstances as ServerSettings["providerInstances"],
      },
    };
  };

  const lockedInstanceFields = Object.fromEntries(
    [...pins]
      .filter(([, pin]) => pin.locked)
      .map(([driver, pin]) => [
        driver,
        [
          ...pinnedFields(pin).map((field) => `config.${field}`),
          ...(pin.environment ?? []).map((variable) => `environment.${variable.name}`),
        ],
      ]),
  );

  return {
    _tag: "Valid",
    providers: {
      isDriverAllowed,
      applyLimits,
      vetWrite,
      lockedInstanceFields,
    },
  };
}
