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
const splitApi = process.argv.includes("--split-api");
const frontendRoot = splitApi ? "http://127.0.0.1:5174" : apiRoot;
if (splitApi) process.env.VITE_API_BASE_URL = apiRoot + "/api/v1/";
const backend = spawn(process.env.PYTHON || "python", [
  fileURLToPath(new URL("../tests/fixtures/api_server.py", import.meta.url)), String(port),
], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GD_TEST_FRONTEND_ORIGIN: frontendRoot } });
let backendLog = "";
backend.stdout.on("data", data => { backendLog += data; });
backend.stderr.on("data", data => { backendLog += data; });
backend.on("error", error => { backendLog += error.message; });
const dom = new JSDOM('<div id="root"></div>', { url: frontendRoot });
for (const key of ["window", "document", "sessionStorage", "localStorage", "location", "Event", "MouseEvent"])
  globalThis[key] = dom.window[key];
globalThis.dispatchEvent = window.dispatchEvent.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
const nativeFetch = globalThis.fetch;
const cookies = new Map();
const topupRequests = [];
globalThis.fetch = async (path, options = {}) => {
  const url = new URL(path, apiRoot);
  assert.equal(url.origin, apiRoot, "Integration requests must stay on the isolated server");
  if (url.pathname.endsWith("/studio/commands/") && options.body) {
    const body = JSON.parse(options.body);
    if (body.type === "wallet-topup") topupRequests.push(body);
  }
  const headers = new Headers(options.headers);
  if (splitApi) headers.set("Origin", frontendRoot);
  if (cookies.size) headers.set("Cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
  const response = await nativeFetch(url, { ...options, headers });
  if (splitApi) assert.equal(response.headers.get("Access-Control-Allow-Origin"), frontendRoot);
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
    if (!splitApi && !/httponly/i.test(cookie)) document.cookie = pair + "; path=/";
  }
  return response;
};
async function json(path, body, extraHeaders = {}, method = "POST") {
  const response = await fetch("/api/v1/" + path, body ? {
    method, headers: { "Content-Type": "application/json", "X-CSRFToken": cookies.get("csrftoken") || "", ...extraHeaders },
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
  assert.deepEqual(snapshot.games.map(g => g.id), ["gta-v", "gta-vi", "cs2", "dota2"]);
  const bob = snapshot.state.users.find(u => u.handle === "bob").id;
  assert.equal(snapshot.state.users.find(u => u.id === alice).status, "online");
  assert.equal(snapshot.state.users.find(u => u.id === bob).status, "offline");
  server = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  const { default: App } = await server.ssrLoadModule("/src/App.jsx");
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ["/wallet"] }, React.createElement(App))));
  await until(() => document.querySelector(".wallet-layout form"), "Wallet form did not load");
  const walletForm = document.querySelector(".wallet-layout form");
  const topupButton = () => button("Пополнить демобаланс");
  const fillCard = async (key, value) => {
    await act(async () => Simulate.change(document.querySelector(`[name="demo-${key}"]`), { target: { value } }));
  };
  assert.ok(topupButton().disabled, "Empty card must not allow topup");
  await act(async () => Simulate.submit(walletForm));
  assert.equal(topupRequests.length, 0);
  await act(async () => button("1000 ₴").click());
  await fillCard("number", "not-a-card");
  await fillCard("name", "DEMO NAME");
  await fillCard("expiry", "old-date");
  assert.ok(topupButton().disabled, "Missing CVC must not allow topup");
  await act(async () => Simulate.submit(walletForm));
  assert.equal(topupRequests.length, 0);
  await fillCard("cvc", "abc");
  await fillCard("name", "   ");
  assert.ok(topupButton().disabled, "Whitespace is not a filled field");
  await fillCard("name", "DEMO NAME");
  assert.ok(!topupButton().disabled, "Arbitrary filled demo details must be accepted");
  await act(async () => {
    Simulate.submit(walletForm);
    Simulate.submit(walletForm);
  });
  await until(() => document.querySelector('[name="demo-number"]').value === "", "Successful topup must clear demo details");
  assert.deepEqual(topupRequests, [{ type: "wallet-topup", amount: 1000 }], "Only one amount-only request may reach Django");
  for (const key of ["number", "name", "expiry", "cvc"])
    assert.equal(document.querySelector(`[name="demo-${key}"]`).value, "");
  assert.ok(topupButton().disabled);
  snapshot = await json("studio/snapshot/");
  assert.equal(snapshot.state.users.find(u => u.id === alice).wallet, 1000);
  assert.equal(snapshot.state.users.find(u => u.id === alice).points, 0);
  assert.equal(snapshot.state.walletLog.filter(row => row.user === alice).length, 1);
  console.log("ACTION OK wallet form: required fields, arbitrary demo data, no card transmission, one persisted credit");
  await act(async () => root.unmount());
  root = null;
  const routes = ["/", "/game/gta-v", "/profile", "/library", "/cart", "/checkout", "/orders", "/friends", "/messages/" + bob,
    "/settings", "/compare", "/discover", "/community", "/workshop", "/wallet", "/support", "/events", "/teammates", "/notifications", "/collections",
    "/inventory", "/progress", "/hub", "/hub/gta-v", "/products", "/security", "/account-action"];
  for (const route of routes) {
    root = createRoot(document.getElementById("root"));
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [route] }, React.createElement(App))));
    await until(() => document.querySelector("main"), "Route did not load: " + route);
    assert.ok(!document.body.textContent.includes("Сервер недоступен"), "Network failure: " + route);
    console.log("RENDER OK", route);
    if (route === "/game/gta-v") {
      assert.equal(document.querySelectorAll(".gallery-thumbs button").length, 3);
      const firstImage = document.querySelector(".gallery-main img").src;
      await act(async () => {
        assert.ok((await fetch(firstImage)).ok, "Screenshot must be served by Django");
      });
      await act(async () => document.querySelector('[aria-label="Следующий скриншот"]').click());
      assert.notEqual(document.querySelector(".gallery-main img").src, firstImage);
      await act(async () => document.querySelector('[aria-label="Увеличить скриншот"]').click());
      assert.ok(document.querySelector("dialog[open] .gallery-modal-image"));
      await act(async () => document.querySelector('dialog [aria-label="Закрыть"]').click());
      assert.equal(document.querySelector("dialog"), null);
      assert.ok(document.querySelector(".game-requirements").textContent.includes("8 GB RAM"));
      console.log("ACTION OK gallery, enlarged screenshot and server requirements");
      await act(async () => button("В корзину").click());
      await until(() => button("Убрать из корзины"), "Cart update did not render");
      snapshot = await json("studio/snapshot/");
      assert.deepEqual(snapshot.state.cart[alice], ["gta-v"]);
      console.log("ACTION OK persisted cart");
    }
    if (route === "/checkout") {
      await act(async () => button("Кошелёк ·").click());
      await until(() => document.querySelector(".pay-submit") && !document.querySelector(".pay-submit").disabled, "Checkout quote not ready");
      await act(async () => Simulate.submit(document.querySelector(".checkout-grid")));
      await until(() => document.querySelector(".payment-success"), "Server purchase did not finish");
      snapshot = await json("studio/snapshot/");
      assert.equal(snapshot.state.orders[0].status, "paid");
      assert.ok(snapshot.state.library[alice].includes("gta-v"));
      assert.equal(snapshot.state.users.find(u => u.id === alice).wallet, 401);
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
      await act(async () => Simulate.change(input, { target: { value: "Other note for search" } }));
      await act(async () => Simulate.submit(document.querySelector(".message-form")));
      await until(() => document.querySelector('[role="log"]')?.textContent.includes("Other note for search"), "Second message not persisted");
      const searchInput = document.querySelector('[aria-label="Поиск по переписке"]');
      await act(async () => Simulate.change(searchInput, { target: { value: "HELLO FROM" } }));
      assert.equal(document.querySelectorAll(".messages .message").length, 1);
      await act(async () => document.querySelector(".messages .message-pin").click());
      await until(() => document.querySelector(".messages .pinned-label"), "Pinned message did not update");
      await act(async () => Simulate.change(searchInput, { target: { value: "no matching text" } }));
      assert.equal(document.querySelectorAll(".messages .message").length, 0);
      await act(async () => button("Сбросить").click());
      await act(async () => button("Закреплённые (").click());
      assert.equal(document.querySelectorAll(".messages .message").length, 1);
      assert.ok(document.querySelector(".messages .message").textContent.includes("Hello from integrated UI"));
      console.log("ACTION OK case-insensitive chat search and persistent shared pin");
      console.log("ACTION OK new UI message visible through existing chat API");
    }
    await act(async () => root.unmount());
    root = null;
  }
  const command = body => json("studio/commands/", body, { "Idempotency-Key": crypto.randomUUID(), "X-Store-User": alice });
  for (const scenario of [
    { slugs: ["cs2", "dota2"], label: "Добавить бесплатно", total: 0, preorder: false },
    { slugs: ["gta-vi"], label: "Оформить учебный предзаказ", total: 2999, preorder: true },
  ]) {
    for (const game of scenario.slugs) await command({ type: "cart", game });
    root = createRoot(document.getElementById("root"));
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ["/checkout"] }, React.createElement(App))));
    await until(() => button("Быстрый демозаказ"), "Checkout not loaded");
    await act(async () => button("Быстрый демозаказ").click());
    await until(() => button(scenario.label) && !button(scenario.label).disabled, "Correct checkout label missing");
    await act(async () => Simulate.submit(document.querySelector(".checkout-grid")));
    await until(() => document.querySelector(".payment-success"), "New catalog purchase failed");
    assert.ok(document.body.textContent.includes(scenario.preorder ? "Предзаказ оформлен" : "Заказ оформлен"));
    snapshot = await json("studio/snapshot/");
    assert.equal(snapshot.state.orders[0].total, scenario.total);
    assert.deepEqual(snapshot.state.orders[0].preorders, scenario.preorder ? ["gta-vi"] : []);
    assert.equal(snapshot.state.users.find(u => u.id === alice).wallet, 401);
    for (const slug of scenario.slugs) assert.ok(snapshot.state.library[alice].includes(slug));
    console.log("ACTION OK", scenario.preorder ? "preorder receipt and reservation" : "free games without payment");
    await act(async () => root.unmount());
    root = null;
  }
  for (const route of ["/library", "/game/gta-vi", "/orders"]) {
    root = createRoot(document.getElementById("root"));
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [route] }, React.createElement(App))));
    await until(() => document.querySelector("main")?.textContent.includes("Предзаказ"), "Preorder marker missing: " + route);
    if (route === "/game/gta-vi") {
      await act(async () => button("Отзывы").click());
      assert.ok(document.body.textContent.includes("Отзывы станут доступны после релиза"));
      assert.equal(button("Сохранить отзыв"), undefined);
    }
    console.log("RENDER OK preorder", route);
    await act(async () => root.unmount());
    root = null;
  }
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ["/"] }, React.createElement(App))));
  await until(() => document.querySelector(".recently-viewed"), "Recent views did not persist across navigation");
  assert.ok(document.querySelector(".recently-viewed").textContent.includes("Grand Theft Auto VI"));
  await act(async () => button("Очистить историю").click());
  await until(() => !document.querySelector(".recently-viewed"), "History clear did not persist");
  snapshot = await json("studio/snapshot/");
  assert.deepEqual(snapshot.state.recentViews[alice], []);
  await act(async () => root.unmount());
  root = null;
  console.log("ACTION OK private recently viewed catalog and clear history");
  await json("studio/account/", { mode: "logout" });
  await json("studio/account/", { mode: "login", login: "owner", password: "Test-strong-pass-42" });
  await json("catalog/games/gta-vi/", { is_preorder: false }, {}, "PATCH");
  await json("catalog/games/gta-vi/", { title: "Grand Theft Auto VI" }, {}, "PATCH");
  await json("studio/account/", { mode: "logout" });
  await json("studio/account/", { mode: "login", login: "alice", password: "Test-strong-pass-42" });
  snapshot = await json("studio/snapshot/");
  assert.equal(snapshot.state.notifications.filter(n => n.category === "releases").length, 1);
  assert.ok(!snapshot.games.find(g => g.id === "gta-vi").isPreorder);
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ["/notifications"] }, React.createElement(App))));
  await until(() => button("предзаказ завершён"), "Release notification is missing from inbox");
  await act(async () => button("предзаказ завершён").click());
  await until(() => button("Отзывы"), "Release notification did not open the game");
  await act(async () => button("Отзывы").click());
  assert.ok(button("Сохранить отзыв"), "Released preorder must allow reviews");
  await act(async () => root.unmount());
  root = null;
  console.log("ACTION OK one release notification after admin publication and notification navigation");
  await json("studio/account/", { mode: "logout" });
  await json("studio/account/", { mode: "login", login: "bob", password: "Test-strong-pass-42" });
  snapshot = await json("studio/snapshot/");
  assert.ok(snapshot.state.messages.some(m => m.text === "Hello from integrated UI" && m.to === bob));
  assert.equal(snapshot.state.users.find(u => u.id === alice).status, "offline");
  assert.equal(snapshot.state.users.find(u => u.id === bob).status, "online");
  assert.ok(snapshot.state.messages.find(m => m.text === "Hello from integrated UI").pinned);
  assert.deepEqual(snapshot.state.recentViews, {});
  assert.equal(snapshot.state.orders.length, 0);
  console.log("ACTION OK second account receives message and cannot see buyer orders");
  console.log("ACTION OK server presence follows login/logout", splitApi ? "with separate API origin" : "with local API");

  // Exercise the new controls against Django, not a local transition mock.
  const renderFeature = async (route) => {
    if (root) await act(async () => root.unmount());
    root = createRoot(document.getElementById("root"));
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [route] }, React.createElement(App))));
    await until(() => document.querySelector("main"), "Feature not loaded: " + route);
  };
  const switchUser = async (login) => {
    if (root) { await act(async () => root.unmount()); root = null; }
    await json("studio/account/", { mode: "logout" });
    await json("studio/account/", { mode: "login", login, password: "Test-strong-pass-42" });
  };
  await renderFeature("/inventory");
  await act(async () => button("Обмены").click());
  await act(async () => Simulate.change(document.querySelector("main select"), { target: { value: alice } }));
  for (const fieldset of document.querySelectorAll("main fieldset"))
    await act(async () => Simulate.change(fieldset.querySelector('input[type="checkbox"]')));
  await act(async () => Simulate.submit(document.querySelector("main form")));
  await until(() => button("Подтвердить"), "Trade confirmation missing");
  await act(async () => button("Подтвердить").click());
  await until(() => document.body.textContent.includes("Ожидает ответа"), "Trade was not saved");
  snapshot = await json("studio/snapshot/");
  const tradeId = snapshot.state.trades[0].id;
  await switchUser("alice");
  await renderFeature("/inventory");
  await act(async () => button("Обмены").click());
  await act(async () => button("Принять").click());
  await act(async () => button("Подтвердить").click());
  await until(() => document.body.textContent.includes("Завершён"), "Trade acceptance missing");
  snapshot = await json("studio/snapshot/");
  assert.equal(snapshot.state.trades.find(t => t.id === tradeId).status, "accepted");
  console.log("ACTION OK inventory trade: item selection, recipient confirmation, both ownership changes");

  await act(async () => button("Мои предметы").click());
  await act(async () => button("Выставить на продажу").click());
  await act(async () => Simulate.submit(document.querySelector("dialog form")));
  await until(() => !document.querySelector("dialog"), "Market listing did not close");
  snapshot = await json("studio/snapshot/");
  const listingId = snapshot.state.market.find(l => l.status === "active").id;
  await switchUser("bob");
  await json("studio/commands/", { type: "wallet-topup", amount: 50 }, { "Idempotency-Key": crypto.randomUUID(), "X-Store-User": bob });
  await renderFeature("/inventory");
  await act(async () => button("Торговая площадка").click());
  await act(async () => button("Купить").click());
  await act(async () => button("Подтвердить").click());
  await until(() => document.body.textContent.includes("Куплено"), "Market purchase did not finish");
  snapshot = await json("studio/snapshot/");
  assert.equal(snapshot.state.market.find(l => l.id === listingId).status, "sold");
  assert.equal(snapshot.state.users.find(u => u.id === bob).wallet, 40);
  console.log("ACTION OK marketplace purchase and server ledger");

  await renderFeature("/hub/gta-v");
  await act(async () => button("Руководства").click());
  await act(async () => button("Опубликовать").click());
  await act(async () => Simulate.change(document.querySelector("dialog input"), { target: { value: "UI integration guide" } }));
  await act(async () => Simulate.change(document.querySelector("dialog textarea"), { target: { value: "An actual persisted guide body." } }));
  await act(async () => Simulate.submit(document.querySelector("dialog form")));
  await until(() => !document.querySelector("dialog") && document.body.textContent.includes("UI integration guide"), "Guide not persisted");
  snapshot = await json("studio/snapshot/");
  assert.ok(snapshot.state.users.find(u => u.id === bob).badges.some(b => b.code === "guide"));
  console.log("ACTION OK game hub publication and earned community badge");

  await switchUser("alice");
  await renderFeature("/products");
  const dlcCard = [...document.querySelectorAll("main article")].find(a => a.querySelector("h3").textContent.includes("учебное дополнение"));
  await act(async () => dlcCard.querySelector("button").click());
  await until(() => button("Подтвердить покупку"), "Product quote missing");
  await act(async () => button("Подтвердить покупку").click());
  await until(() => !document.querySelector("dialog"), "Product checkout not complete");
  snapshot = await json("studio/snapshot/");
  assert.ok(snapshot.state.licenses.some(l => l.product === "gd-learning-guide"));
  await renderFeature("/library");
  await until(() => document.body.textContent.includes("Мои издания и дополнения"), "License not rendered");
  console.log("ACTION OK DLC purchase, confirmed price and delivered library content");
  await renderFeature("/security");
  await until(() => document.body.textContent.includes("Этот сеанс"), "Current security session missing");
  assert.ok(document.body.textContent.includes("alice"));
  console.log("ACTION OK security page loads current browser session");
} finally {
  if (root) await act(async () => root.unmount());
  if (server) await server.close();
  dom.window.close();
  globalThis.fetch = nativeFetch;
  backend.kill();
}
