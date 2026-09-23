import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { seed, games } from "../src/demo/model.mjs";
import { cosmetics } from "../src/demo/community.mjs";
test("all main routes render from a server snapshot fixture", async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const state = seed();
  state.events = [
    {
      id: "evening",
      host: "karim",
      invitees: ["nova"],
      rsvp: { nova: "invited" },
      title: "Вечер игр",
      game: "orbital",
      description: "План",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      cancelled: false,
    },
  ];
  state.collections = [
    {
      id: "favorites",
      owner: "karim",
      name: "Любимые",
      color: "teal",
      gameIds: ["orbital"],
    },
  ];

  state.cart.karim = ["echoes"];
  state.comparison.karim = ["orbital", "ashen"];
  const originalError = console.error;
  console.error = (message, ...args) => {
    if (
      typeof message === "string" &&
      message.startsWith("Warning: useLayoutEffect does nothing on the server")
    )
      return;
    originalError(message, ...args);
  };
  globalThis.localStorage = { getItem: () => JSON.stringify(state) };
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
          React.createElement(App, { initialSnapshot: { state, games, cosmetics } }),
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
