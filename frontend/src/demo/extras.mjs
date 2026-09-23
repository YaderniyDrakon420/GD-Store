export function upgrade(state) {
  return {
    ...state,
    version: 4,
    walletLog: state.walletLog || [],
    tickets: state.tickets || [],
    saleWatch: state.saleWatch || {},
    pointsLog:
      state.pointsLog ||
      state.users.map((u) => ({
        id: "opening-" + u.id,
        user: u.id,
        amount: u.points ?? 1000,
        text: "Начальный баланс истории",
        at: null,
      })),
    parties: state.parties || [],
    reports: state.reports || [],
    cosmeticsOwned: state.cosmeticsOwned || {},
    gifts:
      state.gifts ||
      (state.orders || [])
        .filter((o) => o.recipient && o.recipient !== o.user)
        .map((o) => ({
          id: o.id,
          from: o.user,
          to: o.recipient,
          gameIds: o.games,
          message: "",
          at: o.at,
          opened: false,
        })),
    events: state.events || [],
    collections: state.collections || [],
    notifications: state.notifications || [],
    users: state.users.map((u) => ({
      ...u,
      role: u.role || (u.id === "karim" ? "admin" : "player"),
      banned: !!u.banned,
      points: u.points ?? 1000,
      wallet: u.wallet ?? 0,
    })),
    comparison: state.comparison || {},
    adminLog: state.adminLog || [],
    announcement: state.announcement || { enabled: false, text: "" },
  };
}
export const canSee = (item, user) =>
  !!item && (!item.hidden || user?.role === "admin");
export function checkoutQuote(state, options, catalog) {
  const me = state.active;
  const actor = state.users.find((u) => u.id === me);
  if (!actor || actor.banned)
    throw Error("Для покупки нужен активный профиль.");
  const ids = state.cart[me] || [];
  if (!ids.length) throw Error("Корзина пуста.");
  const items = ids.map((id) => catalog.find((g) => g.id === id));
  if (items.some((g) => !g)) throw Error("В корзине есть недоступная игра.");
  const recipient = options.recipient || me;
  if (!state.users.some((u) => u.id === recipient && !u.banned))
    throw Error("Получатель недоступен.");
  if (
    recipient !== me &&
    !state.friends.some(
      (f) =>
        f.status === "accepted" &&
        [f.from, f.to].includes(me) &&
        [f.from, f.to].includes(recipient),
    )
  )
    throw Error("Подарок можно отправить только другу.");
  if (ids.some((id) => state.library[recipient]?.includes(id)))
    throw Error(
      recipient === me
        ? "Одна из игр уже есть в вашей библиотеке. Удалите её из корзины."
        : "У друга уже есть одна из этих игр. Измените корзину или получателя.",
    );
  const promo = (options.promo || "").trim().toUpperCase();
  if (promo && promo !== "PLAY10")
    throw Error("Промокод не найден. Для демонстрации используйте PLAY10.");
  const subtotal = items.reduce(
    (sum, g) => sum + Math.round(g.price * (1 - g.discount / 100)),
    0,
  );
  const discount = promo ? Math.round(subtotal * 0.1) : 0;
  return {
    items,
    recipient,
    subtotal,
    discount,
    total: subtotal - discount,
    promo,
  };
}
export function extraAction(state, action, catalog, id, at) {
  const me = state.users.find((u) => u.id === state.active);
  const log = (text) => {
    state.adminLog.unshift({ id, actor: me.id, text, at });
    state.adminLog = state.adminLog.slice(0, 100);
  };
  if (action.type.startsWith("admin-")) {
    if (!me || me.banned || me.role !== "admin")
      throw Error("Раздел доступен администратору.");
    switch (action.type) {
      case "admin-ban": {
        const user = state.users.find((u) => u.id === action.user);
        if (!user || user.id === me.id || user.role === "admin")
          throw Error("Нельзя заблокировать администратора.");
        if (!action.reason?.trim()) throw Error("Укажите причину блокировки.");
        user.banned = true;
        user.banReason = action.reason.trim().slice(0, 240);
        user.status = "offline";
        log("Заблокирован " + user.name + ": " + user.banReason);
        break;
      }
      case "admin-unban": {
        const user = state.users.find((u) => u.id === action.user);
        if (!user) throw Error("Пользователь не найден.");
        user.banned = false;
        user.banReason = "";
        log("Снята блокировка: " + user.name);
        break;
      }
      case "admin-moderate": {
        if (!["topics", "mods"].includes(action.collection))
          throw Error("Раздел не найден.");
        const item = state[action.collection].find((x) => x.id === action.item);
        if (!item) throw Error("Материал не найден.");
        if (
          !["hidden", "locked"].includes(action.field) ||
          (action.collection === "mods" && action.field === "locked")
        )
          throw Error("Действие недоступно.");
        item[action.field] = !item[action.field];
        log(
          (action.field === "hidden"
            ? item.hidden
              ? "Скрыт: "
              : "Восстановлен: "
            : item.locked
              ? "Закрыта тема: "
              : "Открыта тема: ") + item.title,
        );
        break;
      }
      case "admin-announcement": {
        const text = (action.text || "").trim();
        if (action.enabled && !text) throw Error("Введите текст объявления.");
        state.announcement = {
          text: text.slice(0, 160),
          enabled: !!action.enabled,
        };
        log(
          action.enabled
            ? "Обновлено объявление: " + text
            : "Объявление отключено",
        );
        break;
      }
      default:
        throw Error("Неизвестное действие администратора.");
    }
    return true;
  }
  if (action.type === "compare") {
    if (!me || me.banned) throw Error("Выберите активный профиль.");
    if (!catalog.some((g) => g.id === action.game))
      throw Error("Игра не найдена.");
    const current = state.comparison[me.id] || [];
    if (current.includes(action.game)) {
      state.comparison[me.id] = current.filter((x) => x !== action.game);
    } else {
      if (current.length >= 3)
        throw Error("Можно сравнить до трёх игр. Уберите одну из сравнения.");
      state.comparison[me.id] = [...current, action.game];
    }
    return true;
  }
  if (action.type === "compare-clear") {
    if (!me || me.banned) throw Error("Выберите активный профиль.");
    state.comparison[me.id] = [];
    return true;
  }
  return false;
}
export function pickGames(
  catalog,
  { mood = "any", budget = 2000, owned = [] },
) {
  return catalog.filter(
    (g) =>
      Math.round(g.price * (1 - g.discount / 100)) <= Number(budget) &&
      !owned.includes(g.id) &&
      (mood === "any" ||
        (mood === "calm"
          ? ["Инди", "Стратегии"].includes(g.genre)
          : mood === "adventure"
            ? ["Приключения", "RPG"].includes(g.genre)
            : g.tags.some((t) => ["Кооператив", "Мультиплеер"].includes(t)))),
  );
}
export function validateDemoCard(card) {
  if (card.number.replace(/\s/g, "") !== "4242424242424242")
    return "Используйте только тестовый номер 4242 4242 4242 4242.";
  if (card.expiry !== "12/30") return "Для демокарты укажите срок 12/30.";
  if (card.cvc !== "123") return "Для демокарты используйте CVC 123.";
  if (!card.name.trim()) return "Введите имя на демокарте.";
  return "";
}
