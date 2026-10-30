import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { build } from "vite-plus";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

const result = await build({
  configFile: false,
  logLevel: "silent",
  // Folds react-lang's development-only devtools import out of the bundle.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    write: false,
    target: "es2022",
    minify: true,
    lib: {
      entry: NodePath.join(root, "src/runtime.tsx"),
      name: "T3OpenUi",
      formats: ["iife"],
    },
  },
});
const bundles = Array.isArray(result) ? result : [result];
const chunk = bundles
  .flatMap((bundle) => ("output" in bundle ? bundle.output : []))
  .find((output) => output.type === "chunk");
if (!chunk) throw new Error("The OpenUI runtime build did not emit a script.");
const dist = NodePath.join(root, "dist");
await NodeFSP.mkdir(dist, { recursive: true });
for (const [file, contents] of [
  ["runtime.mjs", `export default ${JSON.stringify(chunk.code)};\n`],
  ["runtime.d.mts", "declare const runtimeScript: string;\nexport default runtimeScript;\n"],
] as const) {
  const destination = NodePath.join(dist, file);
  const previous = await NodeFSP.readFile(destination, "utf8").catch(() => null);
  if (previous !== contents) await NodeFSP.writeFile(destination, contents);
}
