import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ProviderDriverKind } from "@t3tools/contracts";

import * as ManagedPolicy from "./ManagedPolicy.ts";
import { disallowedDriverReason } from "./managedProviders.ts";

it.layer(NodeServices.layer)("ManagedPolicy.load", (it) => {
  const loadFrom = (contents: string | undefined) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-managed-policy-" });
      const file = path.join(dir, "policy.json");
      if (contents !== undefined) yield* fs.writeFileString(file, contents);
      return yield* ManagedPolicy.load(file);
    }).pipe(Effect.scoped);

  it.effect("means no policy when the file is missing", () =>
    Effect.gen(function* () {
      const policy = yield* loadFrom(undefined);
      assert.isUndefined(policy.summary);
    }),
  );

  it.effect("summarizes locked settings for clients", () =>
    Effect.gen(function* () {
      const policy = yield* loadFrom(
        JSON.stringify({
          schemaVersion: 1,
          organization: "Example Corp",
          supportUrl: "https://it.example/t3",
          settings: {
            "storageCleanup.logsAfterDays": { value: 30, locked: true },
            defaultRuntimeMode: { value: "approval-required", locked: false },
          },
        }),
      );
      assert.deepEqual(policy.summary, {
        organization: "Example Corp",
        supportUrl: "https://it.example/t3",
        lockedSettings: ["storageCleanup.logsAfterDays"],
      });
    }),
  );

  it.effect("tells clients which capabilities the policy switches off", () =>
    Effect.gen(function* () {
      const policy = yield* loadFrom(
        JSON.stringify({
          schemaVersion: 1,
          organization: "Example Corp",
          limits: { webhookTasks: false, telemetry: true },
        }),
      );
      assert.deepEqual(policy.summary?.limits, { webhookTasks: false, telemetry: true });
      assert.equal(ManagedPolicy.deniedBy(policy, "webhookTasks"), "Example Corp");
      assert.isUndefined(ManagedPolicy.deniedBy(policy, "telemetry"));
      assert.isUndefined(ManagedPolicy.deniedBy(policy, "browserCookieImport"));
    }),
  );

  it.effect("refuses files it cannot fully enforce", () =>
    Effect.gen(function* () {
      const base = { schemaVersion: 1, organization: "Example Corp" };
      const reasons = yield* Effect.forEach(
        [
          "{ not json",
          // An unknown key may be a restriction from a newer release.
          JSON.stringify({ ...base, limits: { connect: false, futureLimit: true } }),
          JSON.stringify({ ...base, settings: { notASetting: { value: 1, locked: true } } }),
          JSON.stringify({
            ...base,
            settings: { "storageCleanup.logsAfterDayz": { value: 30, locked: true } },
          }),
          JSON.stringify({
            ...base,
            settings: { defaultRuntimeMode: { value: "yolo", locked: true } },
          }),
          JSON.stringify({
            ...base,
            settings: { projectSettingsOverrides: { value: {}, locked: true } },
          }),
        ],
        (contents) =>
          loadFrom(contents).pipe(
            Effect.flip,
            Effect.map((error) => error.reason),
          ),
      );
      assert.lengthOf(reasons, 6);
      assert.include(reasons[3], "storageCleanup.logsAfterDayz");
    }),
  );

  it.effect("tells clients the runtime mode ceiling", () =>
    Effect.gen(function* () {
      const policy = yield* loadFrom(
        JSON.stringify({
          schemaVersion: 1,
          organization: "Example Corp",
          settings: { defaultRuntimeMode: { value: "approval-required", locked: true } },
          limits: { maxRuntimeMode: "auto-accept-edits" },
        }),
      );
      assert.deepEqual(policy.summary?.limits, { maxRuntimeMode: "auto-accept-edits" });
    }),
  );

  it.effect("refuses a default runtime mode above its own ceiling", () =>
    Effect.gen(function* () {
      const reasons = yield* Effect.forEach([false, true], (locked) =>
        loadFrom(
          JSON.stringify({
            schemaVersion: 1,
            organization: "Example Corp",
            settings: { defaultRuntimeMode: { value: "auto", locked } },
            limits: { maxRuntimeMode: "auto-accept-edits" },
          }),
        ).pipe(
          Effect.flip,
          Effect.map((error) => error.reason),
        ),
      );
      assert.deepEqual(reasons, [
        '"defaultRuntimeMode" is above "limits.maxRuntimeMode"',
        '"defaultRuntimeMode" is above "limits.maxRuntimeMode"',
      ]);
    }),
  );

  it.effect("tells clients which drivers run and which instance fields are locked", () =>
    Effect.gen(function* () {
      const policy = yield* loadFrom(
        JSON.stringify({
          schemaVersion: 1,
          organization: "Example Corp",
          limits: {
            providers: {
              allowedDrivers: ["claudeAgent", "codex"],
              instances: {
                claudeAgent: {
                  locked: true,
                  environment: [{ name: "CLAUDE_CODE_USE_BEDROCK", value: "1" }],
                  binaryPath: "/opt/claude/bin/claude",
                },
                codex: { locked: false, launchArgs: "-c model_provider=gateway" },
              },
            },
          },
        }),
      );
      assert.deepEqual<unknown>(policy.summary?.limits, {
        providers: {
          allowedDrivers: ["claudeAgent", "codex"],
          lockedInstanceFields: {
            claudeAgent: ["config.binaryPath", "environment.CLAUDE_CODE_USE_BEDROCK"],
          },
        },
      });
      assert.equal(
        disallowedDriverReason(policy.summary, ProviderDriverKind.make("cursor")),
        "Example Corp's policy does not allow the Cursor provider.",
      );
      assert.isUndefined(disallowedDriverReason(policy.summary, ProviderDriverKind.make("codex")));
    }),
  );

  it.effect("refuses provider limits it cannot enforce", () =>
    Effect.gen(function* () {
      const withProviders = (providers: unknown) =>
        JSON.stringify({
          schemaVersion: 1,
          organization: "Example Corp",
          limits: { providers },
        });
      const reasons = yield* Effect.forEach(
        [
          withProviders({ allowedDrivers: ["claudeAgent", "notAProvider"] }),
          withProviders({ instances: { notAProvider: { locked: true, binaryPath: "/x" } } }),
          // Cursor has no launch arguments setting to pin.
          withProviders({ instances: { cursor: { locked: true, launchArgs: "--x" } } }),
          withProviders({ instances: { codex: { locked: true, homePath: "/x" } } }),
          withProviders({
            instances: { codex: { locked: true, environment: [{ name: "1BAD", value: "" }] } },
          }),
        ],
        (contents) =>
          loadFrom(contents).pipe(
            Effect.flip,
            Effect.map((error) => error.reason),
          ),
      );
      assert.lengthOf(reasons, 5);
      assert.include(reasons[0], "notAProvider");
      assert.include(reasons[1], "notAProvider");
      assert.include(reasons[2], "launchArgs");
    }),
  );

  it.effect(
    "tells clients how updates are managed and refuses an update feed it cannot trust",
    () =>
      Effect.gen(function* () {
        const base = { schemaVersion: 1, organization: "Example Corp" };
        const updates = {
          mode: "manual" as const,
          feedUrl: "https://updates.example/t3",
          allowNightly: false,
        };
        const policy = yield* loadFrom(JSON.stringify({ ...base, limits: { updates } }));
        assert.deepEqual(policy.summary?.limits, { updates });
        for (const invalid of [
          { mode: "manual", feedUrl: "http://updates.example/t3" },
          { mode: "sometimes" },
          { mode: "auto", pinVersion: "1.2.3" },
        ]) {
          yield* loadFrom(JSON.stringify({ ...base, limits: { updates: invalid } })).pipe(
            Effect.flip,
          );
        }
      }),
  );
});
