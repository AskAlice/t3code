import { act, createContext, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

// React Native calls the newest listener first and leaves the app when none returns true.
const backListeners = vi.hoisted(() => [] as Array<() => boolean | null | undefined>);

vi.mock("react-native", () => ({
  View: (props: { readonly children?: ReactNode }) => <div>{props.children}</div>,
  BackHandler: {
    addEventListener: (_event: "hardwareBackPress", listener: () => boolean) => {
      backListeners.push(listener);
      return { remove: () => backListeners.splice(backListeners.indexOf(listener), 1) };
    },
  },
  Keyboard: { isVisible: () => false, dismiss: () => {} },
  Platform: { OS: "android", select: (options: { android?: unknown }) => options.android },
  useWindowDimensions: () => ({ width: 400, height: 800 }),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaInsetsContext: createContext(null),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("@react-navigation/native", () => ({
  useIsFocused: () => true,
  useNavigation: () => ({ canGoBack: () => false, goBack: () => {}, dispatch: () => {} }),
  useFocusEffect: (effect: () => (() => void) | undefined) => useEffect(effect, [effect]),
}));
vi.mock("../../state/preferences", async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return { mobilePreferencesAtom: Atom.make(AsyncResult.initial()) };
});
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAndroidFloatingTabs: () => false,
}));
vi.mock("./navigation-tabs", () => ({
  useEnabledNavigationTabs: () => ["threads", "pullRequests", "usage"],
}));
vi.mock("../layout/AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({ layout: { usesSplitView: false }, startNewTask: () => {} }),
}));
vi.mock("../../components/ui/useAndroidControlSizing", () => ({
  useAndroidControlSizing: () => ({ fabClearance: 0, scale: 1, fabSize: 56 }),
}));
vi.mock("../../native/StackHeader", () => ({ NativeStackScreenOptions: () => null }));
vi.mock("../../components/ui/AndroidScreenHeader", () => ({ AndroidScreenHeader: () => null }));
vi.mock("../../components/ui/EmptyState", () => ({ EmptyState: () => null }));
vi.mock("../../components/ui/ScreenContent", () => ({ ScreenContent: () => null }));
vi.mock("./WorkspaceNoTabs", () => ({ WorkspaceNoTabs: () => null }));
vi.mock("./WorkspaceExtraTab", () => ({ WorkspaceExtraTab: () => <p>Usage list</p> }));
vi.mock("../home/HomeRouteScreen", () => ({ HomeRouteScreen: () => <p>Threads list</p> }));
vi.mock("../pull-requests/PullRequestsScreen", () => ({
  PullRequestsScreen: () => <p>Pull requests list</p>,
}));
vi.mock("../pull-requests/PullRequestToolbar.android", () => ({ PullRequestToolbar: () => null }));
vi.mock("./AndroidWorkspaceNavigation", async () => {
  const { useWorkspaceTabs } = await import("./WorkspaceTabsContext");
  function Tabs() {
    const workspace = useWorkspaceTabs()!;
    return (
      <>
        {(["threads", "pullRequests", "usage"] as const).map((tab) => (
          <button key={tab} onClick={() => workspace.dispatch({ type: "select", tab })}>
            {tab}
          </button>
        ))}
        <button onClick={() => workspace.dispatch({ type: "search" })}>search</button>
      </>
    );
  }
  return { AndroidWorkspaceNavigation: Tabs, FloatingWorkspaceTabs: Tabs };
});

import { WorkspaceRootScreen } from "./WorkspaceRootScreen.android";
import { WorkspaceTabsProvider } from "./WorkspaceTabsContext";

function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  backListeners.length = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <WorkspaceTabsProvider>
        <WorkspaceRootScreen />
      </WorkspaceTabsProvider>,
    ),
  );
  return {
    selectTab: (tab: string) =>
      act(() =>
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === tab)!
          .click(),
      ),
    /** Whether the app stays open, as React Native decides it. */
    pressBack: () => {
      let consumed = false;
      act(() => {
        consumed = backListeners.toReversed().some((listener) => listener() === true);
      });
      return consumed;
    },
    visibleLists: () =>
      [...container.querySelectorAll("p")]
        .filter((list) => list.closest('[style*="display: none"]') === null)
        .map((list) => list.textContent),
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

it.each([
  ["pullRequests", "Pull requests list"],
  ["usage", "Usage list"],
])("Back from the %s tab returns to Threads instead of leaving the app", (tab, list) => {
  using screen = setup();
  screen.selectTab(tab);
  expect(screen.visibleLists()).toEqual([list]);

  expect(screen.pressBack(), "Back left the app").toBe(true);
  expect(screen.visibleLists()).toEqual(["Threads list"]);

  expect(screen.pressBack(), "Back from Threads leaves the app").toBe(false);
});

it("Back with pull request search open is left to the search", () => {
  using screen = setup();
  screen.selectTab("pullRequests");
  screen.selectTab("search");

  expect(screen.pressBack()).toBe(false);
  expect(screen.visibleLists()).toEqual(["Pull requests list"]);
});
