import test from "node:test";
import assert from "node:assert/strict";
import { createApi, messageOf } from "../src/server/api.mjs";
import { createApiLocation } from "../src/server/urls.mjs";

const ok = (data) => ({ ok: true, json: async () => data });
test("commands attach credentials, CSRF, actor and reuse the key after a lost response", async () => {
  const calls = [];
  const api = createApi(async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith("snapshot/")) return ok({ csrf: "csrf-token" });
    if (calls.length === 2) throw new TypeError("connection lost");
    return ok({ result: { id: "receipt" } });
  });
  await api.request("snapshot/");
  await api.command({ type: "wallet-topup", amount: 100 }, "alice");
  assert.equal(calls.length, 3);
  assert.equal(calls[1][1].credentials, "same-origin");
  assert.equal(calls[1][1].headers["X-CSRFToken"], "csrf-token");
  assert.equal(calls[1][1].headers["X-Store-User"], "alice");
  assert.equal(calls[1][1].headers["Idempotency-Key"], calls[2][1].headers["Idempotency-Key"]);
});
test("concurrent identical clicks share one server operation", async () => {
  let release;
  let count = 0;
  const api = createApi(() => { count++; return new Promise(resolve => { release = () => resolve(ok({ result: {} })); }); });
  const action = { type: "wallet-topup", amount: 50 };
  const a = api.command(action, "alice"), b = api.command(action, "alice");
  assert.equal(a, b);
  release();
  await a;
  assert.equal(count, 1);
});
test("ambiguous failure keeps its key for the next user retry", async () => {
  const keys = [];
  let online = false;
  const api = createApi(async (_url, options) => {
    keys.push(options.headers["Idempotency-Key"]);
    if (!online) throw Error("network");
    return ok({ result: {} });
  });
  const action = { type: "wallet-topup", amount: 50 };
  await assert.rejects(api.command(action, "alice"));
  online = true;
  await api.command(action, "alice");
  assert.equal(new Set(keys).size, 1);
});
test("server validation errors are shown and never retried automatically", async () => {
  let count = 0;
  const api = createApi(async () => { count++; return { ok: false, status: 400, json: async () => ["Недостаточно средств."] }; });
  await assert.rejects(api.command({ type: "checkout" }, "alice"), /Недостаточно средств/);
  assert.equal(count, 1);
  assert.equal(messageOf({ password: ["Слишком короткий."] }), "Слишком короткий.");
});

test("separate API origin uses credentials and the backend CSRF, never the frontend cookie", async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { cookie: "csrftoken=wrong-frontend-token" };
  const calls = [];
  try {
    const api = createApi(async (url, options) => {
      calls.push([url, options]);
      return ok({ csrf: "backend-token", result: {} });
    }, { baseUrl: "https://api.example.com/api/v1", origin: "https://store.example.com" });
    await api.request("snapshot/");
    await api.command({ type: "message", text: "hello" }, "alice");
    assert.equal(calls[1][0], "https://api.example.com/api/v1/studio/commands/");
    assert.equal(calls[1][1].credentials, "include");
    assert.equal(calls[1][1].headers["X-CSRFToken"], "backend-token");
    await api.request("../store/orders/123/refund/", { method: "POST", body: {} });
    assert.equal(calls[2][0], "https://api.example.com/api/v1/store/orders/123/refund/");
    await assert.rejects(api.request("https://evil.example/collect", { method: "POST", body: {} }), /запрещён/);
    assert.equal(calls.length, 3, "No credentials sent outside the configured API");
  } finally { globalThis.document = oldDocument; }
});

test("media uses the API host, while bundled artwork and inline avatars keep their URLs", () => {
  const location = createApiLocation("https://api.example.com/api/v1/", "https://store.example.com");
  assert.equal(location.media("/media/a.jpg"), "https://api.example.com/media/a.jpg");
  for (const path of ["/art/a.jpg", "data:image/png;base64,abc", "https://cdn.example.com/a.jpg", undefined])
    assert.equal(location.media(path), path);
  assert.equal(location.endpoint("mods/123/download/"), "https://api.example.com/api/v1/studio/mods/123/download/");
  assert.throws(() => location.endpoint("../../../outside/"), /запрещён/);
});

test("local API remains relative and malformed API settings fail early", () => {
  const location = createApiLocation("/api/v1/", "http://localhost:5173");
  assert.equal(location.crossOrigin, false);
  assert.equal(location.endpoint("snapshot/"), "/api/v1/studio/snapshot/");
  assert.equal(location.media("/media/a.jpg"), "/media/a.jpg");
  for (const base of ["ftp://host/api/", "https://user:pass@host/api/", "https://host/api/?secret=x", "https://host/api/#hash"])
    assert.throws(() => createApiLocation(base, "https://store.example.com"));
});
