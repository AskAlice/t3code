import type { HtmlRenderTheme } from "@t3tools/shared/htmlRender";

import runtimeScript from "../dist/runtime.mjs";
import { OPENUI_SOURCE_ELEMENT_ID } from "./protocol.ts";
import { OPENUI_CSS } from "./styles.ts";

/** Escapes `<` so the JSON cannot close its script element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");

/**
 * A self-contained page; the html_render bootstrap supplies the frame bridge and, unless
 * `theme` pins one for hosts that load raw HTML without a URL fragment, the theme.
 */
export function openUiPage(source: string, theme?: HtmlRenderTheme): string {
  const pinned = theme
    ? `:root{color-scheme:${theme.appearance};${Object.entries(theme.variables)
        .map(([name, value]) => `${name}:${value.replace(/[;{}<>]/g, "")};`)
        .join("")}}`
    : "";
  return [
    "<!doctype html><html><head>",
    `<style>${OPENUI_CSS}${pinned}</style>`,
    "</head><body>",
    `<script type="application/json" id="${OPENUI_SOURCE_ELEMENT_ID}">${scriptJson(source)}</script>`,
    `<script>${runtimeScript.replaceAll("</script", "<\\/script")}</script>`,
    "</body></html>",
  ].join("");
}
