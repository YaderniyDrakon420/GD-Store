import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { games } from "../server/catalog.mjs";
import { useDemo } from "../demo/context";
import { Head, NotFound } from "./Studio";
import { Author, Modal, date } from "./Personal";
import { ReviewList } from "./ServiceFeatures";
import { Attachment } from "./LiveChat";

const categories = {
  news: "Новости",
  guide: "Руководства",
  screenshot: "Скриншоты",
  topics: "Обсуждения",
  reviews: "Отзывы",
  mods: "Мастерская",
};
const blank = (category) => ({ title: "", body: "", category, attachment: "" });
export default function GameHub() {
  const { slug } = useParams(),
    { state, me, act, uploadAttachment, notify } = useDemo();
  const [tab, setTab] = useState("news"),
    [form, setForm] = useState(null),
    [comment, setComment] = useState({}),
    [busy, setBusy] = useState(false);
  const game = games.find((g) => g.id === slug);
  if (!slug)
    return (
      <>
        <Head
          title="Центры игр"
          text="Новости, руководства, скриншоты и разговоры об играх."
        />
        <div className="gd-feature-grid">
          {games
            .filter((g) => g.available !== false)
            .map((g) => (
              <Link className="panel" key={g.id} to={"/hub/" + g.id}>
                <h3>{g.title}</h3>
                <p className="muted space">Открыть центр игры →</p>
              </Link>
            ))}
        </div>
      </>
    );
  if (!game) return <NotFound />;
  const posts = (state.hubPosts || []).filter(
    (p) => p.game === slug && p.category === tab,
  );
  const discussion = state.topics.filter((p) => p.game === slug && !p.hidden);
  const mods = state.mods.filter((p) => p.game === slug && !p.hidden);
  return (
    <>
      <Head title={game.title} text="Центр игры">
        <Link className="btn" to={"/game/" + slug}>
          Страница магазина
        </Link>
        {me &&
          [
            "guide",
            "screenshot",
            ...(me.role === "admin" ? ["news"] : []),
          ].includes(tab) && (
            <button className="btn primary" onClick={() => setForm(blank(tab))}>
              Опубликовать
            </button>
          )}
      </Head>
      <div className="tabs">
        {Object.entries(categories).map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "reviews" ? (
        <section className="panel">
          <ReviewList game={slug} />
          <Link className="btn space" to={"/game/" + slug}>
            Оставить отзыв на странице игры
          </Link>
        </section>
      ) : tab === "topics" ? (
        <section className="panel">
          <Link className="btn" to={"/community?game=" + slug}>
            Создать обсуждение
          </Link>
          {discussion.map((p) => (
            <Link className="order-game" key={p.id} to={"/community/" + p.id}>
              {p.title} · {p.replies.length} ответов
            </Link>
          ))}
        </section>
      ) : tab === "mods" ? (
        <section className="panel">
          <Link className="btn" to={"/workshop?game=" + slug}>
            Открыть мастерскую
          </Link>
          {mods.map((p) => (
            <Link className="order-game" key={p.id} to={"/workshop/" + p.id}>
              {p.title} · {p.subscribers} подписчиков
            </Link>
          ))}
        </section>
      ) : (
        <>
          {posts.map((p) => (
            <article className="panel space" key={p.id}>
              <div className="section-title">
                <Author id={p.author} />
                <small>
                  {date(p.at)}
                  {p.hidden ? " · Скрыто" : ""}
                </small>
              </div>
              <h2 className="space">{p.title}</h2>
              <p className="feature-prose">{p.body}</p>
              {p.media && <Attachment media={p.media} />}
              <div className="actions space">
                <button
                  className="btn"
                  disabled={!me || p.hidden}
                  onClick={() => act({ type: "hub-like", post: p.id })}
                >
                  {p.likes.includes(me?.id) ? "♥" : "♡"} {p.likes.length}
                </button>
                {p.author === me?.id && (
                  <>
                    <button
                      className="btn"
                      disabled={p.hidden}
                      onClick={() => setForm({ ...p, post: p.id })}
                    >
                      Редактировать
                    </button>
                    <button
                      className="btn"
                      onClick={() => setForm({ ...p, remove: true })}
                    >
                      Удалить
                    </button>
                  </>
                )}
                {me?.role === "admin" && (
                  <button
                    className="btn"
                    onClick={() =>
                      act({
                        type: "hub-moderate",
                        post: p.id,
                        hidden: !p.hidden,
                      })
                    }
                  >
                    {p.hidden ? "Восстановить" : "Скрыть"}
                  </button>
                )}
              </div>
              {p.comments.map((c) => (
                <div className="feature-comment" key={c.id}>
                  <Author id={c.author} />
                  <p>{c.text}</p>
                </div>
              ))}
              {me && !p.hidden && (
                <form
                  className="message-form space"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      await act({
                        type: "hub-comment",
                        post: p.id,
                        text: comment[p.id] || "",
                      })
                    )
                      setComment({ ...comment, [p.id]: "" });
                  }}
                >
                  <input
                    required
                    maxLength={2000}
                    aria-label="Комментарий"
                    placeholder="Ваш комментарий…"
                    value={comment[p.id] || ""}
                    onChange={(e) =>
                      setComment({ ...comment, [p.id]: e.target.value })
                    }
                  />
                  <button className="btn">Отправить</button>
                </form>
              )}
            </article>
          ))}
          {!posts.length && (
            <p className="panel muted">Здесь пока нет публикаций.</p>
          )}
        </>
      )}
      {form && (
        <Modal
          title={
            form.remove ? "Удалить публикацию?" : "Публикация в центре игры"
          }
          onClose={() => !busy && setForm(null)}
        >
          {form.remove ? (
            <>
              <p>{form.title}</p>
              <button
                className="btn danger space"
                onClick={async () => {
                  if (await act({ type: "hub-delete", post: form.id }))
                    setForm(null);
                }}
              >
                Удалить
              </button>
            </>
          ) : (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  if (
                    await act(
                      { ...form, type: "hub-save", game: slug },
                      "Публикация сохранена",
                    )
                  )
                    setForm(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Заголовок
                <input
                  required
                  maxLength={120}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label>
                Текст
                <textarea
                  rows={8}
                  required={form.category !== "screenshot"}
                  maxLength={12000}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
              </label>
              {form.category === "screenshot" && (
                <label>
                  Скриншот (до 5 МБ)
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={async (e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setBusy(true);
                      try {
                        const uploaded = await uploadAttachment(file);
                        setForm((f) => ({ ...f, attachment: uploaded.id }));
                      } catch (error) {
                        notify(error.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                  <small>
                    {form.attachment
                      ? "Изображение загружено"
                      : "Выберите изображение"}
                  </small>
                </label>
              )}
              <button
                className="btn primary"
                disabled={
                  busy || (form.category === "screenshot" && !form.attachment)
                }
              >
                Сохранить
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
