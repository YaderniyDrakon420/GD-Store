import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { all, api } from "../api/client.mjs";
import { mapUser } from "../api/mapping.mjs";
import { useDemo } from "../demo/context";
import { Avatar, Gate, Head } from "./Studio";
import Icon from "../components/Icon";

export default function ServerFriends() {
  const { me } = useDemo();
  // Unmount all requests and drafts when the session changes.
  return <Gate>{me && <FriendsSession key={me.id} />}</Gate>;
}
function FriendsSession() {
  const { id } = useParams();
  const { state, me, act } = useDemo();
  const [tab, setTab] = useState("Друзья"),
    [search, setSearch] = useState("");
  const [found, setFound] = useState([]),
    [dialogs, setDialogs] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const rows = await all("chat/conversations/", {
          signal: controller.signal,
        });
        setDialogs(rows);
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setFound([]);
    const timer = setTimeout(async () => {
      if (search.trim().length < 2) return;
      try {
        setFound(
          (
            await all(`auth/users/?search=${encodeURIComponent(search)}`, {
              signal: controller.signal,
            })
          ).map(mapUser),
        );
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);
  const users = [
    ...new Map(
      [...state.users, ...dialogs.map((d) => mapUser(d.peer)), ...found].map(
        (u) => [u.id, u],
      ),
    ).values(),
  ].filter((u) => u.id !== me.id);
  const relation = (u) =>
    state.friends.find((f) => [f.from, f.to].includes(u.id));
  const shown = users.filter(
    (u) =>
      (u.name + " " + u.handle).toLowerCase().includes(search.toLowerCase()) &&
      (tab === "Найти игроков"
        ? found.some((f) => f.id === u.id)
        : relation(u)?.status ===
            { Друзья: "accepted", Заявки: "pending", Блокировки: "blocked" }[
              tab
            ] ||
          (tab === "Диалоги" && dialogs.some((d) => d.peer.id === u.id))),
  );
  const peer = users.find((u) => u.id === id);
  return (
    <>
      <Head
        eyebrow="ВМЕСТЕ ЛУЧШЕ"
        title="Ваша команда"
        text="Друзья, новые знакомства и разговоры между играми."
      />
      {error && (
        <p className="payment-error" role="alert">
          {error}
        </p>
      )}
      <div className="social-layout">
        <aside className="contact-panel">
          <div className="contact-search">
            <Icon name="search" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Имя или логин"
              aria-label="Поиск игроков"
            />
          </div>
          <div className="contact-tabs">
            {["Друзья", "Диалоги", "Заявки", "Найти игроков", "Блокировки"].map(
              (t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ),
            )}
          </div>
          <div className="contact-list">
            {shown.map((u) => {
              const f = relation(u),
                dialog = dialogs.find((d) => d.peer.id === u.id);
              return (
                <div
                  className={"contact " + (id === u.id ? "selected" : "")}
                  key={u.id}
                >
                  <Link className="contact-person" to={"/messages/" + u.id}>
                    <Avatar user={u} />
                    <span>
                      <strong>{u.name}</strong>
                      <small>
                        @{u.handle}
                        {dialog?.unread ? ` · ${dialog.unread} новых` : ""}
                      </small>
                    </span>
                  </Link>
                  {f?.status === "blocked" && f.blockedBy === me.id && (
                    <button
                      className="contact-action"
                      onClick={() => act({ type: "unfriend", friend: f.id })}
                    >
                      Снять
                    </button>
                  )}
                  {!f && (
                    <button
                      className="contact-action"
                      aria-label={"Добавить " + u.name}
                      onClick={() =>
                        act(
                          { type: "request", user: u.id },
                          "Заявка отправлена",
                        )
                      }
                    >
                      ＋
                    </button>
                  )}
                  {f?.status === "pending" && (
                    <div className="request-actions">
                      {f.to === me.id && (
                        <button
                          onClick={() => act({ type: "accept", friend: f.id })}
                        >
                          Принять
                        </button>
                      )}
                      <button
                        onClick={() => act({ type: "unfriend", friend: f.id })}
                      >
                        Отменить
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!shown.length && (
            <p className="muted contact-empty">
              {tab === "Найти игроков"
                ? "Введите минимум 2 символа логина друга."
                : "Здесь пока пусто."}
            </p>
          )}
        </aside>
        <section className="chat-panel">
          {id ? (
            <Conversation key={me.id + ":" + id} peerId={id} knownPeer={peer} />
          ) : (
            <div className="conversation-start">
              <div className="chat-orb">
                <Icon name="chat" size={45} />
              </div>
              <h2>
                Игры заканчиваются.
                <br />
                Разговоры продолжаются.
              </h2>
              <p>Выберите друга слева, чтобы открыть переписку.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function Conversation({ peerId, knownPeer }) {
  const { state, me, act } = useDemo();
  const [peer, setPeer] = useState(knownPeer),
    [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]),
    [next, setNext] = useState(null),
    [draft, setDraft] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const retry = useRef(null),
    alive = useRef(true),
    end = useRef(null),
    newest = useRef(0),
    loaded = useRef(0);
  const relation = state.friends.find((f) => [f.from, f.to].includes(peerId));
  const allowed = relation?.status === "accepted";
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let timer;
    async function run() {
      try {
        const [user, dialogs] = await Promise.all([
          api(`auth/users/${peerId}/`, { signal: controller.signal }),
          all("chat/conversations/", { signal: controller.signal }),
        ]);
        let dialog = dialogs.find((d) => d.peer.id === peerId);
        if (!dialog && allowed)
          dialog = await api("chat/conversations/", {
            method: "POST",
            body: { peer: peerId },
            signal: controller.signal,
          });
        if (controller.signal.aborted) return;
        setPeer(mapUser(user));
        setConversation(dialog || null);
        setLoading(false);
        if (!dialog) return;
        const poll = async () => {
          try {
            if (!document.hidden) {
              const path = `chat/conversations/${dialog.id}/messages/`;
              const page = loaded.current
                ? {
                    results: await all(path + "?after=" + loaded.current, {
                      signal: controller.signal,
                    }),
                  }
                : await api(path, { signal: controller.signal });
              if (controller.signal.aborted) return;
              // Latest page is authoritative. Older messages remain accessible through its cursor.
              setMessages((previous) =>
                [
                  ...new Map(
                    [...previous, ...page.results].map((m) => [m.id, m]),
                  ).values(),
                ].sort((a, b) => a.id - b.id),
              );
              if (!loaded.current) setNext(page.next);
              if (page.results.length)
                loaded.current = Math.max(
                  loaded.current,
                  ...page.results.map((m) => m.id),
                );
              if (loaded.current && document.hasFocus()) {
                const last = loaded.current;
                if (last > newest.current) {
                  await api(`chat/conversations/${dialog.id}/read/`, {
                    method: "POST",
                    body: { message_id: last },
                    signal: controller.signal,
                  });
                  newest.current = last;
                }
              }
              setError("");
            }
          } catch (e) {
            if (!controller.signal.aborted) setError(e.message);
          }
          if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
        };
        await poll();
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      }
    }
    run();
    return () => {
      alive.current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [peerId, allowed]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.at(-1)?.id]);
  async function older() {
    if (!next || busy) return;
    setBusy(true);
    try {
      const page = await api(next);
      if (!alive.current) return;
      setMessages((previous) =>
        [
          ...new Map(
            [...page.results, ...previous].map((m) => [m.id, m]),
          ).values(),
        ].sort((a, b) => a.id - b.id),
      );
      setNext(page.next);
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function send(e) {
    e.preventDefault();
    if (busy || !conversation || !draft.trim()) return;
    const text = draft.trim();
    if (retry.current?.text !== text)
      retry.current = { text, client_id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const message = await api(
        `chat/conversations/${conversation.id}/messages/`,
        { method: "POST", body: retry.current },
      );
      if (!alive.current) return;
      setMessages((previous) =>
        [
          ...new Map([...previous, message].map((m) => [m.id, m])).values(),
        ].sort((a, b) => a.id - b.id),
      );
      setDraft("");
      retry.current = null;
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="chat-header">
        <span className="author">
          <Avatar user={peer} />
          <span>
            <strong>{peer?.name || "Диалог"}</strong>
            <small>@{peer?.handle}</small>
          </span>
        </span>
        {allowed && (
          <div className="actions">
            <button
              className="link-button"
              onClick={() => act({ type: "unfriend", friend: relation.id })}
            >
              Удалить из друзей
            </button>
            <button
              className="link-button"
              onClick={() => act({ type: "block", user: peerId })}
            >
              Блокировать
            </button>
          </div>
        )}
      </div>
      {error && (
        <p className="payment-error" role="alert">
          {error}
        </p>
      )}
      <div className="messages" role="log" aria-label="История переписки">
        {next && (
          <button className="btn" disabled={busy} onClick={older}>
            Предыдущие сообщения
          </button>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={"message " + (m.sender === me.id ? "mine" : "")}
          >
            <p>{m.text}</p>
            <small>{new Date(m.created_at).toLocaleString("ru-RU")}</small>
          </div>
        ))}
        {!messages.length && (
          <div className="conversation-start">
            <h3>
              {loading
                ? "Загружаем переписку…"
                : allowed
                  ? "Начните с «Привет»"
                  : "Переписка доступна друзьям"}
            </h3>
          </div>
        )}
        <div ref={end} />
      </div>
      <form className="message-form" onSubmit={send}>
        <input
          aria-label="Сообщение другу"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!allowed || busy}
          placeholder="Написать сообщение…"
        />
        <button
          className="btn primary"
          disabled={!allowed || !conversation || busy || !draft.trim()}
        >
          {busy ? "…" : "Отправить"}
        </button>
      </form>
    </>
  );
}
