import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api.mjs";
import { setCatalog } from "./catalog.mjs";

const Context = createContext(null);
export function StoreProvider({ children, initialSnapshot }) {
  const [data, setData] = useState(() => {
    if (initialSnapshot) setCatalog(initialSnapshot);
    return initialSnapshot || null;
  });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const currentUser = useRef(data?.state.active);
  const inflight = useRef(new Map());
  const queue = useRef(Promise.resolve());
  const apply = useCallback((next) => {
    currentUser.current = next.state.active;
    setCatalog(next);
    setData(next);
    setError("");
  }, []);
  const refresh = useCallback(async (signal) => {
    const version = generation.current;
    const next = await api.request("snapshot/", { signal });
    if (generation.current === version) apply(next);
    return next;
  }, [apply]);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    let running = false;
    const poll = async () => {
      if (running || controller.signal.aborted) return;
      clearTimeout(timer);
      running = true;
      try { await refresh(controller.signal); }
      catch (e) { if (!controller.signal.aborted) setError(e.message); }
      finally { running = false; }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    const visible = () => { if (document.visibilityState === "visible") void poll(); };
    window.addEventListener("focus", poll);
    window.addEventListener("online", poll);
    window.addEventListener("pageshow", poll);
    document.addEventListener("visibilitychange", visible);
    poll();
    return () => {
      controller.abort(); clearTimeout(timer);
      window.removeEventListener("focus", poll);
      window.removeEventListener("online", poll);
      window.removeEventListener("pageshow", poll);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function account(action) {
    generation.current++;
    await queue.current;
    const result = await api.request("account/", { method: "POST", body: action });
    generation.current++;
    await refresh();
    return result;
  }
  function act(action, message) {
    const actor = currentUser.current;
    const signature = JSON.stringify([actor, action]);
    if (inflight.current.has(signature)) return inflight.current.get(signature);
    const run = async () => {
      if (actor !== currentUser.current) return false;
      generation.current++;
      try {
        if (action.type === "switch") {
          if (action.user !== null) throw Error("Войдите в другой аккаунт с его паролем.");
          await api.request("account/", { method: "POST", body: { mode: "logout" } });
          generation.current++;
          await refresh();
          return {};
        }
        if (!actor) throw Error("Сначала войдите в аккаунт.");
        if (["order-refund", "order-cancel"].includes(action.type)) {
          const method = action.type === "order-refund" ? "refund" : "cancel";
          await api.request("../store/orders/" + encodeURIComponent(action.order) + "/" + method + "/", { method: "POST", body: {}, user: actor });
          generation.current++;
          await refresh();
          if (message) setNotice(message);
          return {};
        }
        const next = await api.command(action, actor);
        generation.current++;
        if (actor === currentUser.current) apply(next);
        if (message) setNotice(message);
        return next.result;
      } catch (e) {
        setNotice(e.message);
        return false;
      }
    };
    const promise = queue.current.then(run).finally(() => inflight.current.delete(signature));
    inflight.current.set(signature, promise);
    queue.current = promise.catch(() => {});
    return promise;
  }
  async function uploadFile(file) {
    const body = new FormData();
    body.append("file", file);
    return api.request("uploads/", { method: "POST", body, user: currentUser.current });
  }
  if (!data) return <div className="empty" role="status"><h2>GD Store</h2><p>{error || "Загружаем магазин…"}</p></div>;
  return <Context.Provider value={{ state: data.state, me: data.state.users.find((u) => u.id === data.state.active),
    act, account, uploadFile, reset: () => act({ type: "preferences-reset" }, "Настройки сброшены"), notify: setNotice }}>
    {children}
    {(notice || error) && <div className="toast" role="status">{notice || error}<button onClick={() => { setNotice(""); setError(""); }} aria-label="Закрыть уведомление">×</button></div>}
  </Context.Provider>;
}
export const useStore = () => useContext(Context);
