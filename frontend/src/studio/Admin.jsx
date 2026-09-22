import { ReportsQueue } from "./Reports";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useDemo } from "../demo/context";
import { Head, Avatar, Empty } from "./Studio";
import { Modal, date } from "./Personal";
import Icon from "../components/Icon";
export default function Admin() {
  const { state, me, act } = useDemo();
  const [tab, setTab] = useState("Пользователи"),
    [search, setSearch] = useState(""),
    [target, setTarget] = useState(null),
    [roleTarget, setRoleTarget] = useState(null),
    [reason, setReason] = useState(""),
    [announcement, setAnnouncement] = useState(state.announcement.text),
    [enabled, setEnabled] = useState(state.announcement.enabled);
  if (me?.role !== "admin" || me.banned)
    return (
      <Empty
        title="Только для администратора"
        text="Войдите в аккаунт с правами администратора."
        link="/settings"
        label="Выбрать профиль"
      />
    );
  const filtered = state.users.filter((u) =>
    (u.name + " " + u.handle).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Head
        eyebrow="GD CONTROL"
        title="Центр управления"
        text="Порядок в сообществе начинается с понятных правил."
      >
        <span className="admin-role">
          <Icon name="shield" />
          Администратор
        </span>
      </Head>
      <Link className="btn space" to="/support">
        Обращения в поддержку ↗
      </Link>
      <div className="admin-metrics">
        {[
          [state.users.length, "Игроков", "users"],
          [
            state.users.filter((u) => u.banned).length,
            "Заблокировано",
            "shield",
          ],
          [state.topics.length + state.mods.length, "Публикаций", "globe"],
          [state.adminStats?.orders ?? state.orders.length, "Демозаказов", "cart"],
        ].map(([value, label, icon]) => (
          <div key={label}>
            <Icon name={icon} />
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="admin-notice">
        <Icon name="shield" />
        <p>
          Здесь можно рассматривать жалобы, модерировать публикации и
          управлять доступом пользователей.
        </p>
      </div>
      <div className="tabs">
        {["Пользователи", "Жалобы", "Модерация", "Объявление", "Журнал"].map(
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
      {tab === "Жалобы" ? (
        <ReportsQueue />
      ) : tab === "Пользователи" ? (
        <section className="panel">
          <div className="section-title">
            <h2>Игроки сообщества</h2>
            <input
              aria-label="Найти пользователя"
              placeholder="Имя или логин"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="admin-user-list">
            {filtered.map((u) => (
              <div className="admin-user" key={u.id}>
                <Link className="author" to={"/profile/" + u.id}>
                  <Avatar user={u} />
                  <span>
                    <strong>{u.name}</strong>
                    <small>@{u.handle}</small>
                  </span>
                </Link>
                <span className={"status-tag " + (u.banned ? "bad" : "")}>
                  {u.banned
                    ? "Заблокирован"
                    : u.role === "admin"
                      ? "Администратор"
                      : "Игрок"}
                </span>
                <p className="muted">
                  {u.banned ? u.banReason : "Доступ активен"}
                </p>
                {me.canManageRoles && u.id !== me.id && !u.banned && (
                  <button className="btn" onClick={() => setRoleTarget(u)}>
                    {u.role === "admin" ? "Снять права" : "Назначить админом"}
                  </button>
                )}
                {u.role !== "admin" &&
                  (u.banned ? (
                    <button
                      className="btn"
                      onClick={async () =>
                        await act(
                          { type: "admin-unban", user: u.id },
                          "Блокировка снята",
                        )
                      }
                    >
                      Разблокировать
                    </button>
                  ) : (
                    <button
                      className="btn danger"
                      onClick={() => {
                        setTarget(u);
                        setReason("");
                      }}
                    >
                      Заблокировать
                    </button>
                  ))}
              </div>
            ))}
          </div>
          {!filtered.length && <p className="muted">Пользователь не найден.</p>}
        </section>
      ) : tab === "Модерация" ? (
        <div className="moderation-grid">
          {[
            ["topics", "Обсуждения"],
            ["mods", "Мастерская"],
          ].map(([collection, label]) => (
            <section className="panel" key={collection}>
              <h2>{label}</h2>
              {state[collection].map((item) => (
                <article className="moderation-item" key={item.id}>
                  <div className="moderation-heading">
                    <h3>{item.title}</h3>
                    <span
                      className={"status-tag " + (item.hidden ? "bad" : "")}
                    >
                      {item.hidden ? "Скрыто" : "Опубликовано"}
                    </span>
                  </div>
                  <p className="muted">
                    Автор: {state.users.find((u) => u.id === item.author)?.name}
                    {item.locked ? " · Ответы закрыты" : ""}
                  </p>
                  <div className="actions">
                    <button
                      className="btn"
                      onClick={async () =>
                        await act(
                          {
                            type: "admin-moderate",
                            collection,
                            item: item.id,
                            field: "hidden",
                          },
                          "Видимость обновлена",
                        )
                      }
                    >
                      {item.hidden ? "Восстановить" : "Скрыть"}
                    </button>
                    {collection === "topics" && (
                      <button
                        className="btn"
                        onClick={async () =>
                          await act(
                            {
                              type: "admin-moderate",
                              collection,
                              item: item.id,
                              field: "locked",
                            },
                            "Статус обсуждения обновлён",
                          )
                        }
                      >
                        {item.locked ? "Открыть ответы" : "Закрыть ответы"}
                      </button>
                    )}
                    <Link
                      className="link-button"
                      to={
                        (collection === "topics"
                          ? "/community/"
                          : "/workshop/") + item.id
                      }
                    >
                      Посмотреть ↗
                    </Link>
                  </div>
                </article>
              ))}
              {!state[collection].length && (
                <p className="muted space">Публикаций пока нет.</p>
              )}
            </section>
          ))}
        </div>
      ) : tab === "Объявление" ? (
        <div className="announcement-grid">
          <form
            className="panel form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              await act(
                { type: "admin-announcement", text: announcement, enabled },
                "Объявление сохранено",
              );
            }}
          >
            <h2>Сообщение для всех</h2>
            <p className="muted">Плашка появится над страницами магазина.</p>
            <label>
              Текст объявления
              <textarea
                maxLength={160}
                rows={3}
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                placeholder="Например: сегодня играем вместе — собирайте команду!"
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Показывать объявление
            </label>
            <button className="btn primary">Сохранить</button>
          </form>
          <div className="panel">
            <p className="eyebrow">ПРЕДПРОСМОТР</p>
            <div className="site-announcement">
              <Icon name="spark" />
              <span>{announcement || "Ваше объявление появится здесь"}</span>
            </div>
            <p className="fine space">
              Только текст, без HTML и внешних ссылок.
            </p>
          </div>
        </div>
      ) : (
        <section className="panel">
          <h2>История модерации</h2>
          <p className="muted space">Последние 100 действий</p>
          {state.adminLog.map((entry) => (
            <div className="audit-row" key={entry.id}>
              <span className="audit-dot" />
              <div>
                <p>{entry.text}</p>
                <small>
                  {state.users.find((u) => u.id === entry.actor)?.name} ·{" "}
                  {date(entry.at)} ·{" "}
                  {new Date(entry.at).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </div>
            </div>
          ))}
          {!state.adminLog.length && (
            <p className="muted space">
              Изменения появятся здесь после первого действия.
            </p>
          )}
        </section>
      )}
      {roleTarget && (
        <Modal title="Права администратора" onClose={() => setRoleTarget(null)}>
          <p className="muted">
            {roleTarget.role === "admin"
              ? "Снять права администратора у"
              : "Предоставить управление пользователями и модерацией игроку"}{" "}
            {roleTarget.name}?
          </p>
          <div className="actions space">
            <button className="btn" onClick={() => setRoleTarget(null)}>
              Отмена
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                if (
                  await act(
                    {
                      type: "admin-role",
                      user: roleTarget.id,
                      role: roleTarget.role === "admin" ? "player" : "admin",
                    },
                    "Права обновлены",
                  )
                )
                  setRoleTarget(null);
              }}
            >
              Подтвердить
            </button>
          </div>
        </Modal>
      )}
      {target && (
        <Modal
          title={"Блокировка: " + target.name}
          onClose={() => setTarget(null)}
        >
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  { type: "admin-ban", user: target.id, reason },
                  "Пользователь заблокирован",
                )
              )
                setTarget(null);
            }}
          >
            <p className="muted">
              Игрок сможет просматривать сайт, но не сможет отправлять
              сообщения, публиковать материалы и оформлять демопокупки.
            </p>
            <label>
              Причина
              <textarea
                required
                maxLength={240}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Укажите понятную причину"
              />
            </label>
            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={() => setTarget(null)}
              >
                Отмена
              </button>
              <button className="btn danger">Подтвердить блокировку</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
