import { expect, test } from "vite-plus/test";
import mcp from "../src/pkjs/mcp.js";
import { json, serve, text } from "./http-server.ts";
import { installXhr } from "./xhr-shim.ts";

function run<T>(invoke: (callback: (error: Error | null, value: T) => void) => void) {
  return new Promise<T>((resolve, reject) =>
    invoke((error, value) => (error ? reject(error) : resolve(value))),
  );
}

test("initializes lazily, pages project metadata, and calls tools with session headers", async () => {
  const restore = installXhr();
  const calls: string[] = [];
  const projectCursors: unknown[] = [];
  const toolArguments: Record<string, unknown>[] = [];
  const seen: Record<string, string | null>[] = [];
  const upstream = await serve(async (request) => {
    const body = await request.json<any>();
    seen.push({
      authorization: request.headers.get("authorization"),
      session: request.headers.get("mcp-session-id"),
      protocol: request.headers.get("mcp-protocol-version"),
    });
    if (body.method === "notifications/initialized") return { status: 202 };
    calls.push(body.method === "tools/call" ? body.params.name : body.method);
    if (body.method === "tools/call") toolArguments.push(body.params.arguments);
    const result =
      body.method === "initialize"
        ? { protocolVersion: "2025-03-26" }
        : body.params.name === "t3_environment_read"
          ? { label: "Laptop" }
          : body.params.name === "t3_project_list"
            ? (() => {
                projectCursors.push(body.params.arguments.cursor);
                const cursor = body.params.arguments.cursor;
                return cursor === 0
                  ? { projects: [{ id: "a", workspaceRoot: "/code/a" }], nextCursor: 1 }
                  : { projects: [{ id: "b", workspaceRoot: "/code/b" }], nextCursor: null };
              })()
            : body.params.name === "t3_thread_list"
              ? {
                  threads: [
                    {
                      threadId: "1",
                      title: "Test",
                      projectId: "a",
                      providerInstanceId: "codex",
                      updatedAt: new Date(0).toISOString(),
                    },
                  ],
                  nextCursor: null,
                }
              : body.params.name === "t3_thread_read"
                ? body.params.arguments.limit === 1
                  ? { thread: { itemCount: 150 }, items: [] }
                  : { items: [{ type: "user_message", text: "hi" }] }
                : { runId: "run" };
    return json(
      { jsonrpc: "2.0", id: body.id, result },
      { headers: { "mcp-session-id": "session" } },
    );
  });
  try {
    mcp.configure({ origin: `http://127.0.0.1:${upstream.port}`, token: "mcp-test" });
    const page = await run<any>((callback) => mcp.threads(0, callback));
    expect(page.threads[0]).toMatchObject({
      title: "Test",
      machine: "Laptop",
      directory: "/code/a",
    });
    expect(projectCursors).toEqual([0, 1]);
    expect(calls.slice(0, 3)).toEqual(["initialize", "t3_thread_list", "t3_environment_read"]);
    expect(seen[0]).toMatchObject({
      authorization: "Bearer mcp-test",
      session: null,
      protocol: null,
    });
    expect(seen.at(-1)).toMatchObject({ session: "session", protocol: "2025-03-26" });

    await run<any>((callback) => mcp.threads(0, callback));
    expect(calls.filter((name) => name === "t3_environment_read")).toHaveLength(1);

    await run<any>((callback) => mcp.read("1", callback));
    expect(toolArguments.at(-2)).toMatchObject({ threadId: "1", limit: 1 });
    expect(toolArguments.at(-1)).toMatchObject({
      threadId: "1",
      afterPosition: 124,
      maxCharsPerItem: 4000,
      view: "activity",
    });

    await run<any>((callback) => mcp.send("1", "hello", callback));
    expect(toolArguments.at(-1)).toMatchObject({ threadId: "1", message: "hello", mode: "queue" });
  } finally {
    upstream.stop();
    restore();
  }
});

test("reads structured results from server-sent events", async () => {
  const restore = installXhr();
  const upstream = await serve(async (request) => {
    const body = await request.json<any>();
    if (body.method === "notifications/initialized") return { status: 202 };
    const result =
      body.method === "initialize"
        ? { protocolVersion: "2025-03-26" }
        : { structuredContent: { label: "Streamed" } };
    return text(`data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`, {
      headers: { "content-type": "text/event-stream", "mcp-session-id": "stream" },
    });
  });
  try {
    mcp.configure({ origin: `http://127.0.0.1:${upstream.port}`, token: "mcp-test" });
    const value = await run<any>((callback) => mcp.call("t3_environment_read", {}, callback));
    expect(value).toEqual({ label: "Streamed" });
  } finally {
    upstream.stop();
    restore();
  }
});

test("resets the session after an HTTP failure and initializes again", async () => {
  const restore = installXhr();
  let initializeCount = 0;
  let fail = true;
  const upstream = await serve(async (request) => {
    const body = await request.json<any>();
    if (body.method === "notifications/initialized") return { status: 202 };
    if (body.method === "initialize") {
      initializeCount++;
      return json(
        { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } },
        { headers: { "mcp-session-id": "session" } },
      );
    }
    if (fail) return text("failed", { status: 500 });
    return json({
      jsonrpc: "2.0",
      id: body.id,
      result: { structuredContent: { threads: [] } },
    });
  });
  try {
    mcp.configure({ origin: `http://127.0.0.1:${upstream.port}`, token: "mcp-test" });
    await expect(run<any>((callback) => mcp.threads(0, callback))).rejects.toThrow("HTTP 500");
    fail = false;
    await run<any>((callback) => mcp.threads(0, callback));
    expect(initializeCount).toBe(2);
  } finally {
    upstream.stop();
    restore();
  }
});

function gateClientResponses(prefix: string) {
  const Base = (globalThis as { XMLHttpRequest?: any }).XMLHttpRequest;
  const handlers: (() => void)[] = [];
  class Gated extends Base {
    send(body?: string | null) {
      const handler = (this as any).onload;
      if (String((this as any).url).startsWith(prefix))
        (this as any).onload = () => handlers.push(handler);
      super.send(body);
    }
  }
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = Gated;
  return () => {
    for (const handler of handlers.splice(0)) handler();
  };
}

test("reconfiguring cancels in-flight initialization and ignores the stale response", async () => {
  const restore = installXhr();
  let oldArrived!: () => void;
  const arrived = new Promise<void>((resolve) => (oldArrived = resolve));
  let oldNotifications = 0;
  const old = await serve(async (request) => {
    const body = await request.json<any>();
    if (body.method === "notifications/initialized") {
      oldNotifications++;
      return { status: 202 };
    }
    if (body.method === "initialize") oldArrived();
    return json(
      { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } },
      { headers: { "mcp-session-id": "stale-session" } },
    );
  });
  const currentSessions: (string | null)[] = [];
  const current = await serve(async (request) => {
    const body = await request.json<any>();
    if (body.method === "notifications/initialized") return { status: 202 };
    currentSessions.push(request.headers.get("mcp-session-id"));
    const result =
      body.method === "initialize"
        ? { protocolVersion: "2025-03-26" }
        : { structuredContent: { threads: [], nextCursor: null } };
    return json(
      { jsonrpc: "2.0", id: body.id, result },
      { headers: { "mcp-session-id": "current-session" } },
    );
  });
  const release = gateClientResponses(`http://127.0.0.1:${old.port}`);
  try {
    mcp.configure({ origin: `http://127.0.0.1:${old.port}`, token: "old" });
    const stale = run<any>((callback) => mcp.threads(0, callback)).catch((error: Error) => error);
    await arrived;
    mcp.configure({ origin: `http://127.0.0.1:${current.port}`, token: "current" });
    expect((await stale).message).toBe("MCP configuration changed");
    release();
    await run<any>((callback) => mcp.threads(0, callback));
    expect(currentSessions[0]).toBeNull();
    expect(currentSessions.slice(1).every((session) => session === "current-session")).toBe(true);
    expect(oldNotifications).toBe(0);
  } finally {
    old.stop();
    current.stop();
    restore();
  }
});

test("includes a zero cursor for a 26-item read and omits it below that", async () => {
  const restore = installXhr();
  let itemCount = 26;
  const readArguments: Record<string, unknown>[] = [];
  const upstream = await serve(async (request) => {
    const body = await request.json<any>();
    if (body.method === "notifications/initialized") return { status: 202 };
    if (body.method === "tools/call" && body.params.name === "t3_thread_read")
      readArguments.push(body.params.arguments);
    const result =
      body.method === "initialize"
        ? { protocolVersion: "2025-03-26" }
        : body.params.name === "t3_thread_read"
          ? body.params.arguments.limit === 1
            ? { thread: { itemCount }, items: [] }
            : { items: [] }
          : {};
    return json({ jsonrpc: "2.0", id: body.id, result });
  });
  try {
    mcp.configure({ origin: `http://127.0.0.1:${upstream.port}`, token: "mcp-test" });
    await run<any>((callback) => mcp.read("1", callback));
    expect(readArguments.at(-1)).toMatchObject({ afterPosition: 0, limit: 25 });
    itemCount = 25;
    await run<any>((callback) => mcp.read("1", callback));
    expect(readArguments.at(-1)).not.toHaveProperty("afterPosition");
  } finally {
    upstream.stop();
    restore();
  }
});
