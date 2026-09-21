import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.mjs";
import { useDemo } from "../demo/context";
import { Gate, Head, Art, money } from "./Studio";
import { mapGame } from "../api/mapping.mjs";
export default function Checkout() {
  const { me, state, refresh } = useDemo();
  const [recipient, setRecipient] = useState(""),
    [promo, setPromo] = useState(""),
    [summary, setSummary] = useState(null),
    [order, setOrder] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const friends = state.users.filter(
    (u) =>
      u.id !== me?.id &&
      state.friends.some(
        (f) => f.status === "accepted" && [f.from, f.to].includes(u.id),
      ),
  );
  useEffect(() => {
    const c = new AbortController();
    setSummary(null);
    setError("");
    if (me)
      api(
        `store/cart/summary/?recipient_username=${encodeURIComponent(recipient)}`,
        { signal: c.signal },
      )
        .then(setSummary)
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        });
    return () => c.abort();
  }, [recipient, me?.id]);
  async function submit(e) {
    e.preventDefault();
    if (busy || !summary) return;
    setBusy(true);
    setError("");
    try {
      const value = await api("store/cart/checkout/", {
        method: "POST",
        body: {
          checkout_token: summary.checkout_token,
          recipient_username: recipient,
          promo_code: promo,
        },
      });
      setOrder(value);
      await refresh();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) setSummary(null);
    } finally {
      setBusy(false);
    }
  }
  if (order)
    return (
      <Gate>
        <div className="payment-success">
          <span className="success-ring">✓</span>
          <h1>Заказ создан</h1>
          <p>
            Статус: {order.status}. Игры появятся в библиотеке после
            подтверждения оплаты сервером.
          </p>
          <div className="receipt">
            <p>Заказ: {order.id}</p>
            <strong>{money(Number(order.total))}</strong>
          </div>
          <Link className="btn primary" to="/orders">
            Перейти к заказам
          </Link>
        </div>
      </Gate>
    );
  return (
    <Gate>
      <Head
        eyebrow="CHECKOUT"
        title="Следующая история — ваша"
        text="Проверьте состав заказа. Окончательную сумму рассчитывает сервер."
      />
      <Link className="back-link" to="/cart">
        ← Вернуться в корзину
      </Link>
      <form className="checkout-grid" onSubmit={submit}>
        <section className="payment-form panel">
          <div className="payment-step">
            <span>01</span>
            <h2>Для кого приключение?</h2>
          </div>
          <label className="payment-label">
            Получатель
            <select
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={busy}
            >
              <option value="">Для себя</option>
              {friends.map((u) => (
                <option key={u.id} value={u.handle}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <div className="payment-step space">
            <span>02</span>
            <h2>Промокод</h2>
          </div>
          <input
            aria-label="Промокод"
            value={promo}
            maxLength={32}
            onChange={(e) => setPromo(e.target.value)}
            disabled={busy}
          />
          <p className="fine space">
            Промокод проверяется при создании заказа. Итоговая скидка будет
            указана в заказе.
          </p>
          <div className="payment-step space">
            <span>03</span>
            <h2>Оплата</h2>
          </div>
          <p className="muted">
            Приём реальных платежей пока не подключён. Заказ можно сохранить;
            данные банковской карты здесь не запрашиваются.
          </p>
        </section>
        <aside className="order-summary panel">
          <h2>Ваш заказ</h2>
          {summary?.results.map((row) => (
            <div className="summary-game" key={row.id}>
              <Art game={mapGame(row.game)} />
              <span>
                {row.game.title}
                {row.unavailable_reason && (
                  <small className="payment-error">
                    {row.unavailable_reason}
                  </small>
                )}
              </span>
              <strong>{money(Number(row.game.final_price))}</strong>
            </div>
          ))}
          <div className="totals">
            <div className="grand-total">
              <span>До промокода</span>
              <strong>{summary ? money(Number(summary.total)) : "…"}</strong>
            </div>
          </div>
          {error && (
            <p className="payment-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn primary pay-submit"
            disabled={busy || !summary?.can_checkout}
          >
            {busy ? "Создаём…" : "Создать заказ"}
          </button>
          {!summary && <Link to="/cart">Обновить корзину</Link>}
        </aside>
      </form>
    </Gate>
  );
}
