import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.mjs";
import { useDemo } from "../demo/context";
import { Gate, Head, money } from "./Studio";
const labels = {
  pending: "Ожидает оплаты",
  paid: "Оплачен",
  cancelled: "Отменён",
  expired: "Истёк",
  failed: "Ошибка оплаты",
  refunded: "Возвращён",
};
export function ServerOrders() {
  const { state, refresh } = useDemo();
  const [busy, setBusy] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function action(order, kind) {
    if (busy) return;
    setBusy(order.id);
    setError("");
    try {
      if (kind === "payment") {
        await api("payments/create/", {
          method: "POST",
          body: { order_id: order.id },
        });
        setNotice(
          "Попытка оплаты создана. Платёжный провайдер пока не подключён: деньги не списывались.",
        );
      } else await api(`store/orders/${order.id}/${kind}/`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Gate>
      <Head
        eyebrow="ВАШИ ПОКУПКИ"
        title="История заказов"
        text="Статусы и суммы из базы данных."
      />
      <button
        className="btn"
        onClick={() => refresh().catch((e) => setError(e.message))}
      >
        Обновить статусы
      </button>
      {error && (
        <p role="alert" className="payment-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {state.orders.map((o) => (
        <section className="panel order space" key={o.id}>
          <div className="section-title">
            <div>
              <p className="eyebrow">ЗАКАЗ / {o.id}</p>
              <h3>{new Date(o.created_at).toLocaleString("ru-RU")}</h3>
            </div>
            <span className="pill accent">{labels[o.status] || o.status}</span>
          </div>
          {o.recipient && <p>Получатель: {o.recipient}</p>}
          {o.items.map((i) => (
            <Link
              className="order-game"
              key={i.game.id}
              to={"/game/" + i.game.slug}
            >
              {i.game.title}
              <span>{money(Number(i.price_at_purchase))}</span>
            </Link>
          ))}
          <div className="order-total">
            <span>Итого</span>
            <strong>{money(Number(o.total))}</strong>
          </div>
          <div className="actions">
            {o.status === "pending" && (
              <>
                <button
                  className="btn primary"
                  disabled={!!busy}
                  onClick={() => action(o, "payment")}
                >
                  Подготовить оплату
                </button>
                <button
                  className="btn"
                  disabled={!!busy}
                  onClick={() => action(o, "cancel")}
                >
                  Отменить заказ
                </button>
              </>
            )}
            {o.status === "paid" && (
              <button
                className="btn"
                disabled={!!busy}
                onClick={() => action(o, "refund")}
              >
                Запросить возврат
              </button>
            )}
          </div>
        </section>
      ))}
      {!state.orders.length && <p className="panel space">Заказов пока нет.</p>}
    </Gate>
  );
}
export function ServerSettings() {
  const { me, state, act, logout } = useDemo();
  const s = state.settings[me?.id] || {};
  return (
    <Gate>
      <Head title="Настройки пространства" text="Аккаунт и оформление." />
      <div className="settings-grid">
        <section className="panel">
          <h2>{me?.name}</h2>
          <p>@{me?.handle}</p>
          <p>{me?.email}</p>
          <Link className="btn" to="/profile">
            Профиль
          </Link>
          <button className="btn space" onClick={logout}>
            Выйти
          </button>
        </section>
        <section className="panel">
          <h2>Оформление</h2>
          {[
            ["compact", "Компактный интерфейс"],
            ["motionOff", "Меньше движения"],
          ].map(([key, label]) => (
            <label className="setting-row" key={key}>
              {label}
              <input
                type="checkbox"
                checked={!!s[key]}
                onChange={(e) =>
                  act({ type: "settings", values: { [key]: e.target.checked } })
                }
              />
            </label>
          ))}
        </section>
      </div>
    </Gate>
  );
}
export function Unavailable() {
  return (
    <>
      <Head
        title="Раздел готовится"
        text="Эта функция ещё не подключена к серверу."
      />
      <div className="panel">
        <p>
          Магазин, библиотека, заказы, друзья и личная переписка уже доступны.
        </p>
        <Link className="btn primary" to="/">
          В магазин
        </Link>
        <Link className="btn" to="/friends">
          К друзьям
        </Link>
      </div>
    </>
  );
}
