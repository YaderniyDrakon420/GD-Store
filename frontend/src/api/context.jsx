import { createContext, useContext, useEffect, useRef, useState } from "react";
import { all, api, hasSession, setTokens } from "./client.mjs";
import { emptyState, mapGame, mapUser } from "./mapping.mjs";
const Context = createContext(null);
export function ApiProvider({ children }) {
  const [state, setState] = useState(emptyState),
    [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, notify] = useState("");
  const current = useRef(state),
    revision = useRef(0),
    mutations = useRef(new Set());
  const rows = useRef({ cart: [], wishlist: [] });
  current.current = state;
  function logout() {
    revision.current += 1;
    setTokens(null);
    rows.current = { cart: [], wishlist: [] };
    const next = emptyState();
    current.current = next;
    setState(next);
    setLoading(false);
    setError("");
  }
  async function refresh() {
    const version = ++revision.current;
    setError("");
    try {
      const catalog = await all("catalog/games/?page_size=100", {
        anonymous: true,
      });
      let me = null;
      if (hasSession()) me = await api("auth/me/");
      const next = emptyState();
      next.reviews = current.current.reviews;
      let related = [];
      if (me) {
        const [cart, wishlist, library, orders, friends] = await Promise.all([
          all("store/cart/"),
          all("store/wishlist/"),
          all("library/"),
          all("store/orders/"),
          all("auth/friends/"),
        ]);
        next.active = me.id;
        next.users = [
          ...new Map(
            [...friends.flatMap((f) => [f.from_user, f.to_user]), me].map(
              (u) => [u.id, mapUser(u)],
            ),
          ).values(),
        ];
        next.friends = friends.map((f) => ({
          id: f.id,
          from: f.from_user.id,
          to: f.to_user.id,
          status: f.status,
          blockedBy: f.blocked_by,
        }));
        next.cart[me.id] = cart.map((i) => i.game.slug);
        next.wishlist[me.id] = wishlist.map((i) => i.game.slug);
        next.library[me.id] = library.map((i) => i.game.slug);
        next.settings = current.current.settings;
        next.comparison = current.current.comparison;
        next.orders = orders;
        related = [
          ...cart,
          ...wishlist,
          ...library,
          ...orders.flatMap((o) => o.items),
        ].map((i) => i.game);
        if (version === revision.current) rows.current = { cart, wishlist };
      }
      if (version !== revision.current) return;
      setGames([
        ...new Map(
          [
            ...related.map((g) => ({ ...g, storeVisible: false })),
            ...catalog.map((g) => ({ ...g, storeVisible: true })),
          ].map((g) => [g.id, mapGame(g)]),
        ).values(),
      ]);
      current.current = next;
      setState(next);
    } catch (e) {
      if (version === revision.current) setError(e.message);
      throw e;
    } finally {
      if (version === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    refresh().catch(() => {});
    const expire = () => {
      logout();
      notify("Сессия завершена. Войдите снова.");
    };
    window.addEventListener("gd-session-expired", expire);
    return () => {
      revision.current += 1;
      window.removeEventListener("gd-session-expired", expire);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => notify(""), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  async function account(action) {
    if (action.mode === "reset")
      throw Error(
        "Восстановление пароля пока не подключено. Обратитесь к администратору.",
      );
    if (action.mode === "register")
      await api("auth/register/", {
        method: "POST",
        anonymous: true,
        body: {
          username: action.handle,
          email: action.email,
          display_name: action.name,
          password: action.password,
        },
      });
    const tokens = await api("auth/login/", {
      method: "POST",
      anonymous: true,
      body: {
        username: action.mode === "register" ? action.handle : action.login,
        password: action.password,
      },
    });
    current.current = emptyState();
    setState(current.current);
    setTokens(tokens);
    await refresh();
    return {};
  }
  async function act(action, success) {
    if (action.type === "switch" && !action.user) {
      logout();
      return true;
    }
    const me = current.current.active;
    if (!me) {
      notify("Войдите в аккаунт, чтобы продолжить.");
      return false;
    }
    const key =
      action.type + ":" + (action.game || action.friend || action.user || "");
    if (mutations.current.has(key)) return false;
    mutations.current.add(key);
    try {
      if (["cart", "wishlist"].includes(action.type)) {
        const game = games.find((g) => g.id === action.game);
        if (!game) throw Error("Игра недоступна.");
        const item = rows.current[action.type].find(
          (i) => i.game.id === game.apiId,
        );
        await api(`store/${action.type}/${item ? item.id + "/" : ""}`, {
          method: item ? "DELETE" : "POST",
          ...(item ? {} : { body: { game: game.apiId } }),
        });
      } else if (action.type === "request")
        await api("auth/friends/", {
          method: "POST",
          body: { to_user: action.user },
        });
      else if (action.type === "accept")
        await api(`auth/friends/${action.friend}/accept/`, { method: "POST" });
      else if (action.type === "unfriend")
        await api(`auth/friends/${action.friend}/`, { method: "DELETE" });
      else if (action.type === "block") {
        const f = current.current.friends.find((f) =>
          [f.from, f.to].includes(action.user),
        );
        if (!f) throw Error("Сначала выберите существующую связь.");
        await api(`auth/friends/${f.id}/block/`, { method: "POST" });
      } else if (action.type === "profile")
        await api("auth/me/", {
          method: "PATCH",
          body: { display_name: action.name },
        });
      else if (action.type === "review") {
        const game = games.find((g) => g.id === action.game);
        await api("reviews/", {
          method: "POST",
          body: {
            game: game.apiId,
            text: action.text,
            is_recommended: action.positive,
          },
        });
        await loadReviews(game.id);
        if (success) notify(success);
        return true;
      } else if (
        ["compare", "compare-clear", "settings"].includes(action.type)
      ) {
        setState((s) => {
          if (action.type === "settings")
            return {
              ...s,
              settings: {
                ...s.settings,
                [me]: { ...s.settings[me], ...action.values },
              },
            };
          const ids = s.comparison[me] || [];
          return {
            ...s,
            comparison: {
              ...s.comparison,
              [me]:
                action.type === "compare-clear"
                  ? []
                  : ids.includes(action.game)
                    ? ids.filter((x) => x !== action.game)
                    : [...ids, action.game].slice(-4),
            },
          };
        });
        return true;
      } else throw Error("Эта функция ещё не подключена к серверу.");
      await refresh();
      if (success) notify(success);
      return true;
    } catch (e) {
      notify(e.message);
      return false;
    } finally {
      mutations.current.delete(key);
    }
  }
  async function loadReviews(slug) {
    const game = games.find((g) => g.id === slug);
    if (!game) return;
    const version = revision.current;
    const reviews = await all(`reviews/?game=${game.apiId}`, {
      anonymous: true,
    });
    if (version !== revision.current) return;
    setState((s) => ({
      ...s,
      users: [
        ...new Map(
          [...reviews.map((r) => mapUser(r.user)), ...s.users].map((u) => [
            u.id,
            u,
          ]),
        ).values(),
      ],
      reviews: [
        ...s.reviews.filter((r) => r.game !== slug),
        ...reviews.map((r) => ({
          id: r.id,
          game: slug,
          author: r.user.id,
          text: r.text,
          positive: r.is_recommended,
          at: r.created_at,
          helpful: [],
        })),
      ],
    }));
  }
  async function loadGame(slug) {
    const value = mapGame(
      await api(`catalog/games/${encodeURIComponent(slug)}/`, {
        anonymous: true,
      }),
    );
    setGames((items) => [...items.filter((g) => g.id !== slug), value]);
  }
  return (
    <Context.Provider
      value={{
        state,
        games,
        me: state.users.find((u) => u.id === state.active),
        act,
        account,
        refresh,
        logout,
        loadGame,
        loadReviews,
        notify,
        loading,
        error,
        reset: logout,
      }}
    >
      {error && (
        <div className="payment-error" role="alert">
          {error}{" "}
          <button className="btn" onClick={() => refresh().catch(() => {})}>
            Повторить
          </button>
        </div>
      )}
      {children}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button onClick={() => notify("")}>×</button>
        </div>
      )}
    </Context.Provider>
  );
}
export const useApi = () => useContext(Context);
