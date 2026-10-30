import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { openUiPage } from "@t3tools/openui/page";
import {
  injectHtmlRenderBootstrap,
  readHtmlRenderLinkRequest,
  readHtmlRenderPromptRequest,
} from "@t3tools/shared/htmlRender";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { appendComposerDraftText, useComposerDraft } from "../../state/use-composer-drafts";
import { useHtmlRenderTheme } from "./HtmlRenderWebView";

const HEIGHT_MESSAGE_TYPE = "t3-openui-height";
const INITIAL_HEIGHT = 120;

const HEIGHT_SCRIPT = `(function(){var last;function report(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h===last)return;last=h;window.ReactNativeWebView.postMessage(JSON.stringify({type:${JSON.stringify(HEIGHT_MESSAGE_TYPE)},height:h}));}report();if(window.ResizeObserver)new ResizeObserver(report).observe(document.documentElement);})();true;`;

function readMessage(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/** Draws an ```openui reply block with the same runtime and theme html_render pages use. */
export function OpenUiWebView(props: {
  readonly source: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const theme = useHtmlRenderTheme();
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const draftKey = scopedThreadKey(props.environmentId, props.threadId);
  const draft = useComposerDraft(draftKey).text;
  // Raw HTML has no URL fragment to carry the theme, so the page pins it; a theme change reloads.
  const themeKey = JSON.stringify(theme);
  const html = useMemo(
    () => injectHtmlRenderBootstrap(openUiPage(props.source, JSON.parse(themeKey))),
    [props.source, themeKey],
  );
  const onMessage = (event: WebViewMessageEvent) => {
    const message = readMessage(event.nativeEvent.data);
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === HEIGHT_MESSAGE_TYPE &&
      "height" in message &&
      typeof message.height === "number" &&
      message.height > 0
    ) {
      setHeight(message.height);
      return;
    }
    const link = readHtmlRenderLinkRequest(message);
    if (link !== undefined) {
      void tryOpenExternalUrl(link.url, "html-render");
      return;
    }
    const prompt = readHtmlRenderPromptRequest(message);
    // Add below anything the user is already typing, never replacing it.
    if (prompt !== undefined) {
      appendComposerDraftText(draftKey, draft.trim() ? `\n\n${prompt.text}` : prompt.text);
    }
  };
  return (
    <View style={{ height, marginBottom: 8 }}>
      <WebView<object>
        source={{ html }}
        originWhitelist={["about:*"]}
        style={{ flex: 1, backgroundColor: "transparent" }}
        scrollEnabled={false}
        nestedScrollEnabled={false}
        injectedJavaScript={HEIGHT_SCRIPT}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={(request) => request.url.startsWith("about:")}
        onOpenWindow={(event) => {
          const url = event.nativeEvent.targetUrl;
          if (/^https?:/i.test(url)) void tryOpenExternalUrl(url, "html-render");
        }}
      />
    </View>
  );
}
