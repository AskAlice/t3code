import { HTML_RENDER_PROMPT_METHOD } from "@t3tools/shared/htmlRender";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { OPENUI_SOURCE_ELEMENT_ID } from "./protocol.ts";
import { OpenUiView } from "./react.tsx";

// Web hosts frame the page; React Native hosts load it top-level with their own bridge.
const nativeHost = (window as { ReactNativeWebView?: { postMessage(data: string): void } })
  .ReactNativeWebView;

const postToHost = (method: string, params: Record<string, unknown>, id?: string) => {
  const message = { jsonrpc: "2.0", ...(id ? { id } : {}), method, params };
  if (nativeHost) nativeHost.postMessage(JSON.stringify(message));
  else if (window.parent !== window) window.parent.postMessage(message, "*");
  else return false;
  return true;
};

let linkRequest = 0;
const openUrl = (url: string) => {
  const opened = postToHost(
    "ui/open-link",
    { url, metaKey: false, ctrlKey: false },
    `openui-${++linkRequest}`,
  );
  if (!opened) window.open(url, "_blank", "noopener");
};

const sourceElement = document.getElementById(OPENUI_SOURCE_ELEMENT_ID);
const source = sourceElement ? (JSON.parse(sourceElement.textContent ?? '""') as string) : "";
const mount = document.createElement("div");
document.body.append(mount);
// Render synchronously so the height measured at load already includes the content.
flushSync(() =>
  createRoot(mount).render(
    <OpenUiView
      source={source}
      onOpenUrl={openUrl}
      onPrompt={(text) => postToHost(HTML_RENDER_PROMPT_METHOD, { text })}
    />,
  ),
);
