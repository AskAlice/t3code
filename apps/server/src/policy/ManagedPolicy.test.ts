import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ManagedPolicy from "./ManagedPolicy.ts";

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

  it.effect("refuses files it cannot fully enforce", () =>
    Effect.gen(function* () {
      const base = { schemaVersion: 1, organization: "Example Corp" };
      const reasons = yield* Effect.forEach(
        [
          "{ not json",
          // An unknown key may be a restriction from a newer release.
          JSON.stringify({ ...base, limits: { connect: false } }),
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
});
