import { expect, test } from "vite-plus/test";
import * as NodeCrypto from "node:crypto";
import { pair } from "../src/pkjs/pairing.js";
import { json, serve } from "./http-server.ts";
import { installXhr } from "./xhr-shim.ts";

test("exchanges the pairing code using a verified PKCE authorization", async () => {
  for (const [access, expected] of [
    [undefined, "auto"],
    ["read-only", "read-only"],
    ["full-access", "full-access"],
  ] as const) {
    const restore = installXhr();
    let challenge = "",
      state = "",
      verifier = "",
      decisionAccess = "";
    const upstream = await serve(async (request) => {
      const path = request.path;
      if (path === "/oauth/mcp/register") return json({ client_id: "client" });
      if (path === "/oauth/mcp/decision") {
        const body = await request.json<{
          decision: { access: string };
          authorization: { code_challenge: string; state: string };
        }>();
        decisionAccess = body.decision.access;
        expect(body.decision).toMatchObject({ _tag: "pairing-code", code: "pair-code" });
        expect(body.authorization).toMatchObject({
          redirect_uri: "http://127.0.0.1/callback",
          resource: `http://127.0.0.1:${upstream.port}/mcp`,
        });
        challenge = body.authorization.code_challenge;
        state = body.authorization.state;
        return json({
          redirectTo: `http://127.0.0.1/callback?code=approved&state=${state}`,
        });
      }
      const body = new URLSearchParams(await request.text());
      verifier = body.get("code_verifier")!;
      expect(NodeCrypto.createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
      expect(body.get("code")).toBe("approved");
      return json({ access_token: "mcp-token" });
    });
    try {
      const token = await new Promise<string | null>((resolve, reject) => {
        const done = (error: Error | null, value: string) =>
          error ? reject(error) : resolve(value);
        if (access) pair(`http://127.0.0.1:${upstream.port}`, "pair-code", access, done);
        else pair(`http://127.0.0.1:${upstream.port}`, "pair-code", done);
      });
      expect(token).toBe("mcp-token");
      expect(verifier).not.toBe("");
      expect(decisionAccess).toBe(expected);
    } finally {
      upstream.stop();
      restore();
    }
  }
});

test("rejects an access level the daemon does not offer", async () => {
  for (const access of ["admin", "toString", "__proto__"]) {
    const error = await new Promise<Error | null>((resolve) => {
      pair("http://127.0.0.1:1", "pair-code", access, (rejected: Error | null) =>
        resolve(rejected),
      );
    });
    expect(error?.message).toBe("Invalid pairing access");
  }
});
