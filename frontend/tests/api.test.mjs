import test from "node:test";
import assert from "node:assert/strict";
import { createApi, messageOf } from "../src/server/api.mjs";

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
