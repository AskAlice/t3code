import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { buildTraitsTriggerDisplay } from "./modelTraits.ts";

describe("buildTraitsTriggerDisplay", () => {
  it("labels a reasoning select with no current value or default as Default", () => {
    const display = buildTraitsTriggerDisplay({
      provider: ProviderDriverKind.make("pi"),
      descriptors: [
        {
          id: "thinking",
          label: "Thinking",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
            { id: "max", label: "Max" },
          ],
        },
      ],
      primarySelectDescriptorId: "thinking",
      ultrathinkPromptControlled: false,
    });

    expect(display.label).toBe("Default");
  });

  it("merges speed into the Default reasoning label and leaves other unset selects out", () => {
    const display = buildTraitsTriggerDisplay({
      provider: ProviderDriverKind.make("claudeAgent"),
      descriptors: [
        {
          id: "effort",
          label: "Effort",
          type: "select",
          options: [{ id: "high", label: "High" }],
        },
        {
          id: "contextWindow",
          label: "Context",
          type: "select",
          options: [{ id: "1m", label: "1M" }],
        },
        { id: "fastMode", label: "Fast", type: "boolean", currentValue: true },
      ],
      primarySelectDescriptorId: "effort",
      ultrathinkPromptControlled: false,
    });

    expect(display).toEqual({ label: "Default Fast", speedLabel: "Fast", otherLabels: [] });
  });
});
