import { ManagedPolicyDocument } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class ManagedPolicyFileError extends Schema.TaggedError<ManagedPolicyFileError>()(
  "ManagedPolicyFileError",
  {
    path: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `The managed policy at ${this.path} is invalid: ${this.reason}. T3 Code will not start until an administrator fixes or removes it.`;
  }
}

/** The system path an administrator deploys the policy to on `platform`. */
export function managedPolicyPath(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "/Library/Application Support/T3Code/policy.json";
    case "win32":
      // Not %ProgramData%: users can point that variable somewhere they write.
      return "C:\\ProgramData\\T3Code\\policy.json";
    default:
      return "/etc/t3code/policy.json";
  }
}

// Unknown keys may be restrictions from a newer release; refusing them keeps a file this
// build cannot fully enforce from looking enforced.
const decodeDocumentExit = Schema.decodeUnknownExit(Schema.fromJsonString(ManagedPolicyDocument), {
  onExcessProperty: "error",
});

const decodeDocument = (path: string, raw: string) => {
  const decoded = decodeDocumentExit(raw);
  return Exit.isFailure(decoded)
    ? Effect.fail(
        new ManagedPolicyFileError({
          path,
          reason: "it is not valid JSON or does not match the policy schema",
          cause: decoded.cause,
        }),
      )
    : Effect.succeed(decoded.value);
};

/** Read the policy document at `path`; a missing file means no policy. */
export const readManagedPolicyFile = Effect.fn("readManagedPolicyFile")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs
    .exists(path)
    .pipe(
      Effect.mapError(
        (cause) =>
          new ManagedPolicyFileError({ path, reason: "the file cannot be checked", cause }),
      ),
    );
  if (!exists) return undefined;
  const raw = yield* fs
    .readFileString(path)
    .pipe(
      Effect.mapError(
        (cause) => new ManagedPolicyFileError({ path, reason: "the file cannot be read", cause }),
      ),
    );
  return yield* decodeDocument(path, raw);
});

/** Where a configuration profile's managed preferences land on macOS. */
export const MACOS_MANAGED_PREFERENCES_PATH =
  "/Library/Managed Preferences/com.t3tools.t3code.plist";
/** The registry key Group Policy and Intune write to on Windows; `Policy` holds the JSON. */
export const WINDOWS_POLICY_KEY = "HKLM\\SOFTWARE\\Policies\\T3Tools\\T3Code";
// Absolute paths: an earlier PATH entry could otherwise answer that there is no policy.
const PLUTIL = "/usr/bin/plutil";
const REG = "C:\\Windows\\System32\\reg.exe";

const run = Effect.fnUntraced(function* (command: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(
    ChildProcess.make(command, args, { stdin: "ignore", stderr: "ignore" }),
  );
  const [stdout, exitCode] = yield* Effect.all(
    [handle.stdout.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
    { concurrency: 2 },
  );
  return { stdout, exitCode: Number(exitCode) };
}, Effect.scoped);

/** The JSON in `reg query` output for the `Policy` value, or undefined when it has none. */
function parseRegistryPolicy(output: string): string | undefined {
  const match = /^\s*Policy\s+REG_SZ\s+(.*?)\s*$/m.exec(output);
  return match?.[1];
}

/** Read the policy a configuration profile or Group Policy set; absent means no such policy. */
const readPlatformPolicy = Effect.fnUntraced(function* (platform: NodeJS.Platform) {
  if (platform === "darwin") {
    const path = MACOS_MANAGED_PREFERENCES_PATH;
    const exists = yield* (yield* FileSystem.FileSystem)
      .exists(path)
      .pipe(
        Effect.mapError(
          (cause) =>
            new ManagedPolicyFileError({ path, reason: "the profile cannot be checked", cause }),
        ),
      );
    if (!exists) return undefined;
    const converted = yield* run(PLUTIL, ["-convert", "json", "-o", "-", path]).pipe(
      Effect.mapError(
        (cause) =>
          new ManagedPolicyFileError({ path, reason: "the profile cannot be read", cause }),
      ),
    );
    if (converted.exitCode !== 0) {
      return yield* new ManagedPolicyFileError({ path, reason: "the profile cannot be read" });
    }
    return { source: path, document: yield* decodeDocument(path, converted.stdout) };
  }
  if (platform === "win32") {
    const path = WINDOWS_POLICY_KEY;
    const queried = yield* run(REG, ["query", path, "/v", "Policy", "/reg:64"]).pipe(
      Effect.mapError(
        (cause) =>
          new ManagedPolicyFileError({ path, reason: "the registry cannot be read", cause }),
      ),
    );
    // reg exits 1 when the key or value does not exist.
    if (queried.exitCode === 1) return undefined;
    const raw = parseRegistryPolicy(queried.stdout);
    if (queried.exitCode !== 0 || raw === undefined) {
      return yield* new ManagedPolicyFileError({
        path,
        reason: "its Policy value cannot be read as a string",
      });
    }
    return { source: path, document: yield* decodeDocument(path, raw) };
  }
  return undefined;
});

/**
 * Read the machine's policy from wherever an administrator put it: a configuration profile on
 * macOS, the Policies registry key on Windows, or the policy file. Two sources are refused rather
 * than merged, so what applies is never a mix nobody wrote.
 */
export const readManagedPolicy = Effect.fn("readManagedPolicy")(function* (
  platform: NodeJS.Platform,
) {
  const filePath = managedPolicyPath(platform);
  const [platformPolicy, file] = yield* Effect.all([
    readPlatformPolicy(platform),
    readManagedPolicyFile(filePath),
  ]);
  if (platformPolicy !== undefined && file !== undefined) {
    return yield* new ManagedPolicyFileError({
      path: platformPolicy.source,
      reason: `a policy file at ${filePath} also exists; deploy the policy one way`,
    });
  }
  return platformPolicy ?? (file === undefined ? undefined : { source: filePath, document: file });
});
