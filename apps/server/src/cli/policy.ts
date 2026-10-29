import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Argument, Command } from "effect/cli";

import * as ManagedPolicy from "../policy/ManagedPolicy.ts";

const describePolicy = (policy: ManagedPolicy.ManagedPolicy["Service"]) => {
  const { document } = policy;
  if (document === undefined) {
    return `No managed policy at ${policy.path}. Every setting belongs to the user.\n`;
  }
  const settings = Object.entries(document.settings ?? {});
  const lines = [
    `Managed by ${document.organization} (${policy.path}).`,
    ...(document.supportUrl === undefined ? [] : [`Support: ${document.supportUrl}`]),
    "",
    settings.length === 0 ? "No managed settings." : "Settings:",
    ...settings.map(
      ([path, setting]) =>
        `  ${path} = ${JSON.stringify(setting.value)} (${setting.locked ? "locked" : "default"})`,
    ),
  ];
  const {
    settings: _settings,
    organization: _organization,
    supportUrl: _supportUrl,
    schemaVersion: _version,
    ...rest
  } = document;
  if (Object.keys(rest).length > 0) {
    lines.push("", "Limits:", JSON.stringify(rest, null, 2));
  }
  return `${lines.join("\n")}\n`;
};

const showCommand = Command.make("show").pipe(
  Command.withDescription("Show the policy that applies to T3 Code on this machine."),
  Command.withHandler(() =>
    ManagedPolicy.ManagedPolicy.pipe(
      Effect.flatMap((policy) => Console.log(describePolicy(policy))),
      Effect.provide(ManagedPolicy.layer),
    ),
  ),
);

const checkCommand = Command.make("check", {
  file: Argument.String("file").pipe(Argument.withDescription("Policy file to validate.")),
}).pipe(
  Command.withDescription("Validate a policy file before deploying it."),
  Command.withHandler(({ file }) =>
    ManagedPolicy.load(file).pipe(Effect.flatMap((policy) => Console.log(describePolicy(policy)))),
  ),
);

export const policyCommand = Command.make("policy").pipe(
  Command.withDescription("Inspect the administrator's managed policy."),
  Command.withSubcommands([showCommand, checkCommand]),
);
