import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

test("anonymous routes render safely before API loading completes", async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const originalError = console.error;
  console.error = (message, ...args) => {
    if (
      typeof message === "string" &&
      message.startsWith("Warning: useLayoutEffect does nothing on the server")
    )
      return;
    originalError(message, ...args);
  };
  globalThis.localStorage = { getItem: () => null };
  try {
    const { default: App } = await server.ssrLoadModule("/src/App.jsx");
    for (const path of [
      "/",
      "/profile",
      "/profile/nova",
      "/library",
      "/wishlist",
      "/cart",
      "/game/orbital",
      "/friends",
      "/messages/nova",
      "/community",
      "/community/t1",
      "/workshop",
      "/workshop/w1",
      "/settings",
      "/login",
      "/register",
      "/forgot-password",
      "/gifts",
      "/points-shop",
      "/teammates",
      "/support",
      "/wallet",
      "/points-history",
      "/orders",
      "/admin",
      "/checkout",
      "/compare",
      "/discover",
      "/events",
      "/events/evening",
      "/collections",
      "/collections/favorites",
      "/notifications",
      "/missing",
    ]) {
      const html = renderToString(
        React.createElement(
          MemoryRouter,
          { initialEntries: [path] },
          React.createElement(App),
        ),
      );
      assert.ok(html.includes("GD"), "Route failed: " + path);
      assert.equal(
        html.includes("Страница не найдена"),
        path === "/missing",
        "Unexpected fallback: " + path,
      );
      assert.ok(!html.includes("undefined"), "Undefined text: " + path);
    }
  } finally {
    console.error = originalError;
    await server.close();
    delete globalThis.localStorage;
  }
});
