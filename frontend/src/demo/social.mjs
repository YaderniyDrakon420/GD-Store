import { notificationAllowed } from "./notificationPrefs.mjs";
export function notify(state, to, from, title, text, url, at) {
  if (!to || to === from || !notificationAllowed(state, to, url)) return;
  state.notifications.unshift({
    id: crypto.randomUUID(),
    to,
    from,
    title,
    text,
    url,
    at,
    read: false,
  });
}
export const eventVisible = (event, user) =>
  !!user && (event.host === user || event.invitees.includes(user));
export function socialAction(n, a, catalog, id, at) {
  if (
    ![
      "event-create",
      "event-edit",
      "event-cancel",
      "event-rsvp",
      "collection-save",
      "collection-delete",
      "notification-read",
      "notifications-read-all",
    ].includes(a.type)
  )
    return false;
  const me = n.users.find((u) => u.id === n.active);
  if (!me || me.banned)
    throw Error("Нужен активный незаблокированный профиль.");
  const friend = (user) =>
    n.friends.some(
      (f) =>
        f.status === "accepted" &&
        [f.from, f.to].includes(me.id) &&
        [f.from, f.to].includes(user),
    );
  const ping = (user, title, text, event) =>
    notify(n, user, me.id, title, text, "/events/" + event, at);
  switch (a.type) {
    case "event-create":
    case "event-edit": {
      const old =
        a.type === "event-edit"
          ? n.events.find((e) => e.id === a.event && e.host === me.id)
          : null;
      if (a.type === "event-edit" && (!old || old.cancelled))
        throw Error("Событие недоступно.");
      const title = (a.title || "").trim();
      if (!title || title.length > 80)
        throw Error("Название: от 1 до 80 символов.");
      if (!catalog.some((g) => g.id === a.game)) throw Error("Выберите игру.");
      const when = new Date(a.startsAt);
      if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now())
        throw Error("Выберите дату и время в будущем.");
      const invitees = [...new Set(a.invitees || [])];
      if (
        invitees.some(
          (user) =>
            !friend(user) || !n.users.some((u) => u.id === user && !u.banned),
        )
      )
        throw Error("Приглашать можно только активных друзей.");
      const eventId = old?.id || id;
      const event = {
        id: eventId,
        host: me.id,
        title,
        game: a.game,
        startsAt: when.toISOString(),
        description: (a.description || "").slice(0, 1000),
        invitees,
        rsvp: Object.fromEntries(
          invitees.map((u) => [u, old?.rsvp[u] || "invited"]),
        ),
        cancelled: false,
      };
      if (old) {
        n.events = n.events.map((e) => (e.id === eventId ? event : e));
        for (const user of old.invitees.filter((u) => !invitees.includes(u)))
          ping(user, "Приглашение отозвано", title, eventId);
      } else n.events.unshift(event);
      for (const user of invitees)
        ping(
          user,
          old ? "Планы обновились" : "Приглашение на игровой вечер",
          me.name + ": " + title,
          eventId,
        );
      break;
    }
    case "event-cancel": {
      const event = n.events.find((e) => e.id === a.event && e.host === me.id);
      if (!event || event.cancelled) throw Error("Событие недоступно.");
      event.cancelled = true;
      for (const user of event.invitees)
        ping(user, "Игровой вечер отменён", event.title, event.id);
      break;
    }
    case "event-rsvp": {
      const event = n.events.find(
        (e) => e.id === a.event && e.invitees.includes(me.id),
      );
      if (!event || event.cancelled || new Date(event.startsAt) <= new Date())
        throw Error("Ответ на это приглашение больше недоступен.");
      if (!["going", "declined", "invited"].includes(a.status))
        throw Error("Выберите ответ.");
      if (event.rsvp[me.id] === a.status) return true;
      event.rsvp[me.id] = a.status;
      ping(
        event.host,
        "Ответ на приглашение",
        me.name +
          (a.status === "going"
            ? " будет играть"
            : a.status === "declined"
              ? " не сможет прийти"
              : " пока не определился"),
        event.id,
      );
      break;
    }
    case "collection-save": {
      const old = a.collection
        ? n.collections.find((c) => c.id === a.collection && c.owner === me.id)
        : null;
      if (a.collection && !old) throw Error("Коллекция недоступна.");
      const name = (a.name || "").trim();
      if (!name || name.length > 45)
        throw Error("Название: от 1 до 45 символов.");
      if (
        n.collections.some(
          (c) =>
            c.owner === me.id &&
            c.id !== old?.id &&
            c.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw Error("Коллекция с таким названием уже есть.");
      const gameIds = [...new Set(a.gameIds || [])];
      if (gameIds.some((game) => !(n.library[me.id] || []).includes(game)))
        throw Error("В коллекцию можно добавить только игры своей библиотеки.");
      const color = ["teal", "violet", "amber", "rose"].includes(a.color)
        ? a.color
        : "teal";
      const value = { id: old?.id || id, owner: me.id, name, color, gameIds };
      if (old)
        n.collections = n.collections.map((c) => (c.id === old.id ? value : c));
      else n.collections.push(value);
      break;
    }
    case "collection-delete": {
      const target = n.collections.find(
        (c) => c.id === a.collection && c.owner === me.id,
      );
      if (!target) throw Error("Коллекция недоступна.");
      n.collections = n.collections.filter((c) => c !== target);
      break;
    }
    case "notification-read": {
      const note = n.notifications.find(
        (x) => x.id === a.notification && x.to === me.id,
      );
      if (!note) throw Error("Уведомление недоступно.");
      note.read = true;
      break;
    }
    case "notifications-read-all":
      n.notifications
        .filter((x) => x.to === me.id)
        .forEach((x) => {
          x.read = true;
        });
      break;
  }
  return true;
}
export function activityNotice(n, a, me, at) {
  const user = n.users.find((u) => u.id === me);
  if (!user) return;
  const ping = (to, title, text, url) =>
    notify(n, to, me, title, text, url, at);
  switch (a.type) {
    case "request":
      ping(
        a.user,
        "Новая заявка в друзья",
        user.name + " хочет добавить вас в друзья",
        "/friends",
      );
      break;
    case "accept": {
      const f = n.friends.find((f) => f.id === a.friend);
      if (f)
        ping(
          f.from,
          "Заявка принята",
          user.name + " теперь ваш друг",
          "/profile/" + me,
        );
      break;
    }
    case "message":
      ping(
        a.user,
        "Новое сообщение",
        user.name + ": " + a.text.slice(0, 100),
        "/messages/" + me,
      );
      break;
    case "reply": {
      const t = n.topics.find((t) => t.id === a.topic);
      if (t)
        ping(
          t.author,
          "Ответ в обсуждении",
          user.name + " ответил: " + t.title,
          "/community/" + t.id,
        );
      break;
    }
    case "checkout": {
      const order = n.orders[0];
      if (order && order.recipient !== me)
        ping(
          order.recipient,
          "Вам подарили игру",
          user.name + " отправил подарок. Он уже в библиотеке.",
          "/gifts",
        );
      break;
    }
  }
}
