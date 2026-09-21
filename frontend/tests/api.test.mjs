import test from "node:test";
import assert from "node:assert/strict";
const storage = new Map();
globalThis.sessionStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};
globalThis.location = { origin: "http://localhost" };
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
async function client() {
  return import(`../src/api/client.mjs?test=${Math.random()}`);
}
test("client sends access token and parses field errors", async () => {
  const c = await client();
  c.setTokens({ access: "access", refresh: "refresh" });
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer access");
    return response({ username: ["Already exists"] }, 400);
  };
  await assert.rejects(c.api("auth/me/"), /username: Already exists/);
});
test("concurrent unauthorized requests share one refresh", async () => {
  const c = await client();
  c.setTokens({ access: "old", refresh: "refresh" });
  let refreshes = 0;
  globalThis.fetch = async (url, options) => {
    if (url.pathname.endsWith("refresh/")) {
      refreshes++;
      await new Promise((r) => setTimeout(r, 10));
      return response({ access: "new", refresh: "rotated" });
    }
    return options.headers.Authorization === "Bearer new"
      ? response({ ok: true })
      : response({ detail: "expired" }, 401);
  };
  const values = await Promise.all([c.api("auth/me/"), c.api("store/orders/")]);
  assert.equal(refreshes, 1);
  assert.ok(values.every((v) => v.ok));
});
test("logout prevents an in-flight refresh from restoring a session", async () => {
  const c = await client();
  c.setTokens({ access: "old", refresh: "refresh" });
  let release, started;
  const ready = new Promise((r) => (started = r));
  globalThis.fetch = async (url) => {
    if (url.pathname.endsWith("refresh/")) {
      started();
      await new Promise((r) => (release = r));
      return response({ access: "new" });
    }
    return response({}, 401);
  };
  const pending = c.api("auth/me/");
  await ready;
  c.setTokens(null);
  release();
  await assert.rejects(pending, /Сессия изменилась/);
  assert.equal(c.hasSession(), false);
});
test("pagination rejects external links without leaking credentials", async () => {
  const c = await client();
  c.setTokens({ access: "secret" });
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return response({ results: [1], next: "https://other.example/private" });
  };
  await assert.rejects(c.all("catalog/games/"), /другой сервер/);
  assert.equal(requests, 1);
});
test("network errors do not become fake success", async () => {
  const c = await client();
  globalThis.fetch = async () => {
    throw Error("offline");
  };
  await assert.rejects(
    c.api("store/cart/", { method: "POST", body: { game: "id" } }),
    /Сервер недоступен/,
  );
});
test("pagination follows every page", async () => {
  const c = await client();
  globalThis.fetch = async (url) =>
    response(
      url.search
        ? { results: [2], next: null }
        : {
            results: [1],
            next: "http://localhost/api/v1/catalog/games/?page=2",
          },
    );
  assert.deepEqual(await c.all("catalog/games/"), [1, 2]);
});
