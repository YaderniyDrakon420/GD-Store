export function messageOf(data) {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.map(messageOf).join(" ");
  if (data && typeof data === "object") return Object.values(data).map(messageOf).join(" ");
  return "Не удалось выполнить запрос.";
}

// Нормализуем хост Railway, исключая дублирование /api/v1
const rawEnvUrl = import.meta.env?.VITE_API_URL || import.meta.env?.VITE_API_BASE_URL || "https://gd-store-production.up.railway.app";
const cleanEnvUrl = rawEnvUrl.trim().replace(/\/+$/, "");
const API_BASE_URL = cleanEnvUrl.endsWith("/api/v1") 
  ? cleanEnvUrl.slice(0, -7) 
  : cleanEnvUrl;

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

    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    const fullUrl = `${API_BASE_URL}/api/v1/studio/${cleanPath}`;

    const response = await fetcher(fullUrl, {
      method, headers, cache: "no-store", signal,
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

export let games = [];
export let cosmetics = [];

export function setCatalog(data) {
  games = data.games;
  cosmetics = data.cosmetics;
}

export const price = (game) => game?.finalPrice ?? Math.round((game?.price || 0) * (1 - (game?.discount || 0) / 100) * 100) / 100;