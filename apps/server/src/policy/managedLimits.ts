/**
 * managedLimits - what `limits.clients` and `limits.connect` in the managed policy allow, and the
 * one error every refusal uses so each transport can show the administrator's organization.
 *
 * @module managedLimits
 */
import type {
  ManagedPolicyClient,
  ManagedPolicyDocument,
  ServerAuthPolicy,
} from "@t3tools/contracts";
import {
  disableTailscaleServe,
  readTailscaleServePortsProxyingTo,
  type TailscaleStderrDiagnostic,
} from "@t3tools/tailscale";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

type PolicyDocument = { readonly document: ManagedPolicyDocument | undefined };

export class ManagedPolicyRefusedError extends Schema.TaggedError<ManagedPolicyRefusedError>()(
  "ManagedPolicyRefusedError",
  {
    organization: Schema.String,
    /** What the policy does not allow, for example "T3 Connect". */
    action: Schema.String,
    /** What that means for this request, for example "so the server cannot listen on 0.0.0.0". */
    detail: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return `${this.organization}'s policy does not allow ${this.action}${
      this.detail === undefined ? "" : `, ${this.detail}`
    }.`;
  }
}

const CLIENT_AUTH_POLICY: Record<ManagedPolicyClient, ServerAuthPolicy> = {
  desktop: "desktop-managed-local",
  "local-browser": "loopback-browser",
  remote: "remote-reachable",
};

const AUTH_POLICY_ACTION: Record<ServerAuthPolicy, string> = {
  "desktop-managed-local": "the desktop app",
  "loopback-browser": "browsers on this machine",
  "remote-reachable": "remote clients",
  "unsafe-no-auth": "running without authentication",
};

/** Whether the server may run with `authPolicy`. Any policy file rules out `unsafe-no-auth`. */
export function allowsAuthPolicy(policy: PolicyDocument, authPolicy: ServerAuthPolicy): boolean {
  if (policy.document === undefined) return true;
  if (authPolicy === "unsafe-no-auth") return false;
  const clients = policy.document.limits?.clients;
  return (
    clients === undefined || clients.some((client) => CLIENT_AUTH_POLICY[client] === authPolicy)
  );
}

/** Whether anything off this machine may pair, by LAN, Tailscale, or a minted link. */
export const allowsRemoteClients = (policy: PolicyDocument) =>
  allowsAuthPolicy(policy, "remote-reachable");

/** T3 Connect is a way for remote clients in, so a policy without `remote` turns it off too. */
export const allowsConnect = (policy: PolicyDocument) =>
  policy.document?.limits?.connect !== false && allowsRemoteClients(policy);

const refuse = (policy: PolicyDocument, action: string, detail?: string) =>
  new ManagedPolicyRefusedError({
    organization: policy.document?.organization ?? "Your organization",
    action,
    ...(detail === undefined ? {} : { detail }),
  });

export const refuseConnect = (policy: PolicyDocument) => refuse(policy, "T3 Connect");

/** Tailscale answers that leave nothing T3 Code made forwarding here right now. */
const NOTHING_TO_CLOSE: ReadonlySet<TailscaleStderrDiagnostic | undefined> = new Set([
  "not-running",
  "not-logged-in",
  // T3 Code makes mappings with this same CLI, so one it may not read, it could not have made.
  "permission-denied",
]);

/**
 * Turns off Tailscale Serve that forwards to `port`, such as one `t3 pair --tailscale` left from
 * before the policy. Runs before the server binds, and fails when such a mapping stays on or
 * Tailscale's answer cannot be read. Without the CLI, or with Tailscale down, nothing is closed.
 */
export const closeTailscaleServeTo = Effect.fn("managedLimits.closeTailscaleServeTo")(function* (
  policy: PolicyDocument,
  port: number,
) {
  if (allowsRemoteClients(policy)) return;
  const servePorts = yield* readTailscaleServePortsProxyingTo(port).pipe(
    Effect.catchTags({
      TailscaleCommandSpawnError: () => Effect.succeed([]),
      TailscaleCommandExitError: (error) =>
        NOTHING_TO_CLOSE.has(error.stderrDiagnostic) ? Effect.succeed([]) : Effect.fail(error),
    }),
    Effect.mapError(() =>
      refuseRemoteClients(policy, "so the server waits until Tailscale Serve can be checked"),
    ),
  );
  for (const servePort of servePorts) {
    yield* disableTailscaleServe({ servePort }).pipe(
      Effect.mapError(() =>
        refuseRemoteClients(
          policy,
          `so Tailscale Serve on port ${servePort}, which forwards here, must be turned off first`,
        ),
      ),
    );
    yield* Effect.logInfo("Turned off Tailscale Serve the managed policy does not allow", {
      servePort,
    });
  }
});

export const refuseRemoteClients = (policy: PolicyDocument, detail?: string) =>
  refuse(policy, AUTH_POLICY_ACTION["remote-reachable"], detail);

/**
 * Fails when the server would accept clients the policy leaves out. Runs before the server binds,
 * so a refused configuration never listens, not even briefly.
 */
export const checkServerReachability = Effect.fn("managedLimits.checkServerReachability")(
  function* (
    policy: PolicyDocument,
    input: {
      readonly authPolicy: ServerAuthPolicy;
      readonly host: string | undefined;
      readonly tailscaleServeEnabled: boolean;
    },
  ) {
    if (!allowsAuthPolicy(policy, input.authPolicy)) {
      return yield* input.authPolicy === "remote-reachable"
        ? refuseRemoteClients(policy, `so the server cannot listen on ${input.host ?? "this host"}`)
        : refuse(policy, AUTH_POLICY_ACTION[input.authPolicy]);
    }
    if (input.tailscaleServeEnabled && !allowsRemoteClients(policy)) {
      return yield* refuseRemoteClients(policy, "so Tailscale Serve cannot be turned on");
    }
  },
);
