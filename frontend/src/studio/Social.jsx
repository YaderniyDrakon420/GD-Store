import { canSee } from "../demo/extras.mjs";
import { ReportButton } from "./Reports";
import { useState, useEffect, useRef } from "react";
import {
  Link,
  useParams,
  useSearchParams,
  useNavigate,
} from "react-router-dom";
import { useDemo } from "../demo/context";
import { games } from "../server/catalog.mjs";
import { Art, Avatar, Empty, Gate, Head, NotFound } from "./Studio";
import { Modal, Author, date } from "./Personal";
import Icon from "../components/Icon";
export function Friends() {
  const { id } = useParams();
  const { state, me, act } = useDemo();
  const [tab, setTab] = useState("Друзья"),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState("");
  const end = useRef(null);
  const nav = useNavigate();
  const my = state.friends.filter((f) => [f.from, f.to].includes(me?.id));
  const users = state.users.filter(
    (u) =>
      u.id !== me?.id &&
      (u.name + " " + u.handle).toLowerCase().includes(search.toLowerCase()),
  );
  const relations = (u) => my.find((f) => [f.from, f.to].includes(u.id));
  const shown = users.filter(
    (u) =>
      tab === "Найти игроков" ||
      (tab === "Друзья"
        ? relations(u)?.status === "accepted"
        : tab === "Заявки"
          ? relations(u)?.status === "pending"
          : relations(u)?.status === "blocked"),
  );
  const peer = state.users.find((u) => u.id === id);
  const allowed = peer && relations(peer)?.status === "accepted";
  const messages = state.messages.filter(
    (m) =>
      (m.from === me?.id && m.to === id) || (m.to === me?.id && m.from === id),
  );
  useEffect(() => {
    setDraft("");
  }, [id, state.active]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, id]);
  return (
    <Gate>
      <Head
        eyebrow="ВМЕСТЕ ЛУЧШЕ"
        title="Ваша команда"
        text="Друзья, новые знакомства и разговоры между играми."
      >
        <Link className="btn" to="/events">
          Запланировать игровой вечер ↗
        </Link>
      </Head>
      <div className="social-layout">
        <aside className="contact-panel">
          <div className="contact-search">
            <Icon name="search" size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Имя или логин"
              aria-label="Поиск игроков"
            />
          </div>
          <div className="contact-tabs">
            {["Друзья", "Заявки", "Найти игроков", "Блокировки"].map((t) => (
              <button
                className={tab === t ? "active" : ""}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
                {t === "Заявки" && (
                  <small>
                    {
                      my.filter(
                        (f) => f.status === "pending" && f.to === me?.id,
                      ).length
                    }
                  </small>
                )}
              </button>
            ))}
          </div>
          <div className="contact-list">
            {shown.map((u) => {
              const f = relations(u);
              return (
                <div
                  className={"contact " + (id === u.id ? "selected" : "")}
                  key={u.id}
                >
                  <button
                    className="contact-person"
                    onClick={() => nav("/messages/" + u.id)}
                  >
                    <Avatar user={u} />
                    <span>
                      <strong>{u.name}</strong>
                      <small>
                        <i className={"presence " + u.status} />{" "}
                        {u.status === "playing"
                          ? "В игре · ORBITAL"
                          : u.status === "online"
                            ? "В сети"
                            : "Не в сети"}
                      </small>
                    </span>
                  </button>
                  {!f ? (
                    <button
                      className="contact-action"
                      aria-label={"Добавить " + u.name}
                      onClick={async () =>
                        await act(
                          { type: "request", user: u.id },
                          "Заявка отправлена",
                        )
                      }
                    >
                      ＋
                    </button>
                  ) : f.status === "pending" ? (
                    <div className="request-actions">
                      {f.to === me?.id ? (
                        <button
                          onClick={async () =>
                            await act(
                              { type: "accept", friend: f.id },
                              "Теперь вы друзья",
                            )
                          }
                        >
                          Принять
                        </button>
                      ) : (
                        <small>Отправлена</small>
                      )}
                      <button
                        aria-label="Отклонить или отменить заявку"
                        onClick={async () => await act({ type: "unfriend", friend: f.id })}
                      >
                        ×
                      </button>
                    </div>
                  ) : f.status === "blocked" && f.blockedBy === me?.id ? (
                    <button
                      className="contact-action"
                      onClick={async () =>
                        await act(
                          { type: "unfriend", friend: f.id },
                          "Блокировка снята",
                        )
                      }
                    >
                      Снять
                    </button>
                  ) : null}
                </div>
              );
            })}
            {!shown.length && (
              <p className="muted contact-empty">
                {search
                  ? "Никого не нашли. Попробуйте другой логин."
                  : "Здесь пока пусто. Откройте «Найти игроков»."}
              </p>
            )}
          </div>
          <p className="chat-demo-note">
            Демопрофили можно переключать в настройках. Ответы не генерируются
            автоматически.
          </p>
        </aside>
        <section className="chat-panel">
          {peer ? (
            <>
              <div className="chat-header">
                <Link to={"/profile/" + peer.id} className="author">
                  <Avatar user={peer} />
                  <span>
                    <strong>{peer.name}</strong>
                    <small>@{peer.handle}</small>
                  </span>
                </Link>
                {allowed && (
                  <div className="actions">
                    <button
                      className="link-button"
                      onClick={async () =>
                        await act(
                          { type: "unfriend", friend: relations(peer).id },
                          "Удалён из друзей",
                        )
                      }
                    >
                      Удалить из друзей
                    </button>
                    <button
                      className="link-button"
                      onClick={async () =>
                        await act(
                          { type: "block", user: peer.id },
                          "Пользователь заблокирован",
                        )
                      }
                    >
                      Блокировать
                    </button>
                  </div>
                )}
              </div>
              {allowed ? (
                <>
                  <div
                    className="messages"
                    role="log"
                    aria-label="История переписки"
                  >
                    <p className="chat-date">
                      Личная переписка · доступна участникам диалога
                    </p>
                    {messages.map((m) => (
                      <div
                        className={
                          "message " + (m.from === me?.id ? "mine" : "")
                        }
                        key={m.id}
                      >
                        <p>{m.text}</p>
                        <ReportButton user={m.from} message={m.id} compact />
                        <small>
                          {date(m.at)} ·{" "}
                          {new Date(m.at).toLocaleTimeString("ru-RU", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      </div>
                    ))}
                    {!messages.length && (
                      <div className="conversation-start">
                        <Icon name="chat" size={35} />
                        <h3>Начните с «Привет»</h3>
                        <p>Хорошая команда начинается с разговора.</p>
                      </div>
                    )}
                    <div ref={end} />
                  </div>
                  <form
                    className="message-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await act({ type: "message", user: peer.id, text: draft }))
                        setDraft("");
                    }}
                  >
                    <input
                      maxLength={2000}
                      required
                      aria-label="Сообщение другу"
                      placeholder={"Написать " + peer.name + "…"}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <button
                      className="btn primary"
                      disabled={!draft.trim()}
                      aria-label="Отправить сообщение"
                    >
                      <Icon name="arrow" />
                    </button>
                  </form>
                </>
              ) : (
                <Empty
                  title="Сначала подружимся"
                  text="Переписка доступна после принятия заявки. Заблокированные игроки не могут отправлять сообщения."
                  link={"/profile/" + peer.id}
                  label="Открыть профиль"
                />
              )}
            </>
          ) : (
            <div className="conversation-start">
              <div className="chat-orb">
                <Icon name="chat" size={45} />
              </div>
              <p className="eyebrow">STAY CONNECTED</p>
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
    </Gate>
  );
}
export function GameSelect({ value, onChange, all = false }) {
  return (
    <select
      aria-label="Игра"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {all && <option value="">Все игры</option>}
      {games.map((g) => (
        <option key={g.id} value={g.id}>
          {g.title}
        </option>
      ))}
    </select>
  );
}
export function Community() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { state, me, act } = useDemo();
  const [game, setGame] = useState(params.get("game") || ""),
    [search, setSearch] = useState(""),
    [create, setCreate] = useState(false),
    [reply, setReply] = useState(""),
    [editing, setEditing] = useState(false);
  const nav = useNavigate();
  const topic = state.topics.find((t) => t.id === id && canSee(t, me));
  const found = state.topics.filter(
    (t) =>
      canSee(t, me) &&
      (!game || t.game === game) &&
      (t.title + " " + t.body).toLowerCase().includes(search.toLowerCase()),
  );
  if (id && !topic) return <NotFound />;
  return (
    <>
      <Head
        eyebrow="COMMUNITY HUB"
        title={id ? "Есть о чём поговорить" : "Место встречи игроков"}
        text="Делитесь находками, задавайте вопросы и собирайте команду."
      >
        <button
          className="btn primary"
          onClick={() => (me ? setCreate(true) : nav("/login"))}
        >
          ＋ Новое обсуждение
        </button>
      </Head>
      {topic ? (
        <>
          <Link className="back-link" to="/community">
            ← Все обсуждения
          </Link>
          <article className="panel topic-detail">
            {(topic.hidden || topic.locked) && (
              <p className="moderation-label">
                {topic.hidden
                  ? "Скрыто модератором"
                  : "Ответы закрыты модератором"}
              </p>
            )}
            <p className="eyebrow">
              {games.find((g) => g.id === topic.game)?.title}
            </p>
            <h1>{topic.title}</h1>
            <div className="post-meta">
              <Author id={topic.author} />
              <span>{date(topic.at)}</span>
              {topic.author === me?.id && (
                <button
                  className="link-button"
                  onClick={() => setEditing(true)}
                >
                  Редактировать
                </button>
              )}
              {topic.author === me?.id && (
                <button
                  className="link-button"
                  onClick={async () => {
                    await act({ type: "delete-topic", topic: id });
                    nav("/community");
                  }}
                >
                  Удалить тему
                </button>
              )}
            </div>
            <p className="post-body">{topic.body}</p>
          </article>
          <h2 className="space">Ответы · {topic.replies.length}</h2>
          {topic.replies.map((r) => (
            <div className="panel space" key={r.id}>
              <div className="post-meta">
                <Author id={r.author} />
                <span>{date(r.at)}</span>
              </div>
              <p className="post-body">{r.text}</p>
            </div>
          ))}
          <Gate>
            <form
              className="panel form-stack space"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await act(
                    { type: "reply", topic: id, text: reply },
                    "Ответ добавлен",
                  )
                )
                  setReply("");
              }}
            >
              <label>
                Присоединиться к обсуждению
                <textarea
                  rows={3}
                  maxLength={2000}
                  required
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
              </label>
              <button
                className="btn primary"
                disabled={topic.locked || topic.hidden}
              >
                Отправить ответ
              </button>
            </form>
          </Gate>
        </>
      ) : (
        <>
          <div className="hub-banner">
            <Art game={games[0]} />
            <div>
              <p className="eyebrow">ОТКРЫВАЙТЕ ВМЕСТЕ</p>
              <h2>
                У каждого мира
                <br />
                есть своё сообщество.
              </h2>
            </div>
          </div>
          <div className="collection-tools">
            <input
              aria-label="Поиск обсуждений"
              placeholder="Найти обсуждение"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <GameSelect value={game} onChange={setGame} all />
          </div>
          <div className="topic-list">
            {found.map((t) => (
              <Link className="topic" to={"/community/" + t.id} key={t.id}>
                <span className="topic-icon">
                  <Icon name="chat" size={24} />
                </span>
                <div className="grow">
                  <p className="eyebrow">
                    {games.find((g) => g.id === t.game)?.title}
                  </p>
                  <h3>{t.title}</h3>
                  <p className="muted">
                    {state.users.find((u) => u.id === t.author)?.name} ·{" "}
                    {date(t.at)}
                  </p>
                </div>
                <div className="reply-count">
                  <strong>{t.replies.length}</strong>
                  <small>ответов</small>
                </div>
                <Icon name="chevron" />
              </Link>
            ))}
          </div>
          {!found.length && (
            <Empty
              title="Пока тихо"
              text="Создайте обсуждение или измените поиск."
              link="/community"
              label="Все обсуждения"
            />
          )}
        </>
      )}
      {editing && (
        <Modal
          title="Редактировать обсуждение"
          onClose={() => setEditing(false)}
        >
          <TopicForm
            initial={topic}
            onSave={async (v) => {
              if (
                await act(
                  { type: "edit-topic", topic: id, ...v },
                  "Изменения сохранены",
                )
              )
                setEditing(false);
            }}
          />
        </Modal>
      )}
      {create && (
        <Modal title="Новое обсуждение" onClose={() => setCreate(false)}>
          <TopicForm
            onSave={async (v) => {
              const newId = crypto.randomUUID();
              if (
                await act({ type: "topic", id: newId, ...v }, "Обсуждение создано")
              ) {
                setCreate(false);
                nav("/community/" + newId);
              }
            }}
          />
        </Modal>
      )}
    </>
  );
}
function TopicForm({ onSave, initial }) {
  const [title, setTitle] = useState(initial?.title || ""),
    [body, setBody] = useState(initial?.body || ""),
    [game, setGame] = useState(initial?.game || games[0].id);
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, body, game });
      }}
    >
      <label>
        Игра
        <GameSelect value={game} onChange={setGame} />
      </label>
      <label>
        Заголовок
        <input
          maxLength={120}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        О чём поговорим?
        <textarea
          maxLength={5000}
          required
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <button className="btn primary">Опубликовать</button>
    </form>
  );
}
export function Workshop() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { state, me, act } = useDemo();
  const nav = useNavigate();
  const [category, setCategory] = useState("Все работы"),
    [game, setGame] = useState(params.get("game") || ""),
    [search, setSearch] = useState(""),
    [create, setCreate] = useState(false),
    [editing, setEditing] = useState(false);
  const item = state.mods.find((m) => m.id === id && canSee(m, me));
  const subscribed = state.subscriptions[me?.id] || [];
  const found = state.mods.filter(
    (m) =>
      canSee(m, me) &&
      (!game || m.game === game) &&
      m.title.toLowerCase().includes(search.toLowerCase()) &&
      (category === "Все работы" ||
        (category === "Подписки"
          ? subscribed.includes(m.id)
          : category === "Мои работы"
            ? m.author === me?.id
            : m.category === category)),
  );
  if (id && !item) return <NotFound />;
  return (
    <>
      <Head
        eyebrow="BUILT BY PLAYERS"
        title="Мастерская миров"
        text="Новые идеи для любимых игр. Создавайте, делитесь, вдохновляйтесь."
      >
        <button
          className="btn primary"
          onClick={() => (me ? setCreate(true) : nav("/login"))}
        >
          ＋ Добавить работу
        </button>
      </Head>
      {item ? (
        <>
          <Link className="back-link" to="/workshop">
            ← Все работы
          </Link>
          {item.hidden && (
            <p className="moderation-label">Работа скрыта модератором</p>
          )}
          <div className="detail-layout">
            <div>
              <div className="work-detail-art">
                <Art game={games.find((g) => g.id === item.game)} />
                <span>{item.title}</span>
              </div>
              <div className="panel space prose">
                <h2>Об этой работе</h2>
                <p>{item.description}</p>
                {item.fileName && (
                  <p className="muted">
                    Файл: {item.fileName} · {Math.ceil((item.fileSize || 0) / 1024)} КБ
                  </p>
                )}
                <p className="fine">
                  Работа хранится на сервере. Скачайте архив и установите его
                  по инструкции автора.
                </p>
              </div>
            </div>
            <aside className="panel purchase">
              <p className="eyebrow">
                {item.category} / V{item.version}
              </p>
              <h2>{item.title}</h2>
              <Author id={item.author} />
              <p className="muted">
                {games.find((g) => g.id === item.game)?.title}
              </p>
              <button
                className={
                  "btn " + (subscribed.includes(item.id) ? "" : "primary")
                }
                onClick={async () =>
                  await act(
                    { type: "subscribe", mod: item.id },
                    subscribed.includes(item.id)
                      ? "Подписка отменена"
                      : "Добавлено в подписки",
                  )
                }
              >
                {subscribed.includes(item.id)
                  ? "Вы подписаны ✓"
                  : "＋ Подписаться"}
              </button>
              <p className="fine">
                {item.subscribers} подписчиков
              </p>
              {me && item.fileName && <a className="btn" href={"/api/v1/studio/mods/" + item.id + "/download/"}>Скачать ZIP</a>}
              {item.author === me?.id && (
                <div className="actions">
                  <button className="btn" onClick={() => setEditing(true)}>
                    Изменить
                  </button>
                  <button
                    className="btn danger"
                    onClick={async () => {
                      if (await act({ type: "delete-mod", mod: id }, "Работа удалена")) nav("/workshop");
                    }}
                  >
                    Удалить
                  </button>
                </div>
              )}
            </aside>
          </div>
        </>
      ) : (
        <>
          <div className="collection-tools">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Поиск в мастерской"
              placeholder="Найти что-то необычное"
            />
            <GameSelect value={game} onChange={setGame} all />
          </div>
          <div className="genre-row">
            {[
              "Все работы",
              "Визуал",
              "Предметы",
              "Карты",
              "Подписки",
              "Мои работы",
            ].map((c) => (
              <button
                className={"chip " + (category === c ? "active" : "")}
                key={c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="game-grid workshop-grid">
            {found.map((m) => (
              <article className="game-card" key={m.id}>
                <Link to={"/workshop/" + m.id} className="game-art">
                  <Art game={games.find((g) => g.id === m.game)} />
                  <span className="mod-category">
                    {m.category} / {m.version}
                  </span>
                </Link>
                <div className="card-info">
                  <p className="eyebrow">
                    {games.find((g) => g.id === m.game)?.title}
                  </p>
                  <Link to={"/workshop/" + m.id}>
                    <h3>{m.title}</h3>
                  </Link>
                  <p className="mod-description">{m.description}</p>
                  <div className="mod-bottom">
                    <Author id={m.author} />
                    <button
                      className={
                        "chip " + (subscribed.includes(m.id) ? "active" : "")
                      }
                      aria-label={"Подписка: " + m.title}
                      onClick={async () =>
                        await act(
                          { type: "subscribe", mod: m.id },
                          subscribed.includes(m.id)
                            ? "Подписка отменена"
                            : "Добавлено в подписки",
                        )
                      }
                    >
                      {subscribed.includes(m.id) ? "✓" : "＋"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!found.length && (
            <Empty
              title="Здесь будут ваши находки"
              text="Измените фильтр или добавьте свою работу."
              link="/workshop"
              label="К мастерской"
            />
          )}
        </>
      )}
      {editing && (
        <Modal title="Редактировать работу" onClose={() => setEditing(false)}>
          <ModForm
            initial={item}
            onSave={async (v) => {
              if (
                await act({ ...v, type: "edit-mod", mod: id }, "Изменения сохранены")
              )
                setEditing(false);
            }}
          />
        </Modal>
      )}
      {create && (
        <Modal title="Добавить работу" onClose={() => setCreate(false)}>
          <ModForm
            onSave={async (v) => {
              const newId = crypto.randomUUID();
              if (
                await act(
                  { type: "mod", id: newId, ...v },
                  "Карточка работы сохранена",
                )
              ) {
                setCreate(false);
                nav("/workshop/" + newId);
              }
            }}
          />
        </Modal>
      )}
    </>
  );
}
function ModForm({ onSave, initial }) {
  const { uploadFile, notify } = useDemo();
  const [file, setFile] = useState(null);
  const [uploaded, setUploaded] = useState(null);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState(
    initial || {
      title: "",
      description: "",
      game: "orbital",
      category: "Визуал",
      version: "1.0",
      fileName: "",
    },
  );
  const set = (k, v) => setValues({ ...values, [k]: v });
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          let info = uploaded;
          if (file && !info) {
            info = await uploadFile(file);
            setUploaded(info);
          }
          await onSave({ ...values, upload: info?.id });
        } catch (e) { notify(e.message); }
        finally { setBusy(false); }
      }}
    >
      <label>
        Название
        <input
          required
          maxLength={100}
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <div className="form-grid">
        <label>
          Игра
          <GameSelect value={values.game} onChange={(v) => set("game", v)} />
        </label>
        <label>
          Категория
          <select
            value={values.category}
            onChange={(e) => set("category", e.target.value)}
          >
            {["Визуал", "Предметы", "Карты"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Описание
        <textarea
          required
          maxLength={2000}
          rows={4}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <label>
        Версия
        <input
          required
          maxLength={20}
          value={values.version}
          onChange={(e) => set("version", e.target.value)}
        />
      </label>
      <label>
        ZIP-файл {initial ? "(для замены)" : "(до 10 МБ)"}
        <input
          type="file"
          accept=".zip"
          required={!initial}
          onChange={(e) => { setFile(e.target.files?.[0] || null); setUploaded(null); }}
        />
      </label>
      <p className="fine">
        Архив сохраняется на сервере. Его смогут скачать вошедшие пользователи.
      </p>
      <button className="btn primary" disabled={busy}>{busy ? "Загружаем…" : "Сохранить работу"}</button>
    </form>
  );
}
