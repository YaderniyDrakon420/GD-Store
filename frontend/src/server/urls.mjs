const configuredBase = import.meta.env?.VITE_API_BASE_URL || "/api/v1/";

export function createApiLocation(base = configuredBase, origin = globalThis.location?.origin || "http://localhost") {
  const root = new URL(base.replace(/\/+$/, "") + "/", origin);
  if (!["http:", "https:"].includes(root.protocol) || root.username || root.password || root.search || root.hash)
    throw Error("VITE_API_BASE_URL должен содержать HTTP(S)-адрес API без пароля и параметров.");
  const crossOrigin = root.origin !== origin;
  return {
    crossOrigin,
    endpoint(path) {
      const url = new URL(path, new URL("studio/", root));
      if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname))
        throw Error("Запрос за пределы настроенного API запрещён.");
      return crossOrigin ? url.href : url.pathname + url.search;
    },
    media(path) {
      // Bundled /art files stay on the frontend; uploaded /media lives on Django.
      return crossOrigin && typeof path === "string" && path.startsWith("/media/")
        ? new URL(path, root).href : path;
    },
  };
}

export const apiLocation = createApiLocation();
export const mediaUrl = (path) => apiLocation.media(path);
export const studioUrl = (path) => apiLocation.endpoint(path);
