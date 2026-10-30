import type { ScopedThreadRef } from "@t3tools/contracts";
import { CodeIcon, LayoutDashboardIcon } from "lucide-react";
import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from "react";

import { appendComposerPrompt } from "~/composerDraftStore";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";

import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";

// The OpenUI runtime loads only for replies that contain an openui block.
const OpenUiView = lazy(async () => {
  const [{ OpenUiView }, { OPENUI_CSS }] = await Promise.all([
    import("@t3tools/openui/react"),
    import("@t3tools/openui/styles"),
  ]);
  const style = document.createElement("style");
  style.textContent = OPENUI_CSS;
  document.head.append(style);
  return { default: OpenUiView };
});

export function MarkdownOpenUiCodeBlock({
  code,
  fenceTitle,
  theme,
  isStreaming,
  threadRef,
  onOpenUrl,
  children,
}: {
  code: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  isStreaming: boolean;
  threadRef: ScopedThreadRef | undefined;
  onOpenUrl: (url: string) => void;
  children: ReactNode;
}) {
  const [showCode, setShowCode] = useState(false);
  const renderTheme = useHtmlRenderTheme();
  const showUi = !showCode && !isStreaming && code.trim().length > 0;
  const toggleLabel = showCode ? "Show UI" : "Show code";
  return (
    <MarkdownCodeBlock
      code={code}
      language="openui"
      fenceTitle={fenceTitle}
      theme={theme}
      isStreaming={isStreaming}
      canWrap={!showUi}
      diagram={showUi}
      viewToggle={
        isStreaming ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="icon-xs"
                  onClick={() => setShowCode((value) => !value)}
                  aria-label={toggleLabel}
                />
              }
            >
              {showCode ? (
                <LayoutDashboardIcon className="size-3" />
              ) : (
                <CodeIcon className="size-3" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">{toggleLabel}</TooltipPopup>
          </Tooltip>
        )
      }
    >
      {showUi ? (
        <RenderErrorBoundary resetKeys={[code]} fallback={children}>
          <Suspense fallback={children}>
            {/* The same theme tokens html_render pages get, so both paths match. */}
            <div className="p-3" style={renderTheme.variables as CSSProperties}>
              <OpenUiView
                source={code}
                onOpenUrl={onOpenUrl}
                onPrompt={(text) => {
                  if (threadRef) appendComposerPrompt(threadRef, text);
                }}
              />
            </div>
          </Suspense>
        </RenderErrorBoundary>
      ) : (
        children
      )}
    </MarkdownCodeBlock>
  );
}
