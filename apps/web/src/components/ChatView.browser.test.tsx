import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

async function mountAppOnThread(threadId: string) {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${threadId}`] }),
  );
  await router.load();
  const container = document.createElement("div");
  container.style.cssText = "height: 900px; width: 1400px;";
  // The app owns its router, as main.tsx does.
  return render(<AppRoot router={router} />, { container, router: false });
}

it("keeps the sidebar rename input when a double-click opens another thread", async () => {
  const [alpha, beta] = [threadWithHistory("alpha", 1), threadWithHistory("beta", 1)];
  using _environment = installFakeEnvironment([alpha, beta]);
  await using _app = await mountAppOnThread(alpha.id);
  await expect.element(page.getByRole("textbox", { name: `Message ${alpha.title}` })).toHaveFocus();

  await userEvent.dblClick(page.getByRole("treeitem", { name: beta.title, exact: false }));
  await expect.element(page.getByRole("textbox", { name: `Message ${beta.title}` })).toBeVisible();
  await userEvent.keyboard(" renamed");

  // Checked once: by now beta has opened and any focus it takes has landed, and a polled
  // assertion would outlast the test budget that mounting the whole app leaves.
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Thread title");
});
