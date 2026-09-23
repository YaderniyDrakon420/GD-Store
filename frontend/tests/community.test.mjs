import test from "node:test";
import assert from "node:assert/strict";
import { seed, transition, load } from "../src/demo/model.mjs";
import { createCredential, verify, recoveryKey } from "../src/demo/auth.mjs";
let seq = 0;
const run = (s, a) => transition(s, a, "case-" + ++seq, "2026-09-08T15:00:00Z");
const report = {
  type: "report-create",
  kind: "message",
  user: "nova",
  message: "m1",
  reason: "Спам",
  details: "Проверка",
};
test("reports retain actual received message evidence and prevent duplicate pending reports", () => {
  const s = run(seed(), report);
  assert.equal(s.reports[0].evidence, seed().messages[0].text);
  assert.equal(s.reports[0].reporter, "karim");
  assert.throws(() => run(s, report));
  assert.throws(() => run(seed(), { ...report, message: "m2" }));
  assert.throws(() => run({ ...seed(), active: "alex" }, report));
});
test("player reports notify administrators and only administrators resolve them", () => {
  let s = run(
    { ...seed(), active: "nova" },
    { type: "report-create", kind: "player", user: "alex", reason: "Другое" },
  );
  assert.ok(
    s.notifications.some((n) => n.to === "karim" && n.url === "/admin"),
  );
  const action = {
    type: "admin-report-resolve",
    report: s.reports[0].id,
    status: "resolved",
    note: "Проверено",
  };
  assert.throws(() => run(s, action));
  s = run({ ...s, active: "karim" }, action);
  assert.equal(s.reports[0].status, "resolved");
  assert.equal(s.users.find((u) => u.id === "alex").banned, false);
  assert.ok(
    s.notifications.some(
      (n) => n.to === "nova" && n.title === "Жалоба рассмотрена",
    ),
  );
  assert.throws(() => run(s, action));
});
test("role delegation requires an administrator and protects primary admin", () => {
  const a = { type: "admin-role", user: "nova", role: "admin" };
  assert.throws(() => run({ ...seed(), active: "alex" }, a));
  let s = run(seed(), a);
  assert.equal(s.users.find((u) => u.id === "nova").role, "admin");
  assert.throws(() =>
    run({ ...s, active: "nova" }, { ...a, user: "karim", role: "player" }),
  );
  s = run(s, { ...a, role: "player" });
  assert.equal(s.users.find((u) => u.id === "nova").role, "player");
  assert.equal(s.adminLog.length, 2);
});
test("cosmetics debit points once, enforce ownership and allow removal", () => {
  let s = run(seed(), { type: "cosmetic-buy", item: "avatar-orbit" });
  assert.equal(s.users[0].points, 820);
  assert.throws(() => run(s, { type: "cosmetic-buy", item: "avatar-orbit" }));
  assert.throws(() =>
    run(s, { type: "cosmetic-equip", slot: "frame", item: "frame-gold" }),
  );
  s = run(s, { type: "cosmetic-equip", slot: "avatar", item: "avatar-orbit" });
  assert.equal(s.users[0].cosmeticAvatar, "avatar-orbit");
  s = run(s, { type: "cosmetic-equip", slot: "avatar", item: "" });
  assert.equal(s.users[0].cosmeticAvatar, "");
  assert.deepEqual(s.cosmeticsOwned.karim, ["avatar-orbit"]);
});
test("cosmetics reject insufficient balance and banned buyers", () => {
  const s = seed();
  s.users[0].points = 0;
  assert.throws(() => run(s, { type: "cosmetic-buy", item: "frame-gold" }));
  s.users[0].points = 1000;
  s.users[0].banned = true;
  assert.throws(() => run(s, { type: "cosmetic-buy", item: "frame-gold" }));
});
test("gift includes personal message and only its recipient acknowledges it", () => {
  let s = run(seed(), { type: "cart", game: "echoes" });
  s = run(s, {
    type: "checkout",
    recipient: "nova",
    giftMessage: "Хорошей игры!",
    method: "card",
  });
  const gift = s.gifts[0];
  assert.equal(gift.message, "Хорошей игры!");
  assert.equal(gift.opened, false);
  assert.ok(s.notifications.some((n) => n.to === "nova" && n.url === "/gifts"));
  assert.throws(() => run(s, { type: "gift-open", gift: gift.id }));
  s = run({ ...s, active: "nova" }, { type: "gift-open", gift: gift.id });
  assert.equal(s.gifts[0].opened, true);
  assert.ok(s.library.nova.includes("echoes"));
});
test("password and recovery verification stores only salted hashes; reset changes password", async () => {
  const recovery = recoveryKey();
  const auth = await createCredential("test-pass-999", recovery);
  assert.equal(await verify("wrong-pass", auth), false);
  assert.equal(await verify("test-pass-999", auth), true);
  assert.equal(await verify(recovery.toLowerCase(), auth, true), true);
  let s = run(seed(), {
    type: "auth-register",
    name: "Tester",
    handle: "tester",
    email: "tester@example.com",
    credential: auth,
  });
  const user = s.active;
  assert.ok(!JSON.stringify(s).includes("test-pass-999"));
  assert.ok(!JSON.stringify(s).includes(recovery));
  assert.throws(() => run(s, { type: "switch", user }));
  s = run(s, {
    type: "auth-reset",
    user,
    credential: await createCredential("replacement-999"),
  });
  const changed = s.users.find((u) => u.id === user).auth;
  assert.equal(await verify("test-pass-999", changed), false);
  assert.equal(await verify("replacement-999", changed), true);
  assert.equal(await verify(recovery, changed, true), true);
  assert.equal(s.active, null);
});
test("registration rejects duplicate email, invalid handles and short passwords", async () => {
  const credential = await createCredential("password-123", recoveryKey());
  const a = {
    type: "auth-register",
    name: "New",
    handle: "newplayer",
    email: "new@example.com",
    credential,
  };
  const s = run(seed(), a);
  assert.throws(() => run(s, { ...a, handle: "another" }));
  assert.throws(() => run(seed(), { ...a, handle: "??" }));
  await assert.rejects(() => createCredential("short"));
});
test("version three storage migrates gifts and preserves existing user data", () => {
  const s = seed();
  s.version = 3;
  delete s.gifts;
  delete s.reports;
  delete s.cosmeticsOwned;
  s.orders = [
    {
      id: "legacy",
      user: "karim",
      recipient: "nova",
      games: ["echoes"],
      at: "2026-09-08",
    },
  ];
  const migrated = load({ getItem: () => JSON.stringify(s) });
  assert.equal(migrated.version, 4);
  assert.equal(migrated.gifts[0].to, "nova");
  assert.deepEqual(migrated.reports, []);
  assert.equal(migrated.messages.length, s.messages.length);
});
