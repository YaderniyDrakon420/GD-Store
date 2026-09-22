import test from "node:test";
import assert from "node:assert/strict";
import { seed, transition } from "../src/demo/model.mjs";
import { purchasePoints } from "../src/demo/players.mjs";
let i = 0;
const run = (s, a) => transition(s, a, "p" + ++i, "2026-09-08T12:00:00Z");
const post = {
  type: "party-save",
  title: "Вечер",
  game: "orbital",
  language: "Русский",
  capacity: 2,
  startsAt: new Date(Date.now() + 86400000).toISOString(),
};
test("team capacity, duplicate joins and leaving are enforced", () => {
  let s = run(seed(), post);
  const party = s.parties[0].id;
  s = run({ ...s, active: "nova" }, { type: "party-join", party });
  assert.equal(s.parties[0].members.length, 2);
  assert.ok(
    s.notifications.some((n) => n.to === "karim" && n.url === "/teammates"),
  );
  assert.throws(() => run(s, { type: "party-join", party }));
  assert.throws(() =>
    run({ ...s, active: "alex" }, { type: "party-join", party }),
  );
  s = run(s, { type: "party-leave", party });
  assert.deepEqual(s.parties[0].members, ["karim"]);
});
test("only host edits and closes; closed or past teams reject joins", () => {
  let s = run(seed(), post);
  const party = s.parties[0].id;
  assert.throws(() => run({ ...s, active: "nova" }, { ...post, party }));
  assert.throws(() =>
    run({ ...s, active: "nova" }, { type: "party-close", party }),
  );
  s = run(s, { type: "party-close", party });
  assert.throws(() =>
    run({ ...s, active: "nova" }, { type: "party-join", party }),
  );
  assert.throws(() => run(seed(), { ...post, startsAt: "2020-01-01" }));
});
test("blocked and banned players cannot join a team", () => {
  let s = run(seed(), post);
  s.friends = [{ from: "karim", to: "nova", status: "blocked" }];
  assert.throws(() =>
    run(
      { ...s, active: "nova" },
      { type: "party-join", party: s.parties[0].id },
    ),
  );
  s.users.find((u) => u.id === "alex").banned = true;
  assert.throws(() => run({ ...s, active: "alex" }, { ...post }));
});
test("showcase saves owned games in selected order and stays isolated", () => {
  const s = seed();
  const ids = s.library.karim.slice(0, 2).reverse();
  const changed = run(s, {
    type: "showcase-save",
    title: "Мой выбор",
    games: ids,
  });
  assert.deepEqual(changed.users[0].showcase.games, ids);
  assert.equal(changed.users.find((u) => u.id === "nova").showcase, undefined);
  assert.throws(() => run(s, { type: "showcase-save", games: ["not-owned"] }));
  assert.deepEqual(
    run(changed, { type: "showcase-save", games: [] }).users[0].showcase.games,
    [],
  );
});
test("checkout rewards sender on discounted amount exactly once, never gift recipient", () => {
  let s = run(seed(), { type: "cart", game: "echoes" });
  s = run(s, { type: "checkout", recipient: "nova", promo: "PLAY10" });
  assert.equal(s.orders[0].pointsEarned, 18);
  assert.equal(s.users[0].points, 1018);
  assert.equal(s.users.find((u) => u.id === "nova").points, 1000);
  assert.throws(() => run(s, { type: "checkout", recipient: "nova" }));
  assert.equal(purchasePoints(0), 0);
  assert.equal(purchasePoints(99), 9);
});
