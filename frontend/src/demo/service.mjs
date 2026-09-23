import { notificationAllowed } from "./notificationPrefs.mjs";
export function visibleSection(state, owner, viewer, section) {
  if (owner === viewer) return true;
  const value = state.settings[owner]?.[section] || "all";
  return (
    value === "all" ||
    (value === "friends" &&
      !!viewer &&
      state.friends.some(
        (f) =>
          f.status === "accepted" &&
          [f.from, f.to].includes(owner) &&
          [f.from, f.to].includes(viewer),
      ))
  );
}
export function serviceAction(n, a, catalog, id, at) {
  if (
    ![
      "ticket-create",
      "ticket-reply",
      "ticket-status",
      "review-vote",
      "privacy-save",
      "sale-check",
      "sale-demo",
    ].includes(a.type)
  )
    return false;
  const me = n.users.find((u) => u.id === n.active);
  if (!me || me.banned) throw Error("Нужен активный профиль.");
  const ping = (to, title, text, url) =>
    notificationAllowed(n, to, url) &&
    n.notifications.unshift({
      id: crypto.randomUUID(),
      to,
      from: me.id,
      title,
      text,
      url,
      at,
      read: false,
    });
  if (a.type === "privacy-save") {
    for (const field of [
      "libraryPrivacy",
      "activityPrivacy",
      "friendsPrivacy",
      "requestsPrivacy",
    ])
      if (!["all", "friends", "none"].includes(a[field]))
        throw Error("Неизвестный режим приватности.");
    n.settings[me.id] = {
      ...n.settings[me.id],
      libraryPrivacy: a.libraryPrivacy,
      activityPrivacy: a.activityPrivacy,
      friendsPrivacy: a.friendsPrivacy,
      requestsPrivacy: a.requestsPrivacy,
      saleAlerts: !!a.saleAlerts,
    };
    return true;
  }
  if (a.type === "review-vote") {
    const r = n.reviews.find((r) => r.id === a.review);
    if (!r || r.author === me.id) throw Error("Нельзя оценить этот отзыв.");
    r.helpful = r.helpful || [];
    r.helpful = r.helpful.includes(me.id)
      ? r.helpful.filter((x) => x !== me.id)
      : [...r.helpful, me.id];
    return true;
  }
  if (a.type === "sale-check" || a.type === "sale-demo") {
    if (n.settings[me.id]?.saleAlerts === false) return true;
    const ids = n.wishlist[me.id] || [];
    const watched = n.saleWatch[me.id] || (n.saleWatch[me.id] = {});
    for (const g of catalog.filter((g) => ids.includes(g.id))) {
      const now = Math.round(g.price * (1 - g.discount / 100));
      if (a.type === "sale-demo") {
        if (g.id === a.game)
          ping(
            me.id,
            "Демо: скидка на желаемое",
            g.title + " — пример уведомления. Цена в магазине не изменена.",
            "/game/" + g.id,
          );
      } else {
        if (typeof watched[g.id] === "number" && now < watched[g.id])
          ping(
            me.id,
            "Игра из желаемого подешевела",
            g.title + ": " + watched[g.id] + " → " + now + " ₴",
            "/game/" + g.id,
          );
        watched[g.id] = now;
      }
    }
    for (const key of Object.keys(watched))
      if (!ids.includes(key)) delete watched[key];
    return true;
  }
  if (a.type === "ticket-create") {
    if (
      !a.title?.trim() ||
      !a.text?.trim() ||
      !["Покупка", "Аккаунт", "Жалоба", "Другое"].includes(a.category)
    )
      throw Error("Заполните тему и описание.");
    n.tickets.unshift({
      id,
      owner: me.id,
      title: a.title.trim().slice(0, 100),
      category: a.category,
      status: "open",
      at,
      messages: [{ id, author: me.id, text: a.text.trim().slice(0, 2000), at }],
    });
    for (const u of n.users.filter((u) => u.role === "admin" && !u.banned))
      if (u.id !== me.id) ping(u.id, "Новое обращение", a.title, "/support");
    return true;
  }
  const t = n.tickets.find((t) => t.id === a.ticket);
  if (!t || (t.owner !== me.id && me.role !== "admin"))
    throw Error("Обращение недоступно.");
  if (a.type === "ticket-status") {
    if (
      me.role !== "admin" ||
      !["open", "in-progress", "resolved"].includes(a.status)
    )
      throw Error("Требуются права администратора.");
    t.status = a.status;
    ping(t.owner, "Статус обращения изменён", t.title, "/support");
    return true;
  }
  if (t.status === "resolved")
    throw Error("Обращение закрыто. Администратор может открыть его снова.");
  if (!a.text?.trim()) throw Error("Введите сообщение.");
  t.messages.push({
    id,
    author: me.id,
    text: a.text.trim().slice(0, 2000),
    at,
  });
  if (me.id !== t.owner) ping(t.owner, "Ответ поддержки", t.title, "/support");
  else
    for (const u of n.users.filter(
      (u) => u.role === "admin" && !u.banned && u.id !== me.id,
    ))
      ping(u.id, "Ответ в обращении", t.title, "/support");
  return true;
}
