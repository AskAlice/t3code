import runtimeScript from "../dist/runtime.mjs";
import { OPENUI_SOURCE_ELEMENT_ID } from "./protocol.ts";
import { OPENUI_CSS } from "./styles.ts";

/** Escapes `<` so the JSON cannot close its script element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");

/** A self-contained page; the html_render bootstrap supplies the theme and frame bridge. */
export function openUiPage(source: string): string {
  return [
    "<!doctype html><html><head>",
    `<style>${OPENUI_CSS}</style>`,
    "</head><body>",
    `<script type="application/json" id="${OPENUI_SOURCE_ELEMENT_ID}">${scriptJson(source)}</script>`,
    `<script>${runtimeScript.replaceAll("</script", "<\\/script")}</script>`,
    "</body></html>",
  ].join("");
}
