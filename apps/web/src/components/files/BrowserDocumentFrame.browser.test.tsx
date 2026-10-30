import { describe, expect, it, vi } from "vite-plus/test";
import { commands, page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";

import { HtmlRenderDocument } from "./BrowserDocumentFrame";

const sizeChanged = (height: number) => ({
  jsonrpc: "2.0",
  method: "ui/notifications/size-changed",
  params: { height },
});

describe("HtmlRenderDocument", () => {
  it("reports the page's first height and ignores messages from other windows", async () => {
    using pageUrl = (() => {
      const page = `<script>parent.postMessage(${JSON.stringify(sizeChanged(321))}, "*");</script>`;
      const url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
      return { url, [Symbol.dispose]: () => URL.revokeObjectURL(url) };
    })();
    const onContentHeight = vi.fn();
    await using _screen = await render(
      <HtmlRenderDocument src={pageUrl.url} title="Report" onContentHeight={onContentHeight} />,
    );

    await vi.waitFor(() => expect(onContentHeight).toHaveBeenCalledWith(321));

    // Listeners run in registration order, so once this one sees the message the frame's has too.
    const delivered = new Promise<void>((resolve) =>
      window.addEventListener("message", () => resolve(), { once: true }),
    );
    window.postMessage(sizeChanged(999), "*");
    await delivered;
    expect(onContentHeight).toHaveBeenCalledTimes(1);
  });

  it("lets the page copy to the clipboard when the reader clicks its button", async () => {
    await commands.grantClipboardWrite();
    await using _permissions = { [Symbol.asyncDispose]: () => commands.revokePermissions() };
    using pageUrl = (() => {
      const page = `<button>Copy</button><script>
        document.querySelector("button").onclick = () => navigator.clipboard.writeText("echo hello-27402").then(
          () => parent.postMessage({ copy: "resolved" }, "*"),
          (error) => parent.postMessage({ copy: \`\${error.name}: \${error.message}\` }, "*"),
        );
      </script>`;
      const url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
      return { url, [Symbol.dispose]: () => URL.revokeObjectURL(url) };
    })();
    const copied = new Promise<unknown>((resolve) =>
      window.addEventListener("message", function onMessage(event) {
        if (typeof event.data !== "object" || event.data === null || !("copy" in event.data))
          return;
        window.removeEventListener("message", onMessage);
        resolve(event.data.copy);
      }),
    );
    await using screen = await render(<HtmlRenderDocument src={pageUrl.url} title="Report" />);

    await page
      .frameLocator(screen.getByTitle("Report"))
      .getByRole("button", { name: "Copy" })
      .click();

    expect(await copied).toBe("resolved");
  });
});
