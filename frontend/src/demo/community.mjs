import { notify } from "./social.mjs";
export const cosmetics = [
  {
    id: "avatar-orbit",
    type: "avatar",
    name: "Странник",
    description: "Там, где начинаются звёзды",
    price: 180,
    image: "/art/orbital.png",
  },
  {
    id: "avatar-ash",
    type: "avatar",
    name: "Пепельный страж",
    description: "Для тех, кто выбирает сложный путь",
    price: 220,
    image: "/art/ashen.png",
  },
  {
    id: "avatar-night",
    type: "avatar",
    name: "Ночной пилот",
    description: "Неон — ваш естественный свет",
    price: 180,
    image: "/art/velocity.png",
  },
  {
    id: "banner-orbit",
    type: "banner",
    name: "Кольца Элиона",
    description: "Целый мир над вашим профилем",
    price: 300,
    image: "/art/orbital.png",
    game: "orbital",
  },
  {
    id: "banner-ash",
    type: "banner",
    name: "Багровый рассвет",
    description: "История, написанная пеплом",
    price: 300,
    image: "/art/ashen.png",
    game: "ashen",
  },
  {
    id: "banner-night",
    type: "banner",
    name: "После полуночи",
    description: "Город, который не засыпает",
    price: 320,
    image: "/art/velocity.png",
    game: "velocity",
  },
  {
    id: "frame-teal",
    type: "frame",
    name: "Сигнал",
    description: "Бирюзовая рамка аватара",
    price: 120,
    color: "#65e6cf",
  },
  {
    id: "frame-violet",
    type: "frame",
    name: "Спектр",
    description: "Фиолетовое свечение",
    price: 160,
    color: "#bf9bff",
  },
  {
    id: "frame-gold",
    type: "frame",
    name: "Престиж",
    description: "Золотой акцент",
    price: 200,
    color: "#edc37e",
  },
];
export const reportReasons = [
  "Спам",
  "Оскорбления",
  "Мошенничество",
  "Неприемлемый контент",
  "Другое",
];
export function communityAction(n, a, id, at) {
  if (
    ![
      "report-create",
      "admin-report-resolve",
      "admin-role",
      "cosmetic-buy",
      "cosmetic-equip",
      "gift-open",
      "auth-register",
      "auth-login",
      "auth-reset",
    ].includes(a.type)
  )
    return false;
  const me = n.users.find((u) => u.id === n.active);
  const active = () => {
    if (!me || me.banned) throw Error("Нужен активный профиль.");
  };
  const admin = () => {
    active();
    if (me.role !== "admin") throw Error("Требуются права администратора.");
  };
  const log = (text) => {
    n.adminLog.unshift({ id, actor: me.id, text, at });
    n.adminLog = n.adminLog.slice(0, 100);
  };
  switch (a.type) {
    case "report-create": {
      active();
      if (
        !["player", "message"].includes(a.kind) ||
        !reportReasons.includes(a.reason)
      )
        throw Error("Выберите тип и причину жалобы.");
      const target = n.users.find((u) => u.id === a.user);
      if (!target || target.id === me.id)
        throw Error("Выберите другого игрока.");
      const message =
        a.kind === "message"
          ? n.messages.find(
              (m) =>
                m.id === a.message && m.from === target.id && m.to === me.id,
            )
          : null;
      if (a.kind === "message" && !message)
        throw Error("Можно пожаловаться только на сообщение, полученное вами.");
      if (
        n.reports.some(
          (r) =>
            r.reporter === me.id &&
            r.user === a.user &&
            r.kind === a.kind &&
            r.messageId === (message?.id || null) &&
            r.status === "pending",
        )
      )
        throw Error("Такая жалоба уже ожидает рассмотрения.");
      n.reports.unshift({
        id,
        reporter: me.id,
        user: target.id,
        kind: a.kind,
        messageId: message?.id || null,
        evidence: message?.text || "",
        reason: a.reason,
        details: (a.details || "").trim().slice(0, 1000),
        status: "pending",
        at,
      });
      for (const u of n.users.filter(
        (u) => u.role === "admin" && !u.banned && u.id !== target.id,
      ))
        notify(
          n,
          u.id,
          me.id,
          "Новая жалоба",
          a.reason + " · " + target.name,
          "/admin",
          at,
        );
      break;
    }
    case "admin-report-resolve": {
      admin();
      const report = n.reports.find((r) => r.id === a.report);
      if (!report || report.status !== "pending")
        throw Error("Жалоба уже обработана или недоступна.");
      if (!["resolved", "dismissed"].includes(a.status) || !a.note?.trim())
        throw Error("Выберите решение и укажите пояснение.");
      Object.assign(report, {
        status: a.status,
        note: a.note.trim().slice(0, 500),
        reviewedBy: me.id,
        reviewedAt: at,
      });
      log(
        "Жалоба " +
          report.id.slice(0, 8) +
          ": " +
          (a.status === "resolved" ? "подтверждена" : "отклонена"),
      );
      notify(
        n,
        report.reporter,
        me.id,
        "Жалоба рассмотрена",
        report.note,
        "/notifications",
        at,
      );
      break;
    }
    case "admin-role": {
      admin();
      const user = n.users.find((u) => u.id === a.user);
      if (!user || user.id === "karim" || user.id === me.id || user.banned)
        throw Error(
          "Нельзя изменить эту роль. Karim — основной администратор.",
        );
      if (!["admin", "player"].includes(a.role))
        throw Error("Неизвестная роль.");
      user.role = a.role;
      log(
        user.name +
          ": " +
          (a.role === "admin"
            ? "назначен администратором"
            : "права администратора сняты"),
      );
      notify(
        n,
        user.id,
        me.id,
        "Роль профиля обновлена",
        a.role === "admin"
          ? "Вам доступна панель управления сайтом."
          : "Права администратора сняты.",
        "/settings",
        at,
      );
      break;
    }
    case "cosmetic-buy": {
      active();
      const item = cosmetics.find((x) => x.id === a.item);
      if (!item) throw Error("Предмет не найден.");
      if ((n.cosmeticsOwned[me.id] || []).includes(item.id))
        throw Error("Предмет уже куплен.");
      if (me.points < item.price) throw Error("Недостаточно демобаллов.");
      me.points -= item.price;
      n.pointsLog.unshift({
        id,
        user: me.id,
        amount: -item.price,
        text: "Оформление: " + item.name,
        at,
      });
      n.cosmeticsOwned[me.id] = [...(n.cosmeticsOwned[me.id] || []), item.id];
      break;
    }
    case "cosmetic-equip": {
      active();
      if (!["avatar", "banner", "frame"].includes(a.slot))
        throw Error("Выберите тип оформления.");
      if (a.item) {
        const item = cosmetics.find(
          (x) => x.id === a.item && x.type === a.slot,
        );
        if (!item || !(n.cosmeticsOwned[me.id] || []).includes(a.item))
          throw Error("Сначала приобретите предмет.");
      }
      me["cosmetic" + a.slot[0].toUpperCase() + a.slot.slice(1)] = a.item || "";
      break;
    }
    case "gift-open": {
      active();
      const gift = n.gifts.find((g) => g.id === a.gift && g.to === me.id);
      if (!gift) throw Error("Подарок недоступен.");
      gift.opened = true;
      break;
    }
    case "auth-register": {
      const handle = (a.handle || "").trim().toLowerCase(),
        email = (a.email || "").trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(handle) || !/^\S+@\S+\.\S+$/.test(email))
        throw Error("Проверьте логин и email.");
      if (n.users.some((u) => u.handle === handle || u.email === email))
        throw Error("Логин или email уже используется.");
      if (!a.credential?.hash || !a.credential?.recoveryHash || !a.name?.trim())
        throw Error("Заполните все поля.");
      n.users.push({
        id,
        handle,
        email,
        name: a.name.trim().slice(0, 40),
        initials: a.name.trim().slice(0, 2).toUpperCase(),
        auth: a.credential,
        role: "player",
        banned: false,
        points: 1000,
        color: "#65e6cf",
        status: "online",
        bio: "",
        country: "",
        level: 1,
      });
      n.pointsLog.unshift({
        id: "welcome-" + id,
        user: id,
        amount: 1000,
        text: "Стартовые демобаллы",
        at,
      });
      n.active = id;
      break;
    }
    case "auth-login": {
      const user = n.users.find((u) => u.id === a.user);
      if (!user || user.banned) throw Error("Профиль недоступен.");
      n.active = user.id;
      break;
    }
    case "auth-reset": {
      const user = n.users.find((u) => u.id === a.user);
      if (!user || !user.auth) throw Error("Профиль недоступен.");
      user.auth = { ...user.auth, ...a.credential };
      n.active = null;
      break;
    }
  }
  return true;
}
