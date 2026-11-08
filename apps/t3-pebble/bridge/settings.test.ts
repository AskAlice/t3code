import { expect, test } from "vite-plus/test";
import settings from "../src/pkjs/settings.js";
import { installStorage } from "./xhr-shim.ts";

const prefix = "data:text/html;charset=utf-8,";
const body = (response: unknown) => encodeURIComponent(JSON.stringify(response));

test("offers operator access by default plus remove-key and unpair controls", () => {
  const saved = installStorage({ mcpUrl: "https://mac.example", mcpToken: "token" });
  try {
    const html = decodeURIComponent(settings().slice(prefix.length));
    expect(html).toContain('id="access"');
    expect(html).toContain('<option value="read-only">');
    expect(html).toContain('<option value="auto" selected>');
    expect(html).toContain('<option value="full-access">');
    expect(html).toContain('id="unpair"');
    expect(html).toContain('id="clearKey"');
    expect(settings.parse(body({ url: "  ", key: "  ", clearKey: true, unpair: true }))).toEqual({
      url: "",
      key: "",
      access: "auto",
      clearKey: true,
      unpair: true,
    });
    expect(settings.parse(body({ access: "read-only" })).access).toBe("read-only");
    expect(settings.parse(body({ access: "full-access" })).access).toBe("full-access");
    expect(settings.parse(body({ access: "operator" })).access).toBe("auto");
    expect(settings.parse(body({ clearKey: "yes" })).clearKey).toBe(false);
    expect(settings.parse("")).toBeNull();
  } finally {
    saved.restore();
  }
});
