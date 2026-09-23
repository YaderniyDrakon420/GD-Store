import test from "node:test";
import assert from "node:assert/strict";
import { seed, transition, load, STORAGE_KEY } from "../src/demo/model.mjs";
const run = (s, a) => transition(s, { id: crypto.randomUUID(), ...a });
test("first launch and damaged storage recover to a usable demo", () => {
  assert.equal(load({ getItem: () => null }).active, "karim");
  assert.equal(load({ getItem: () => "{" }).users.length, 5);
});
test("wishlist toggles without changing catalog or other profiles", () => {
  const s = seed();
  const n = run(s, { type: "wishlist", game: "ashen" });
  assert.deepEqual(s.wishlist.karim, ["echoes"]);
  assert.ok(n.wishlist.karim.includes("ashen"));
  assert.ok(
    !run(n, { type: "wishlist", game: "ashen" }).wishlist.karim.includes(
      "ashen",
    ),
  );
});
test("checkout creates one local order and grants library entries without payments", () => {
  let s = run(seed(), { type: "cart", game: "echoes" });
  s = run(s, { type: "checkout" });
  assert.equal(s.orders.length, 1);
  assert.equal(s.orders[0].total, 200);
  assert.ok(s.library.karim.includes("echoes"));
  assert.equal(s.cart.karim.length, 0);
  assert.throws(() => run(s, { type: "checkout" }));
});
test("friend request requires recipient acceptance before chat", () => {
  let s = run(seed(), { type: "request", user: "danya" });
  const f = s.friends.find((f) => f.to === "danya");
  assert.throws(() => run(s, { type: "accept", friend: f.id }));
  assert.throws(() =>
    run(s, { type: "message", user: "danya", text: "Hello" }),
  );
  s = run(s, { type: "switch", user: "danya" });
  s = run(s, { type: "accept", friend: f.id });
  s = run(s, { type: "message", user: "karim", text: "Привет!" });
  assert.equal(s.messages.at(-1).to, "karim");
  assert.equal(s.messages.at(-1).from, "danya");
});
test("blocking prevents messages and blocked user cannot undo block", () => {
  let s = run(seed(), { type: "block", user: "nova" });
  s = run(s, { type: "switch", user: "nova" });
  assert.throws(() => run(s, { type: "message", user: "karim", text: "Hi" }));
  assert.throws(() => run(s, { type: "unfriend", friend: "f1" }));
  s = run(s, { type: "switch", user: "karim" });
  s = run(s, { type: "unfriend", friend: "f1" });
  assert.equal(
    s.friends.some((f) => f.id === "f1"),
    false,
  );
});
test("local registration validates uniqueness and never stores passwords", () => {
  assert.throws(() =>
    run(seed(), { type: "register", name: "Player", handle: "karim" }),
  );
  assert.throws(() =>
    run(seed(), { type: "register", name: "Player", handle: "a" }),
  );
  const s = run(seed(), {
    type: "register",
    name: "Player",
    handle: "player22",
  });
  assert.equal(s.users.at(-1).name, "Player");
  assert.equal("password" in s.users.at(-1), false);
  assert.equal(s.active, s.users.at(-1).id);
});
test("profile edit remains isolated and supports local cover and avatar", () => {
  const s = run(seed(), {
    type: "profile",
    name: "New Karim",
    bio: "Bio",
    country: "UA",
    color: "#49dcc8",
    status: "online",
    cover: "ashen",
    avatar: "data:image/png;base64,AA==",
  });
  assert.equal(s.users[0].name, "New Karim");
  assert.equal(s.users[0].cover, "ashen");
  assert.equal(s.users[1].name, "Nova");
});
test("topics and replies persist with authors and users cannot delete another topic", () => {
  let s = run(seed(), {
    type: "topic",
    title: "Test",
    body: "Body",
    game: "orbital",
  });
  const t = s.topics[0];
  s = run(s, { type: "reply", topic: t.id, text: "Reply" });
  assert.equal(s.topics[0].replies[0].author, "karim");
  s = run(s, { type: "switch", user: "nova" });
  assert.ok(
    run(s, { type: "delete-topic", topic: t.id }).topics.some(
      (x) => x.id === t.id,
    ),
  );
});
test("workshop saves metadata and subscriptions independently", () => {
  let s = run(seed(), {
    type: "mod",
    title: "Sky",
    description: "Sky mod",
    game: "orbital",
    category: "Визуал",
    version: "1.0",
    fileName: "sky.zip",
  });
  const mod = s.mods[0];
  assert.equal(mod.fileName, "sky.zip");
  s = run(s, { type: "subscribe", mod: mod.id });
  assert.ok(s.subscriptions.karim.includes(mod.id));
  assert.equal(
    run(s, { type: "subscribe", mod: mod.id }).subscriptions.karim.length,
    0,
  );
});
test("reviews require ownership and update a single own review", () => {
  assert.throws(() =>
    run(seed(), {
      type: "review",
      game: "echoes",
      text: "Good",
      positive: true,
    }),
  );
  let s = run(seed(), {
    type: "review",
    game: "orbital",
    text: "Good",
    positive: true,
  });
  s = run(s, {
    type: "review",
    game: "orbital",
    text: "Updated",
    positive: false,
  });
  assert.equal(s.reviews.length, 1);
  assert.equal(s.reviews[0].text, "Updated");
});
test("logged-out mutations fail without changing data", () => {
  const s = run(seed(), { type: "switch", user: null });
  assert.throws(() => run(s, { type: "cart", game: "orbital" }));
  assert.throws(() => run(s, { type: "message", user: "nova", text: "Hi" }));
});
test("saved browser state round-trips", () => {
  const s = run(seed(), { type: "settings", values: { compact: true } });
  assert.deepEqual(
    load({ getItem: (k) => (k === STORAGE_KEY ? JSON.stringify(s) : null) }),
    s,
  );
});
