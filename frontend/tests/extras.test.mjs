import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  transition,
  load,
  STORAGE_KEY,
  games,
} from "../src/demo/model.mjs";
import {
  upgrade,
  checkoutQuote,
  canSee,
  pickGames,
  validateDemoCard,
} from "../src/demo/extras.mjs";
const run = (s, a) => transition(s, { id: crypto.randomUUID(), ...a });
test("existing browser data migrates without losing messages or profiles", () => {
  const old = seed();
  old.users = old.users.map(({ role: _role, banned: _banned, ...u }) => u);
  delete old.adminLog;
  delete old.comparison;
  delete old.announcement;
  const s = load({
    getItem: (key) => (key === STORAGE_KEY ? JSON.stringify(old) : null),
  });
  assert.equal(s.version, 4);
  assert.equal(s.users[0].role, "admin");
  assert.deepEqual(s.messages, old.messages);
  assert.deepEqual(s.comparison, {});
});
test("ordinary profiles cannot invoke any moderation operation", () => {
  const s = run(seed(), { type: "switch", user: "nova" });
  for (const a of [
    { type: "admin-ban", user: "mika", reason: "Spam" },
    { type: "admin-unban", user: "mika" },
    {
      type: "admin-moderate",
      collection: "topics",
      item: "t1",
      field: "hidden",
    },
    { type: "admin-announcement", text: "Hi", enabled: true },
  ])
    assert.throws(() => run(s, a), /администратору/);
});
test("admin cannot ban self and must provide a reason", () => {
  assert.throws(() =>
    run(seed(), { type: "admin-ban", user: "karim", reason: "Test" }),
  );
  assert.throws(() =>
    run(seed(), { type: "admin-ban", user: "nova", reason: " " }),
  );
});
test("site ban blocks publishing, messaging and purchase, unban restores access", () => {
  let s = run(seed(), { type: "admin-ban", user: "nova", reason: "Спам" });
  assert.equal(s.adminLog.length, 1);
  s = run(s, { type: "switch", user: "nova" });
  for (const a of [
    { type: "message", user: "karim", text: "Hi" },
    { type: "topic", title: "t", body: "b", game: "orbital" },
    { type: "cart", game: "echoes" },
    { type: "checkout" },
    { type: "profile", name: "N" },
  ])
    assert.throws(() => run(s, a), /заблокирован/);
  s = run(s, { type: "switch", user: "karim" });
  assert.throws(
    () => run(s, { type: "message", user: "nova", text: "Hi" }),
    /заблокирован/,
  );
  s = run(s, { type: "admin-unban", user: "nova" });
  s = run(s, { type: "switch", user: "nova" });
  s = run(s, { type: "message", user: "karim", text: "Hello" });
  assert.equal(s.messages.at(-1).text, "Hello");
});
test("hidden content is visible only to demo admin and locked topics reject replies", () => {
  let s = run(seed(), {
    type: "admin-moderate",
    collection: "topics",
    item: "t1",
    field: "hidden",
  });
  assert.equal(canSee(s.topics[0], s.users[0]), true);
  assert.equal(canSee(s.topics[0], s.users[1]), false);
  assert.equal(canSee(s.topics[0], null), false);
  s = run(s, { type: "switch", user: "nova" });
  assert.throws(() => run(s, { type: "reply", topic: "t1", text: "Hi" }));
  assert.throws(() =>
    run(s, {
      type: "edit-topic",
      topic: "t1",
      title: "New",
      body: "Hi",
      game: "orbital",
    }),
  );
  s = run(s, { type: "switch", user: "karim" });
  s = run(s, {
    type: "admin-moderate",
    collection: "topics",
    item: "t1",
    field: "hidden",
  });
  s = run(s, {
    type: "admin-moderate",
    collection: "topics",
    item: "t1",
    field: "locked",
  });
  assert.throws(() => run(s, { type: "reply", topic: "t1", text: "Hi" }));
});
test("announcements can be enabled and disabled with audit entries", () => {
  let s = run(seed(), {
    type: "admin-announcement",
    text: "Вечер игр",
    enabled: true,
  });
  assert.equal(s.announcement.text, "Вечер игр");
  s = run(s, { type: "admin-announcement", enabled: false, text: "Вечер игр" });
  assert.equal(s.announcement.enabled, false);
  assert.equal(s.adminLog.length, 2);
});
test("gift checkout applies promo and grants only recipient library without card data", () => {
  let s = run(seed(), { type: "cart", game: "echoes" });
  const q = checkoutQuote(s, { recipient: "nova", promo: "play10" }, games);
  assert.equal(q.subtotal, 200);
  assert.equal(q.discount, 20);
  assert.equal(q.total, 180);
  s = run(s, {
    type: "checkout",
    recipient: "nova",
    promo: "PLAY10",
    method: "card",
    card: { number: "4242424242424242", cvc: "123" },
  });
  assert.equal(s.orders[0].total, 180);
  assert.equal(s.orders[0].recipient, "nova");
  assert.ok(s.library.nova.includes("echoes"));
  assert.ok(!s.library.karim.includes("echoes"));
  assert.equal(JSON.stringify(s).includes("4242424242424242"), false);
  assert.equal("card" in s.orders[0], false);
  assert.throws(() => run(s, { type: "checkout" }));
});
test("checkout rejects unknown promos, nonfriends and already-owned games", () => {
  let s = run(seed(), { type: "cart", game: "echoes" });
  assert.throws(() => checkoutQuote(s, { promo: "BAD" }, games));
  assert.throws(() => checkoutQuote(s, { recipient: "danya" }, games));
  s = run(s, { type: "cart", game: "orbital" });
  assert.throws(() => checkoutQuote(s, {}, games), /библиотеке/);
});
test("demo card validates only test data", () => {
  const card = {
    number: "4242 4242 4242 4242",
    name: "TEST",
    expiry: "12/30",
    cvc: "123",
  };
  assert.equal(validateDemoCard(card), "");
  assert.ok(validateDemoCard({ ...card, number: "4111111111111111" }));
  assert.ok(validateDemoCard({ ...card, cvc: "999" }));
});
test("comparison has a three-game limit and stays isolated by profile", () => {
  let s = seed();
  for (const game of ["orbital", "ashen", "velocity"])
    s = run(s, { type: "compare", game });
  assert.throws(() => run(s, { type: "compare", game: "echoes" }));
  s = run(s, { type: "compare", game: "orbital" });
  assert.equal(s.comparison.karim.length, 2);
  s = run(s, { type: "switch", user: "nova" });
  assert.equal(s.comparison.nova, undefined);
  s = run(s, { type: "compare", game: "echoes" });
  assert.deepEqual(s.comparison.nova, ["echoes"]);
  assert.equal(s.comparison.karim.length, 2);
});
test("game picker respects budget, mood and owned games", () => {
  const result = pickGames(games, { mood: "together", budget: 0, owned: [] });
  assert.deepEqual(
    result.map((g) => g.id),
    ["nightshift"],
  );
  assert.equal(
    pickGames(games, { mood: "together", budget: 0, owned: ["nightshift"] })
      .length,
    0,
  );
  assert.equal(upgrade(seed()).version, 4);
});
