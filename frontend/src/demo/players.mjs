import { notify } from "./social.mjs";
export const purchasePoints = (total) => Math.floor(total / 10);
export function playerAction(n, a, catalog, id, at) {
  if (
    ![
      "party-save",
      "party-message",
      "party-join",
      "party-leave",
      "party-close",
      "showcase-save",
    ].includes(a.type)
  )
    return false;
  const me = n.users.find((u) => u.id === n.active);
  if (!me || me.banned) throw Error("Нужен активный профиль.");
  if (a.type === "party-message") {
    const party = n.parties.find((p) => p.id === a.party);
    if (!party || !party.members.includes(me.id) || party.closed)
      throw Error("Чат недоступен.");
    if (!a.text?.trim()) throw Error("Введите сообщение.");
    party.messages ||= [];
    party.messages.push({
      id,
      author: me.id,
      text: a.text.trim().slice(0, 2000),
      at,
    });
    for (const user of party.members)
      if (!n.users.find((u) => u.id === user)?.banned)
        notify(
          n,
          user,
          me.id,
          "Сообщение команды",
          party.title + ": " + a.text.trim().slice(0, 100),
          "/teammates",
          at,
        );
    return true;
  }
  if (a.type === "showcase-save") {
    const ids = [...new Set(a.games || [])];
    if (ids.length > 3 || ids.some((g) => !n.library[me.id]?.includes(g)))
      throw Error("Выберите до трёх игр своей библиотеки.");
    me.showcase = {
      title: (a.title || "Любимые миры").trim().slice(0, 60) || "Любимые миры",
      games: ids,
    };
    return true;
  }
  if (a.type === "party-save") {
    if (
      !a.title?.trim() ||
      !catalog.some((g) => g.id === a.game) ||
      !Number.isInteger(a.capacity) ||
      a.capacity < 2 ||
      a.capacity > 8 ||
      !["Русский", "Українська", "English"].includes(a.language)
    )
      throw Error("Проверьте поля объявления.");
    if (
      !Number.isFinite(Date.parse(a.startsAt)) ||
      Date.parse(a.startsAt) <= Date.parse(at)
    )
      throw Error("Выберите время в будущем.");
    const old = n.parties.find((p) => p.id === a.party);
    if (a.party && (!old || old.host !== me.id || old.closed))
      throw Error("Объявление недоступно.");
    if (old && a.capacity < old.members.length)
      throw Error("Мест меньше, чем участников.");
    const values = {
      title: a.title.trim().slice(0, 80),
      game: a.game,
      capacity: a.capacity,
      language: a.language,
      startsAt: a.startsAt,
      description: (a.description || "").trim().slice(0, 500),
    };
    if (old) Object.assign(old, values);
    else
      n.parties.unshift({
        id,
        host: me.id,
        members: [me.id],
        closed: false,
        ...values,
      });
    return true;
  }
  const party = n.parties.find((p) => p.id === a.party);
  if (!party) throw Error("Объявление не найдено.");
  if (a.type === "party-close") {
    if (party.host !== me.id)
      throw Error("Только организатор может закрыть набор.");
    party.closed = true;
    return true;
  }
  if (a.type === "party-leave") {
    if (party.host === me.id) throw Error("Организатор может закрыть набор.");
    party.members = party.members.filter((u) => u !== me.id);
    return true;
  }
  if (
    party.closed ||
    Date.parse(party.startsAt) <= Date.parse(at) ||
    n.users.find((u) => u.id === party.host)?.banned
  )
    throw Error("Набор завершён.");
  if (
    n.friends.some(
      (f) =>
        f.status === "blocked" &&
        [f.from, f.to].includes(me.id) &&
        [f.from, f.to].includes(party.host),
    )
  )
    throw Error("Участие недоступно из-за блокировки.");
  if (party.members.includes(me.id)) throw Error("Вы уже в команде.");
  if (party.members.length >= party.capacity)
    throw Error("Свободных мест нет.");
  party.members.push(me.id);
  notify(
    n,
    party.host,
    me.id,
    "Новый напарник",
    me.name + " присоединился: " + party.title,
    "/teammates",
    at,
  );
  return true;
}
