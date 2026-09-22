export const notificationKinds = {
  messages: "Личные сообщения",
  teams: "Командный чат",
  gifts: "Подарки",
  sales: "Скидки",
  releases: "Выход предзаказанных игр",
  invitations: "Заявки и приглашения",
  support: "Ответы поддержки",
  community: "Ответы и события сообщества",
  admin: "Модерация и роли",
};
export function notificationKind(url) {
  if (url.startsWith("/messages/")) return "messages";
  if (url === "/gifts" || url === "/library") return "gifts";
  if (url.startsWith("/game/")) return "sales";
  if (url.startsWith("/events") || url === "/friends") return "invitations";
  if (url === "/teammates") return "teams";
  if (url === "/support") return "support";
  if (url === "/admin" || url === "/settings" || url === "/notifications")
    return "admin";
  return "community";
}
export function notificationAllowed(state, to, url) {
  return state.settings[to]?.notifications?.[notificationKind(url)] !== false;
}
