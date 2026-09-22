// Exercise the real React client against an isolated Django database.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";

const port = 19000 + Math.floor(Math.random() * 10000);
const apiRoot = `http://127.0.0.1:${port}`;
const backend = spawn(process.env.PYTHON || "python", [
  fileURLToPath(new URL("../tests/fixtures/api_server.py", import.meta.url)), String(port),
], { stdio: ["ignore", "pipe", "pipe"] });
let backendLog = "";
backend.stdout.on("data", data => { backendLog += data; });
backend.stderr.on("data", data => { backendLog += data; });
backend.on("error", error => { backendLog += error.message; });
const dom = new JSDOM('<div id="root"></div>', { url: apiRoot });
for (const key of ["window", "document", "sessionStorage", "localStorage", "location", "Event", "MouseEvent"])
  globalThis[key] = dom.window[key];
globalThis.dispatchEvent = window.dispatchEvent.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollIntoView = () => {};
const nativeFetch = globalThis.fetch;
const cookies = new Map();
globalThis.fetch = async (path, options = {}) => {
  const url = new URL(path, apiRoot);
  assert.equal(url.origin, apiRoot, "Integration requests must stay on the isolated server");
  const headers = new Headers(options.headers);
  if (cookies.size) headers.set("Cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
  const response = await nativeFetch(url, { ...options, headers });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
    if (!/httponly/i.test(cookie)) document.cookie = pair + "; path=/";
  }
  return response;
};
async function json(path, body, extraHeaders = {}) {
  const response = await fetch("/api/v1/" + path, body ? {
    method: "POST", headers: { "Content-Type": "application/json", "X-CSRFToken": cookies.get("csrftoken") || "", ...extraHeaders },
    body: JSON.stringify(body),
  } : undefined);
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await act(async () => sleep(50));
  }
  throw Error(label + ": " + document.body.textContent);
}
const button = text => [...document.querySelectorAll("button")].find(b => b.textContent.includes(text));
let server, root;
try {
  let ready = false;
  for (let i = 0; i < 600; i++) {
    try { const response = await nativeFetch(apiRoot + "/api/v1/catalog/games/"); ready = response.ok; } catch { /* starting */ }
    if (ready) break;
    if (backend.exitCode !== null) throw Error(backendLog);
    await sleep(100);
  }
  assert.ok(ready, "Django did not start: " + backendLog);
  await json("studio/snapshot/");
  await json("studio/account/", { mode: "login", login: "alice", password: "Test-strong-pass-42" });
  let snapshot = await json("studio/snapshot/");
  const alice = snapshot.state.active;
  assert.ok(alice, "Login did not establish a session");
  const bob = snapshot.state.users.find(u => u.handle === "bob").id;
  await json("studio/commands/", { type: "wallet-topup", amount: 1000 }, { "Idempotency-Key": crypto.randomUUID(), "X-Store-User": alice });
  server = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  const { default: App } = await server.ssrLoadModule("/src/App.jsx");
  const routes = ["/", "/game/orbital", "/profile", "/library", "/cart", "/checkout", "/orders", "/friends", "/messages/" + bob,
    "/settings", "/compare", "/discover", "/community", "/workshop", "/wallet", "/support", "/events", "/teammates", "/notifications", "/collections"];
  for (const route of routes) {
    root = createRoot(document.getElementById("root"));
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [route] }, React.createElement(App))));
    await until(() => document.querySelector("main"), "Route did not load: " + route);
    assert.ok(!document.body.textContent.includes("Сервер недоступен"), "Network failure: " + route);
    console.log("RENDER OK", route);
    if (route === "/game/orbital") {
      await act(async () => button("В корзину").click());
      await until(() => button("Убрать из корзины"), "Cart update did not render");
      snapshot = await json("studio/snapshot/");
      assert.deepEqual(snapshot.state.cart[alice], ["orbital"]);
      console.log("ACTION OK persisted cart");
    }
    if (route === "/checkout") {
      await act(async () => button("Кошелёк ·").click());
      await until(() => document.querySelector(".pay-submit") && !document.querySelector(".pay-submit").disabled, "Checkout quote not ready");
      await act(async () => Simulate.submit(document.querySelector(".checkout-grid")));
      await until(() => document.querySelector(".payment-success"), "Server purchase did not finish");
      snapshot = await json("studio/snapshot/");
      assert.equal(snapshot.state.orders[0].status, "paid");
      assert.ok(snapshot.state.library[alice].includes("orbital"));
      assert.equal(snapshot.state.users.find(u => u.id === alice).wallet, 415.65);
      console.log("ACTION OK educational purchase and wallet debit");
    }
    if (route.startsWith("/messages/")) {
      await until(() => document.querySelector('input[aria-label="Сообщение другу"]'), "Chat not ready");
      const input = document.querySelector('input[aria-label="Сообщение другу"]');
      await act(async () => Simulate.change(input, { target: { value: "Hello from integrated UI" } }));
      await act(async () => Simulate.submit(document.querySelector(".message-form")));
      await until(() => document.querySelector('[role="log"]')?.textContent.includes("Hello from integrated UI"), "Message not persisted");
      const conversations = await json("chat/conversations/");
      const messages = await json(`chat/conversations/${conversations.results[0].id}/messages/`);
      assert.equal(messages.results[0].text, "Hello from integrated UI");
      console.log("ACTION OK new UI message visible through existing chat API");
    }
    await act(async () => root.unmount());
    root = null;
  }
  await json("studio/account/", { mode: "logout" });
  await json("studio/account/", { mode: "login", login: "bob", password: "Test-strong-pass-42" });
  snapshot = await json("studio/snapshot/");
  assert.ok(snapshot.state.messages.some(m => m.text === "Hello from integrated UI" && m.to === bob));
  assert.equal(snapshot.state.orders.length, 0);
  console.log("ACTION OK second account receives message and cannot see buyer orders");
} finally {
  if (root) await act(async () => root.unmount());
  if (server) await server.close();
  dom.window.close();
  globalThis.fetch = nativeFetch;
  backend.kill();
}
