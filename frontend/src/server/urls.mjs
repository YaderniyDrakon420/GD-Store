const configuredBase = import.meta.env?.VITE_API_BASE_URL || "/api/v1/";

export function createApiLocation(base = configuredBase, origin = globalThis.location?.origin || "http://localhost") {
  // Добавляем / на конец base, чтобы new URL() не срезал /api/v1
  const normalizedBase = base.trim().endsWith("/") ? base.trim() : `${base.trim()}/`;
  const root = new URL(normalizedBase, origin);

  if (!["http:", "https:"].includes(root.protocol) || root.username || root.password || root.search || root.hash)
    throw Error("VITE_API_BASE_URL должен содержать HTTP(S)-адрес API без пароля и параметров.");

  const crossOrigin = root.origin !== origin;

  return {
    crossOrigin,
    endpoint(path) {
      // Формируем базовый роут для studio
      const studioRoot = new URL("studio/", root);
      const cleanPath = typeof path === "string" ? path.replace(/^\/+/, "") : "";
      const url = new URL(cleanPath, studioRoot);

      if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname))
        throw Error("Запрос за пределы настроенного API запрещён.");

      return crossOrigin ? url.href : url.pathname + url.search;
    },
    media(path) {
      return crossOrigin && typeof path === "string" && path.startsWith("/media/")
        ? new URL(path, root).href : path;
    },
  };
}

export const apiLocation = createApiLocation();
export const mediaUrl = (path) => apiLocation.media(path);
export const studioUrl = (path) => apiLocation.endpoint(path);