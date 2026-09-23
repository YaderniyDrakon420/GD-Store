import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDemo } from "../demo/context";
import { Head, Gate } from "./Studio";
import { date } from "./Personal";
import Icon from "../components/Icon";
export default function Notifications() {
  const { state, me, act } = useDemo();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("Все");
  const all = state.notifications.filter((n) => n.to === me?.id);
  const notes = all.filter((n) => filter === "Все" || !n.read);
  const unread = all.filter((n) => !n.read).length;
  return (
    <Gate>
      <Head
        eyebrow="YOUR INBOX"
        title="Ничего не пропустите"
        text="Приглашения, сообщения и маленькие поводы вернуться."
      >
        <button
          className="btn"
          disabled={!unread}
          onClick={async () =>
            await act({ type: "notifications-read-all" }, "Все уведомления прочитаны")
          }
        >
          Прочитать всё
        </button>
      </Head>
      <div className="notification-summary">
        <span className="inbox-icon">
          <Icon name="bell" size={29} />
        </span>
        <div>
          <strong>{unread}</strong>
          <p>непрочитанных уведомлений</p>
        </div>
        <span className="fine">Только для профиля {me?.name}</span>
      </div>
      <div className="tabs">
        {["Все", "Непрочитанные"].map((t) => (
          <button
            key={t}
            className={t === filter ? "active" : ""}
            onClick={() => setFilter(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="notification-list">
        {notes.map((n) => (
          <article
            className={"notification-row " + (!n.read ? "unread" : "")}
            key={n.id}
          >
            <span className="notice-type">
              <Icon
                name={
                  n.url.startsWith("/events")
                    ? "calendar"
                    : n.url.startsWith("/messages")
                      ? "chat"
                      : ["/library", "/gifts"].includes(n.url)
                        ? "gift"
                        : "bell"
                }
              />
            </span>
            <button
              className="notification-content"
              onClick={async () => {
                if (await act({ type: "notification-read", notification: n.id }))
                  navigate(n.url);
              }}
            >
              <strong>{n.title}</strong>
              <p>{n.text}</p>
              <small>
                {date(n.at)} ·{" "}
                {new Date(n.at).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
            </button>
            {!n.read && (
              <button
                className="icon-btn"
                aria-label={"Отметить прочитанным: " + n.title}
                onClick={async () =>
                  await act({ type: "notification-read", notification: n.id })
                }
              >
                <Icon name="check" size={17} />
              </button>
            )}
          </article>
        ))}
      </div>
      {!notes.length && (
        <div className="inbox-empty">
          <Icon name="check" size={40} />
          <h2>
            {filter === "Все"
              ? "Здесь появятся новые события"
              : "Вы всё прочитали"}
          </h2>
          <p>
            Приглашения друзей, ответы, сообщения и подарки будут собраны здесь.
          </p>
        </div>
      )}
    </Gate>
  );
}
