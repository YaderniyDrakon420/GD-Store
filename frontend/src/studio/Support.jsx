import { useState } from "react";
import { useDemo } from "../demo/context";
import { Head, Empty } from "./Studio";
import { Modal, Author, date } from "./Personal";
const statuses = {
  open: "Открыто",
  "in-progress": "В работе",
  resolved: "Решено",
};
export default function Support() {
  const { state, me, act } = useDemo();
  const [create, setCreate] = useState(false),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("all"),
    [text, setText] = useState(""),
    [form, setForm] = useState({ title: "", category: "Покупка", text: "" });
  if (!me || me.banned)
    return (
      <Empty
        title="Войдите для обращения в поддержку"
        link="/login"
        label="Войти"
      />
    );
  const tickets = state.tickets.filter(
    (t) =>
      (t.owner === me.id || me.role === "admin") &&
      (filter === "all" || t.status === filter),
  );
  const ticket = tickets.find((t) => t.id === selected);
  return (
    <>
      <Head
        eyebrow="WE'RE HERE TO HELP"
        title="Центр поддержки"
        text={
          me.role === "admin"
            ? "Обращения сообщества и ответы администратора."
            : "Покупки, аккаунт и вопросы о сообществе."
        }
      >
        <button className="btn primary" onClick={() => setCreate(true)}>
          ＋ Создать обращение
        </button>
      </Head>
      <div className="tabs">
        {[["all", "Все"], ...Object.entries(statuses)].map(([v, l]) => (
          <button
            key={v}
            className={filter === v ? "active" : ""}
            onClick={() => setFilter(v)}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="support-layout">
        <div className="panel support-list">
          {tickets.map((t) => (
            <button
              className={selected === t.id ? "selected" : ""}
              key={t.id}
              onClick={() => {
                setSelected(t.id);
                setText("");
              }}
            >
              <small>
                {t.category} · {statuses[t.status]}
              </small>
              <strong>{t.title}</strong>
              <span>{date(t.at)}</span>
            </button>
          ))}
          {!tickets.length && <p className="muted">Обращений пока нет.</p>}
        </div>
        <section className="panel">
          {ticket ? (
            <>
              <div className="section-title">
                <h2>{ticket.title}</h2>
                {me.role === "admin" ? (
                  <select
                    aria-label="Статус обращения"
                    value={ticket.status}
                    onChange={async (e) =>
                      await act(
                        {
                          type: "ticket-status",
                          ticket: ticket.id,
                          status: e.target.value,
                        },
                        "Статус обновлён",
                      )
                    }
                  >
                    {Object.entries(statuses).map(([v, l]) => (
                      <option value={v} key={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="status-tag">{statuses[ticket.status]}</span>
                )}
              </div>
              {ticket.messages.map((m) => (
                <article className="support-message" key={m.id}>
                  <Author id={m.author} />
                  <p>{m.text}</p>
                  <small>{date(m.at)}</small>
                </article>
              ))}
              {ticket.status !== "resolved" ? (
                <form
                  className="form-stack space"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      await act(
                        { type: "ticket-reply", ticket: ticket.id, text },
                        "Ответ добавлен",
                      )
                    )
                      setText("");
                  }}
                >
                  <label>
                    Ответ
                    <textarea
                      required
                      rows={3}
                      maxLength={2000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                  <button className="btn primary">Отправить</button>
                </form>
              ) : (
                <p className="muted space">Обращение решено.</p>
              )}
            </>
          ) : (
            <div className="inbox-empty">
              <h2>Каждый вопрос важен</h2>
              <p>Выберите обращение или создайте новое.</p>
            </div>
          )}
        </section>
      </div>
      {create && (
        <Modal title="Новое обращение" onClose={() => setCreate(false)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act({ type: "ticket-create", ...form }, "Обращение создано")
              ) {
                setCreate(false);
                setForm({ title: "", category: "Покупка", text: "" });
              }
            }}
          >
            <label>
              Категория
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {["Покупка", "Аккаунт", "Жалоба", "Другое"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Тема
              <input
                required
                maxLength={100}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              Описание
              <textarea
                required
                rows={5}
                maxLength={2000}
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
              />
            </label>
            <button className="btn primary">Создать</button>
          </form>
        </Modal>
      )}
    </>
  );
}
