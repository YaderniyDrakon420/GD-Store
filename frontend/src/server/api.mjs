export function messageOf(data) {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.map(messageOf).join(" ");
  if (data && typeof data === "object") return Object.values(data).map(messageOf).join(" ");
  return "Не удалось выполнить запрос.";
}

export function createApi(fetcher = (...args) => fetch(...args)) {
  let csrf = "";
  const uncertain = new Map();
  const pending = new Map();
  async function request(path, { method = "GET", body, key, user, signal } = {}) {
    const form = typeof FormData !== "undefined" && body instanceof FormData;
    const cookie = typeof document !== "undefined"
      ? document.cookie.split("; ").find((x) => x.startsWith("csrftoken="))?.slice(10) : "";
    const headers = { Accept: "application/json" };
    if (body && !form) headers["Content-Type"] = "application/json";
    if (method !== "GET") headers["X-CSRFToken"] = cookie || csrf;
    if (key) headers["Idempotency-Key"] = key;
    if (user) headers["X-Store-User"] = user;
    const response = await fetcher("/api/v1/studio/" + path, {
      method, headers, credentials: "same-origin", cache: "no-store", signal,
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
    let data;
    try { data = await response.json(); }
    catch { throw Error("Сервер вернул неполный ответ. Повторите запрос."); }
    if (!response.ok) {
      const error = Error(messageOf(data));
      error.status = response.status;
      throw error;
    }
    if (data.csrf) csrf = data.csrf;
    return data;
  }
  function command(action, user) {
    const signature = JSON.stringify([user, action]);
    if (pending.has(signature)) return pending.get(signature);
    // Retain the operation key after an ambiguous network failure so a retry
    // cannot charge the wallet twice.
    const key = uncertain.get(signature) || crypto.randomUUID();
    uncertain.set(signature, key);
    const promise = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await request("commands/", { method: "POST", body: action, key, user });
          uncertain.delete(signature);
          return data;
        } catch (error) {
          const rejected = error.status >= 400 && error.status < 500;
          if (rejected) uncertain.delete(signature);
          if (rejected || attempt === 1) throw error;
        }
      }
    })().finally(() => pending.delete(signature));
    pending.set(signature, promise);
    return promise;
  }
  return { request, command };
}
export const api = createApi();
