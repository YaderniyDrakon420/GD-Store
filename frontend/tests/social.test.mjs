import test from "node:test";
import assert from "node:assert/strict";
import { seed, transition, load } from "../src/demo/model.mjs";
import { eventVisible } from "../src/demo/social.mjs";
const run = (s, a) => transition(s, { id: crypto.randomUUID(), ...a });
const future = () => new Date(Date.now() + 86400000).toISOString();
const create = (s) =>
  run(s, {
    type: "event-create",
    title: "Кооператив",
    game: "orbital",
    startsAt: future(),
    description: "Вместе",
    invitees: ["nova", "alex"],
  });
test("v2 migration preserves data while adding events and collections", () => {
  const old = seed();
  old.version = 2;
  delete old.notifications;
  delete old.events;
  delete old.collections;
  const result = load({ getItem: () => JSON.stringify(old) });
  assert.equal(result.version, 4);
  assert.deepEqual(result.library, old.library);
  assert.deepEqual(result.messages, old.messages);
  assert.deepEqual(result.events, []);
});
test("events invite accepted friends and remain private to participants", () => {
  const s = create(seed());
  assert.equal(s.events.length, 1);
  assert.equal(s.notifications.length, 2);
  assert.equal(eventVisible(s.events[0], "nova"), true);
  assert.equal(eventVisible(s.events[0], "danya"), false);
  assert.throws(() =>
    run(seed(), {
      type: "event-create",
      title: "Test",
      game: "orbital",
      startsAt: future(),
      invitees: ["danya"],
    }),
  );
});
test("invitation response notifies host and does not repeat unchanged notifications", () => {
  let s = create(seed());
  const id = s.events[0].id;
  s = run(s, { type: "switch", user: "nova" });
  s = run(s, { type: "event-rsvp", event: id, status: "going" });
  assert.equal(s.events[0].rsvp.nova, "going");
  assert.equal(s.notifications[0].to, "karim");
  const count = s.notifications.length;
  s = run(s, { type: "event-rsvp", event: id, status: "going" });
  assert.equal(s.notifications.length, count);
});
test("only organizer edits or cancels and cancelled events reject responses", () => {
  let s = create(seed());
  const id = s.events[0].id;
  s = run(s, { type: "switch", user: "nova" });
  assert.throws(() => run(s, { type: "event-cancel", event: id }));
  assert.throws(() =>
    run(s, {
      type: "event-edit",
      event: id,
      title: "No",
      game: "orbital",
      startsAt: future(),
      invitees: [],
    }),
  );
  s = run(s, { type: "switch", user: "karim" });
  s = run(s, { type: "event-cancel", event: id });
  assert.equal(s.events[0].cancelled, true);
  s = run(s, { type: "switch", user: "nova" });
  assert.throws(() =>
    run(s, { type: "event-rsvp", event: id, status: "going" }),
  );
});
test("invalid date, banned actors and nonparticipants cannot create or answer events", () => {
  assert.throws(() =>
    run(seed(), {
      type: "event-create",
      title: "Test",
      game: "orbital",
      startsAt: "2020-01-01",
      invitees: [],
    }),
  );
  let s = create(seed());
  const id = s.events[0].id;
  s = run(s, { type: "switch", user: "danya" });
  assert.throws(() =>
    run(s, { type: "event-rsvp", event: id, status: "going" }),
  );
  s = run(s, { type: "switch", user: "karim" });
  s = run(s, { type: "admin-ban", user: "nova", reason: "Test" });
  s = run(s, { type: "switch", user: "nova" });
  assert.throws(() => create(s));
});
test("collection changes are private and deleting a folder keeps library intact", () => {
  let s = run(seed(), {
    type: "collection-save",
    name: "Любимые",
    color: "violet",
    gameIds: ["orbital", "ashen"],
  });
  const id = s.collections[0].id;
  const library = structuredClone(s.library);
  s = run(s, { type: "switch", user: "nova" });
  assert.throws(() => run(s, { type: "collection-delete", collection: id }));
  assert.throws(() =>
    run(s, {
      type: "collection-save",
      collection: id,
      name: "Other",
      gameIds: [],
    }),
  );
  s = run(s, { type: "switch", user: "karim" });
  s = run(s, { type: "collection-delete", collection: id });
  assert.deepEqual(s.library, library);
  assert.equal(s.collections.length, 0);
});
test("collections reject unowned games and duplicate names", () => {
  assert.throws(() =>
    run(seed(), { type: "collection-save", name: "New", gameIds: ["echoes"] }),
  );
  let s = run(seed(), { type: "collection-save", name: "Later", gameIds: [] });
  assert.throws(() =>
    run(s, { type: "collection-save", name: "later", gameIds: [] }),
  );
  const id = s.collections[0].id;
  s = run(s, {
    type: "collection-save",
    collection: id,
    name: "Weekend",
    color: "rose",
    gameIds: ["velocity"],
  });
  assert.equal(s.collections[0].name, "Weekend");
  assert.deepEqual(s.collections[0].gameIds, ["velocity"]);
});
test("notifications can be read only by recipient", () => {
  let s = run(seed(), { type: "message", user: "nova", text: "Hi" });
  const note = s.notifications[0];
  assert.equal(note.to, "nova");
  assert.throws(() =>
    run(s, { type: "notification-read", notification: note.id }),
  );
  s = run(s, { type: "switch", user: "nova" });
  s = run(s, { type: "notification-read", notification: note.id });
  assert.equal(s.notifications[0].read, true);
});
test("mark all read preserves other profiles unread notifications", () => {
  let s = create(seed());
  s = run(s, { type: "switch", user: "nova" });
  s = run(s, { type: "notifications-read-all" });
  assert.ok(
    s.notifications.filter((n) => n.to === "nova").every((n) => n.read),
  );
  assert.ok(
    s.notifications.filter((n) => n.to === "alex").every((n) => !n.read),
  );
});
test("messages, replies and gifts generate contextual notifications", () => {
  let s = run(seed(), { type: "reply", topic: "t1", text: "Hi" });
  assert.equal(s.notifications[0].url, "/community/t1");
  s = run(s, { type: "cart", game: "echoes" });
  s = run(s, { type: "checkout", recipient: "nova" });
  assert.equal(s.notifications[0].title, "Вам подарили игру");
  assert.equal(s.notifications[0].to, "nova");
});
