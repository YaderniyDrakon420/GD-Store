import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDemo } from "../demo/context";
import { games } from "../server/catalog.mjs";
import { eventVisible } from "../demo/social.mjs";
import { Head, Art, Avatar, Empty, Gate } from "./Studio";
import { Modal, Author } from "./Personal";
import Icon from "../components/Icon";
const when = (value) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
const statusLabel = {
  going: "Будет играть",
  declined: "Не сможет",
  invited: "Ждём ответа",
};
export default function Events() {
  const { state, me, act } = useDemo();
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null),
    [cancel, setCancel] = useState(false),
    [tab, setTab] = useState("Будущие");
  const mine = state.events.filter((e) => eventVisible(e, me?.id));
  const event = mine.find((e) => e.id === id);
  const ended = (e) => e.cancelled || new Date(e.startsAt) <= new Date();
  const shown = mine
    .filter((e) =>
      tab === "Будущие"
        ? !ended(e)
        : tab === "Архив"
          ? ended(e)
          : e.host === me?.id,
    )
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const save = async (values) => {
    const eventId = form?.id || crypto.randomUUID();
    if (
      await act(
        {
          ...values,
          type: form?.id ? "event-edit" : "event-create",
          event: form?.id,
          id: eventId,
        },
        "Игровой вечер сохранён",
      )
    ) {
      setForm(null);
      navigate("/events/" + eventId);
    }
  };
  return (
    <Gate>
      <Head
        eyebrow="PLAY TOGETHER"
        title="Вечер лучше в компании"
        text="Выберите игру, договоритесь о времени и соберите своих."
      >
        <button className="btn primary" onClick={() => setForm({})}>
          ＋ Создать вечер
        </button>
      </Head>
      {id && !event ? (
        <Empty
          title="Приглашение недоступно"
          text="Событие видно организатору и приглашённым игрокам. Возможно, приглашение отозвано."
          link="/events"
          label="Мои вечера"
        />
      ) : event ? (
        <>
          <Link className="back-link" to="/events">
            ← Все игровые вечера
          </Link>
          <div className="event-hero">
            <Art game={games.find((g) => g.id === event.game)} />
            <div>
              <span className="pill">
                {event.cancelled
                  ? "ОТМЕНЁН"
                  : ended(event)
                    ? "В АРХИВЕ"
                    : "ВСТРЕЧАЕМСЯ В ИГРЕ"}
              </span>
              <h1>{event.title}</h1>
              <p>
                {when(event.startsAt)} ·{" "}
                {games.find((g) => g.id === event.game)?.title}
              </p>
            </div>
          </div>
          <div className="event-layout">
            <section className="panel">
              <p className="eyebrow">ПЛАН НА ВЕЧЕР</p>
              <p className="event-description">
                {event.description ||
                  "Просто собираемся вместе и хорошо проводим время."}
              </p>
              <div className="host-line">
                <span className="muted">Организатор</span>
                <Author id={event.host} />
              </div>
              {event.host === me?.id ? (
                <div className="actions space">
                  <button
                    className="btn"
                    disabled={event.cancelled}
                    onClick={() => setForm(event)}
                  >
                    Изменить планы
                  </button>
                  <button
                    className="btn danger"
                    disabled={event.cancelled}
                    onClick={() => setCancel(true)}
                  >
                    Отменить вечер
                  </button>
                </div>
              ) : (
                <>
                  <p className="muted space">
                    Ваш ответ: {statusLabel[event.rsvp[me?.id]]}
                  </p>
                  <div className="actions space">
                    {[
                      ["going", "Буду играть"],
                      ["declined", "Не смогу"],
                      ["invited", "Пока не знаю"],
                    ].map(([status, label]) => (
                      <button
                        key={status}
                        disabled={ended(event)}
                        className={
                          "btn " +
                          (event.rsvp[me?.id] === status ? "primary" : "")
                        }
                        onClick={async () =>
                          await act(
                            { type: "event-rsvp", event: id, status },
                            "Ответ отправлен организатору",
                          )
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="fine space">
                Время показано в вашем часовом поясе. Друзья получат приглашения;
                игру и голосовой чат сайт не запускает.
              </p>
            </section>
            <aside className="panel">
              <h2>Кто с нами?</h2>
              <p className="muted space">
                {1 +
                  Object.values(event.rsvp).filter((s) => s === "going")
                    .length}{" "}
                готовы играть
              </p>
              {[event.host, ...event.invitees].map((user) => (
                <div className="event-person" key={user}>
                  <Author id={user} />
                  <small
                    className={
                      user === event.host || event.rsvp[user] === "going"
                        ? "accent"
                        : ""
                    }
                  >
                    {user === event.host
                      ? "Организатор"
                      : statusLabel[event.rsvp[user]]}
                  </small>
                </div>
              ))}
            </aside>
          </div>
        </>
      ) : (
        <>
          <div className="event-intro">
            <Icon name="calendar" size={32} />
            <div>
              <h2>Не «как-нибудь», а сегодня в восемь.</h2>
              <p>Пригласите друзей и узнайте, кто точно придёт.</p>
            </div>
            <span>CO-OP IS BETTER</span>
          </div>
          <div className="tabs">
            {["Будущие", "Мои события", "Архив"].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={tab === t ? "active" : ""}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="events-grid">
            {shown.map((e) => (
              <Link className="event-card" key={e.id} to={"/events/" + e.id}>
                <div className="event-cover">
                  <Art game={games.find((g) => g.id === e.game)} />
                  <span className="pill">
                    {e.cancelled ? "Отменён" : when(e.startsAt)}
                  </span>
                </div>
                <div className="event-card-body">
                  <p className="eyebrow">
                    {games.find((g) => g.id === e.game)?.title}
                  </p>
                  <h3>{e.title}</h3>
                  <div className="event-card-footer">
                    <span>
                      {e.host === me?.id
                        ? "Вы организатор"
                        : statusLabel[e.rsvp[me?.id]]}
                    </span>
                    <span>
                      {1 +
                        Object.values(e.rsvp).filter((s) => s === "going")
                          .length}{" "}
                      играют ↗
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          {!shown.length && (
            <Empty
              title="Самое время договориться"
              text="Создайте игровой вечер или дождитесь приглашения от друга."
              link="/friends"
              label="Найти команду"
            />
          )}
        </>
      )}
      {form && (
        <Modal
          title={form.id ? "Изменить игровой вечер" : "Собрать друзей"}
          onClose={() => setForm(null)}
        >
          <EventForm initial={form} onSave={save} />
        </Modal>
      )}
      {cancel && (
        <Modal title="Отменить игровой вечер?" onClose={() => setCancel(false)}>
          <p className="muted">
            Все приглашённые получат уведомление. Событие останется в архиве.
          </p>
          <div className="actions space">
            <button className="btn" onClick={() => setCancel(false)}>
              Оставить
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                if (await act({ type: "event-cancel", event: id }, "Вечер отменён"))
                  setCancel(false);
              }}
            >
              Отменить вечер
            </button>
          </div>
        </Modal>
      )}
    </Gate>
  );
}
function localDate(value) {
  const d = new Date(value || Date.now() + 86400000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function EventForm({ initial, onSave }) {
  const { state, me } = useDemo();
  const [title, setTitle] = useState(initial.title || ""),
    [game, setGame] = useState(initial.game || "orbital"),
    [date, setDate] = useState(localDate(initial.startsAt)),
    [description, setDescription] = useState(initial.description || ""),
    [invitees, setInvitees] = useState(initial.invitees || []);
  const friends = state.users.filter(
    (u) =>
      !u.banned &&
      u.id !== me.id &&
      state.friends.some(
        (f) =>
          f.status === "accepted" &&
          [f.from, f.to].includes(me.id) &&
          [f.from, f.to].includes(u.id),
      ),
  );
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, game, startsAt: date, description, invitees });
      }}
    >
      <label>
        Название вечера
        <input
          required
          maxLength={80}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Пятничный кооператив"
        />
      </label>
      <div className="form-grid">
        <label>
          Игра
          <select value={game} onChange={(e) => setGame(e.target.value)}>
            {games.map((g) => (
              <option value={g.id} key={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дата и время
          <input
            required
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      <label>
        План на вечер
        <textarea
          maxLength={1000}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Проходим вместе, без спойлеров…"
        />
      </label>
      <fieldset>
        <legend>Кого позовём?</legend>
        <div className="invite-list">
          {friends.map((u) => (
            <label key={u.id} className="invite-person">
              <Avatar user={u} />
              <span>{u.name}</span>
              <input
                type="checkbox"
                checked={invitees.includes(u.id)}
                onChange={() =>
                  setInvitees(
                    invitees.includes(u.id)
                      ? invitees.filter((i) => i !== u.id)
                      : [...invitees, u.id],
                  )
                }
              />
            </label>
          ))}
        </div>
        {!friends.length && (
          <p className="fine">
            Сначала добавьте друзей или сохраните планы для себя.
          </p>
        )}
        {invitees
          .filter((id) => !friends.some((f) => f.id === id))
          .map((id) => (
            <button
              type="button"
              key={id}
              className="link-button"
              onClick={() => setInvitees(invitees.filter((i) => i !== id))}
            >
              Убрать недоступного участника ×
            </button>
          ))}
      </fieldset>
      <button className="btn primary">Сохранить и пригласить</button>
    </form>
  );
}
