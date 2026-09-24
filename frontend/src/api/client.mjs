// Гарантируем корректный дефолтный URL
const DEFAULT_API_URL = "https://gd-store-production.up.railway.app/api/v1/";

const envUrl = import.meta.env?.VITE_API_URL || import.meta.env?.VITE_API_BASE_URL;
const rawBase = (envUrl && envUrl.trim() !== "") ? envUrl : DEFAULT_API_URL;

// Проверяем наличие /api/v1 и слеша на конце
let formattedBase = rawBase.trim();
if (!formattedBase.includes("/api/v1")) {
  formattedBase = formattedBase.replace(/\/+$/, "") + "/api/v1/";
}
const base = formattedBase.endsWith("/") ? formattedBase : `${formattedBase}/`;

let tokens = null;
try {
  tokens = JSON.parse(sessionStorage.getItem("gd-api-session") || "null");
} catch {
  /* anonymous */
}

let refreshing = null;
let generation = 0;

export function setTokens(value, refreshed = false) {
  if (!refreshed) generation += 1;
  tokens = value;
  try {
    if (value) sessionStorage.setItem("gd-api-session", JSON.stringify(value));
    else sessionStorage.removeItem("gd-api-session");
  } catch {
    /* in-memory session */
  }
}

export const hasSession = () => !!tokens?.access;

function message(data) {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.map(message).join(" ");
  if (data && typeof data === "object")
    return Object.entries(data)
      .map(
        ([key, value]) =>
          (key === "detail" || key === "non_field_errors" ? "" : key + ": ") +
          message(value),
      )
      .join(" ");
  return "Ошибка запроса";
}

export async function api(
  path,
  { method = "GET", body, signal, anonymous = false } = {},
  retry = true,
) {
  const version = generation;

  // Формируем абсолютный URL бэкенда Railway
  let targetUrl;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    targetUrl = new URL(path);
  } else {
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    const absoluteBase = base.startsWith("http") ? base : `https://${base}`;
    targetUrl = new URL(cleanPath, absoluteBase);
  }

  let response;
  try {
    response = await fetch(targetUrl.toString(), {
      method,
      signal,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(!anonymous && tokens?.access
          ? { Authorization: `Bearer ${tokens.access}` }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw Error("Сервер недоступен. Проверьте соединение и повторите запрос.");
  }

  if (
    response.status === 401 &&
    !anonymous &&
    retry &&
    tokens?.refresh &&
    version === generation
  ) {
    if (!refreshing) {
      refreshing = api(
        "auth/login/refresh/",
        { method: "POST", body: { refresh: tokens.refresh }, anonymous: true },
        false,
      )
        .then((value) => {
          if (generation === version) setTokens({ ...tokens, ...value }, true);
        })
        .catch((error) => {
          if (generation === version && [400, 401].includes(error.status)) {
            setTokens(null);
            globalThis.dispatchEvent?.(new Event("gd-session-expired"));
          }
          throw error;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    await refreshing;
    if (generation !== version)
      throw Error("Сессия изменилась. Повторите действие.");
    if (!tokens) throw Error("Сессия завершена. Войдите снова.");
    return api(path, { method, body, signal, anonymous }, false);
  }

  if (!anonymous && generation !== version)
    throw Error("Сессия изменилась. Повторите действие.");

  const data =
    response.status === 204 ? null : await response.json().catch(() => null);

  if (response.status === 401 && !anonymous) {
    setTokens(null);
    globalThis.dispatchEvent?.(new Event("gd-session-expired"));
  }

  if (!response.ok) {
    const error = new Error(message(data) || `Ошибка ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

export async function all(path, options) {
  const rows = [];
  let next = path;
  while (next) {
    const page = await api(next, options);
    rows.push(...(Array.isArray(page) ? page : page.results || []));
    next = Array.isArray(page) ? null : page.next;
  }
  return rows;
}