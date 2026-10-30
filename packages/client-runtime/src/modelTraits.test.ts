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
});
