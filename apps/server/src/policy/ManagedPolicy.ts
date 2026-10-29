/**
 * ManagedPolicy - the administrator's machine-wide policy file, read once at startup. A file this
 * build cannot fully enforce stops the server instead of leaving it looking managed.
 *
 * @module ManagedPolicy
 */
import type { ManagedPolicyDocument, ManagedPolicySummary } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  ManagedPolicyFileError,
  managedPolicyPath,
  readManagedPolicyFile,
} from "@t3tools/shared/managedPolicyFile";

import { telemetryChannel } from "../config.ts";
import * as ManagedSettings from "./managedSettings.ts";

export class ManagedPolicy extends Context.Service<
  ManagedPolicy,
  {
    /** Where the policy is read from, whether or not a file exists there. */
    readonly path: string;
    readonly document: ManagedPolicyDocument | undefined;
    readonly settings: ManagedSettings.ManagedSettings;
    /** What clients are told; absent when no policy applies. */
    readonly summary: ManagedPolicySummary | undefined;
  }
>()("t3/policy/ManagedPolicy") {}

/** Build the service from a decoded document; fails when the document cannot be enforced. */
export const fromDocument = Effect.fn("ManagedPolicy.fromDocument")(function* (
  path: string,
  document: ManagedPolicyDocument | undefined,
) {
  if (document === undefined) {
    return ManagedPolicy.of({
      path,
      document: undefined,
      settings: ManagedSettings.unmanagedSettings,
      summary: undefined,
    });
  }
  const settings = ManagedSettings.makeManagedSettings(document.settings ?? {});
  if (settings._tag === "Invalid") {
    return yield* new ManagedPolicyFileError({ path, reason: settings.reason });
  }
  return ManagedPolicy.of({
    path,
    document,
    settings: settings.settings,
    summary: {
      organization: document.organization,
      ...(document.supportUrl === undefined ? {} : { supportUrl: document.supportUrl }),
      lockedSettings: settings.settings.lockedPaths,
    },
  });
});

/** Read and validate the policy at `path`; a missing file means no policy. */
export const load = Effect.fn("ManagedPolicy.load")(function* (path: string) {
  return yield* fromDocument(path, yield* readManagedPolicyFile(path));
});

const make = Effect.gen(function* () {
  // Source builds may read a policy from elsewhere so it can be tried without root. Release
  // builds never do: any override a user can set is a way around the policy.
  const devPath =
    telemetryChannel === "dev"
      ? yield* Config.option(Config.String("T3CODE_DEV_MANAGED_POLICY_PATH")).pipe(
          Effect.orElseSucceed(() => Option.none<string>()),
        )
      : Option.none<string>();
  const platform = yield* HostProcess.Platform;
  const path = Option.getOrElse(devPath, () => managedPolicyPath(platform));
  const policy = yield* load(path);
  if (policy.summary !== undefined) {
    yield* Effect.logInfo("Managed policy applies.", {
      path,
      organization: policy.summary.organization,
      lockedSettings: policy.summary.lockedSettings,
    });
  }
  return policy;
});

export const layer = Layer.effect(ManagedPolicy, make);

/** A policy for tests; `undefined` means unmanaged. */
export const layerTest = (document?: ManagedPolicyDocument) =>
  Layer.effect(ManagedPolicy, fromDocument("/test/policy.json", document));
