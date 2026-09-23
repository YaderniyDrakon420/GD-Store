import test from "node:test";
import assert from "node:assert/strict";
import { seed, transition, games, price } from "../src/demo/model.mjs";
import { upgrade } from "../src/demo/extras.mjs";
import { visibleSection } from "../src/demo/service.mjs";
const run = transition;
test("support hides tickets from other players and allows admin responses and reopening", () => {
  let s = run(
    { ...seed(), active: "nova" },
    {
      type: "ticket-create",
      title: "Заказ",
      text: "Помогите",
      category: "Покупка",
    },
  );
  const ticket = s.tickets[0].id;
  assert.throws(() =>
    run(
      { ...s, active: "alex" },
      { type: "ticket-reply", ticket, text: "Чужой" },
    ),
  );
  s = run(
    { ...s, active: "karim" },
    { type: "ticket-reply", ticket, text: "Проверяем" },
  );
  assert.equal(s.tickets[0].messages.length, 2);
  assert.ok(
    s.notifications.some(
      (n) => n.to === "nova" && n.title === "Ответ поддержки",
    ),
  );
  s = run(s, { type: "ticket-status", ticket, status: "resolved" });
  assert.throws(() =>
    run(
      { ...s, active: "nova" },
      { type: "ticket-reply", ticket, text: "Ответ" },
    ),
  );
  s = run(s, { type: "ticket-status", ticket, status: "open" });
  assert.equal(s.tickets[0].status, "open");
});
test("privacy respects owner and friendship; restricted requests fail", () => {
  let s = run(seed(), {
    type: "privacy-save",
    libraryPrivacy: "friends",
    activityPrivacy: "none",
    friendsPrivacy: "none",
    requestsPrivacy: "none",
    saleAlerts: true,
  });
  assert.equal(visibleSection(s, "karim", "karim", "activityPrivacy"), true);
  assert.equal(visibleSection(s, "karim", "nova", "libraryPrivacy"), true);
  assert.equal(visibleSection(s, "karim", "danya", "libraryPrivacy"), false);
  assert.equal(visibleSection(s, "karim", undefined, "friendsPrivacy"), false);
  assert.throws(() =>
    run({ ...s, active: "danya" }, { type: "request", user: "karim" }),
  );
});
test("review helpful votes toggle once and self votes fail", () => {
  let s = run(seed(), {
    type: "review",
    game: "orbital",
    positive: true,
    text: "Хорошая игра",
  });
  const review = s.reviews[0].id;
  assert.throws(() => run(s, { type: "review-vote", review }));
  s = run({ ...s, active: "nova" }, { type: "review-vote", review });
  assert.deepEqual(s.reviews[0].helpful, ["nova"]);
  s = run(s, { type: "review-vote", review });
  assert.deepEqual(s.reviews[0].helpful, []);
});
test("sale checks notify once on real price decrease and respect opt out", () => {
  let s = upgrade(seed());
  s.wishlist.karim = ["echoes"];
  s.saleWatch.karim = {
    echoes: price(games.find((g) => g.id === "echoes")) + 100,
  };
  s = run(s, { type: "sale-check" });
  assert.equal(
    s.notifications.filter((n) => n.title === "Игра из желаемого подешевела")
      .length,
    1,
  );
  s = run(s, { type: "sale-check" });
  assert.equal(
    s.notifications.filter((n) => n.title === "Игра из желаемого подешевела")
      .length,
    1,
  );
  s.settings.karim = { saleAlerts: false };
  const before = s.notifications.length;
  s = run(s, { type: "sale-demo", game: "echoes" });
  assert.equal(s.notifications.length, before);
});
test("points ledger reconciles rewards and spending with opening balance", () => {
  let s = run(seed(), { type: "cart", game: "echoes" });
  s = run(s, { type: "checkout" });
  s = run(s, { type: "cosmetic-buy", item: "frame-teal" });
  assert.equal(
    s.pointsLog
      .filter((r) => r.user === "karim")
      .reduce((sum, r) => sum + r.amount, 0),
    s.users[0].points,
  );
  const upgraded = upgrade(s);
  assert.equal(upgraded.pointsLog.length, s.pointsLog.length);
});
