import { useState } from "react";
import { useDemo } from "../demo/context";
import { notificationKinds } from "../demo/notificationPrefs.mjs";
import { Modal, Author } from "./Personal";
export function NotificationSettings() {
  const { state, me, act } = useDemo();
  if (!me) return null;
  const prefs = state.settings[me.id]?.notifications || {};
  return (
    <section className="panel space">
      <h2>Какие уведомления получать</h2>
      <p className="muted space">
        Отключение убирает новые уведомления этой категории. Сообщения и подарки
        сохраняются, старые уведомления остаются.
      </p>
      {Object.entries(notificationKinds).map(([key, label]) => (
        <label className="setting-row" key={key}>
          {label}
          <input
            type="checkbox"
            checked={prefs[key] !== false}
            onChange={async (e) =>
              await act(
                {
                  type: "settings",
                  values: {
                    notifications: { [key]: e.target.checked },
                  },
                },
                "Уведомления настроены",
              )
            }
          />
        </label>
      ))}
    </section>
  );
}
export function TeamChat({ party }) {
  const { state, me, act } = useDemo();
  const [open, setOpen] = useState(false),
    [text, setText] = useState("");
  if (!me || me.banned || !party.members.includes(me.id)) return null;
  const messages = party.messages || [];
  return (
    <>
      <button className="btn space" onClick={() => setOpen(true)}>
        Чат команды · {messages.length}
      </button>
      {open && (
        <Modal title={"Чат · " + party.title} onClose={() => setOpen(false)}>
          <p className="fine">
            Чат доступен текущим участникам команды.
          </p>
          <div className="team-chat-history" tabIndex={0}>
            {messages.map((m) => (
              <article
                key={m.id}
                className={
                  "support-message " + (m.author === me.id ? "own-message" : "")
                }
              >
                <Author id={m.author} />
                <p>{m.text}</p>
                <small>{new Date(m.at).toLocaleString("ru-RU")}</small>
              </article>
            ))}
            {!messages.length && (
              <p className="muted space">
                Начните обсуждение: время, роли и план игры.
              </p>
            )}
          </div>
          {party.closed || new Date(party.startsAt) <= new Date() ? (
            <p className="muted space">
              Набор закрыт. История доступна для чтения.
            </p>
          ) : (
            <form
              className="form-stack space"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act({ type: "party-message", party: party.id, text }))
                  setText("");
              }}
            >
              <label>
                Сообщение
                <textarea
                  required
                  rows={3}
                  maxLength={2000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <button className="btn primary">Отправить команде</button>
            </form>
          )}
          <p className="fine space">
            Участников:{" "}
            {
              party.members.filter((id) => state.users.some((u) => u.id === id))
                .length
            }
          </p>
        </Modal>
      )}
    </>
  );
}
