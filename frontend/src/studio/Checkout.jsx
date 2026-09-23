import { purchasePoints } from "../demo/players.mjs";
import { useEffect, useState } from "react";
import { api } from "../server/api.mjs";
import { Link } from "react-router-dom";
import { useDemo } from "../demo/context";
import { games } from "../server/catalog.mjs";
import { validateDemoCard } from "../demo/extras.mjs";
import { Head, Art, Gate, Empty, money } from "./Studio";
import Icon from "../components/Icon";
export default function Checkout() {
  const { state, me, act } = useDemo();
  const [method, setMethod] = useState("card"),
    [recipient, setRecipient] = useState(""),
    [giftMessage, setGiftMessage] = useState(""),
    [promoDraft, setPromoDraft] = useState(""),
    [promo, setPromo] = useState(""),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState(null),
    [card, setCard] = useState({
      number: "4242 4242 4242 4242",
      name: "GD STORE DEMO",
      expiry: "12/30",
      cvc: "123",
    });
  const ids = state.cart[me?.id] || [];
  const items = games.filter((g) => ids.includes(g.id));
  const [calculation, setCalculation] = useState(null);
  const [busy, setBusy] = useState(false);
  const quoteKey = JSON.stringify([me?.id, recipient, promo, items.map((g) => [g.id, g.finalPrice, g.isPreorder, g.releaseDate, g.platforms]), state.paymentTestMode]);
  const quote = calculation?.key === quoteKey ? calculation.quote : null;
  const quoteError = calculation?.key === quoteKey ? calculation.error : "Рассчитываем сумму на сервере…";
  useEffect(() => {
    const controller = new AbortController();
    if (!me || !items.length) return () => controller.abort();
    api.request("quote/", { method: "POST", body: { recipient, promo }, user: me.id, signal: controller.signal })
      .then((value) => setCalculation({ key: quoteKey, quote: value, error: "" }))
      .catch((e) => { if (!controller.signal.aborted) setCalculation({ key: quoteKey, quote: null, error: e.message }); });
    return () => controller.abort();
  }, [quoteKey]);
  const field = (key, value) => {
    setCard({ ...card, [key]: value });
    setError("");
  };
  const friends = state.users.filter(
    (u) =>
      u.id !== me?.id &&
      !u.banned &&
      state.friends.some(
        (f) =>
          f.status === "accepted" &&
          [f.from, f.to].includes(me?.id) &&
          [f.from, f.to].includes(u.id),
      ),
  );
  async function submit(e) {
    e.preventDefault();
    if (!quote) {
      setError(quoteError);
      return;
    }
    if (method === "card" && quote.total > 0) {
      const invalid = validateDemoCard(card);
      if (invalid) {
        setError(invalid);
        return;
      }
    }
    if (busy) return;
    setBusy(true);
    const result = await act({
        type: "checkout",
        token: quote.token,
        recipient: quote.recipient,
        giftMessage,
        promo,
        method: quote.total === 0 ? "instant" : method,
      });
    setBusy(false);
    if (result) {
      setReceipt(result);
      setCard({ number: "", name: "", expiry: "", cvc: "" });
    } else {
      // A stale quote must be explicitly recalculated after a rejected checkout.
      setCalculation(null);
      try {
        const value = await api.request("quote/", { method: "POST", body: { recipient, promo }, user: me.id });
        setCalculation({ key: quoteKey, quote: value, error: "Проверьте обновлённую сумму и повторите покупку." });
      } catch (e) { setCalculation({ key: quoteKey, quote: null, error: e.message }); }
    }
  }
  if (receipt)
    return (
      <div className="payment-success">
        <span className="success-ring">
          <Icon name="check" size={40} />
        </span>
        <p className="eyebrow">НОВОЕ ПРИКЛЮЧЕНИЕ УЖЕ ЖДЁТ</p>
        <h1>
          {receipt.gift ? "Подарок отправлен" : receipt.preorders?.length ? "Предзаказ оформлен" : "Заказ оформлен"}
        </h1>
        <p>
          {receipt.gift
            ? "Игры появились в библиотеке " + receipt.recipient + "."
            : "Игры уже в вашей библиотеке."}
        </p>
        {!!receipt.preorders?.length && <p>Предзаказы отмечены в библиотеке и ожидают релиза. Это учебный заказ без выдачи ключа.</p>}
        <p className="points-reward">
          ＋{receipt.pointsEarned || 0} демобаллов начислено вашему профилю
        </p>
        <div className="receipt">
          <div>
            <span>Демозаказ</span>
            <strong>#{receipt.id.slice(0, 8).toUpperCase()}</strong>
          </div>
          <div>
            <span>Сумма в демонстрации</span>
            <strong>{money(receipt.total)}</strong>
          </div>
          <div>
            <span>Фактически списано</span>
            <strong className="accent">0 ₴</strong>
          </div>
        </div>
        <div className="actions">
          <Link className="btn primary" to="/library">
            В библиотеку <Icon name="arrow" />
          </Link>
          <Link className="btn" to="/orders">
            Посмотреть заказ
          </Link>
        </div>
      </div>
    );
  return (
    <Gate>
      <Head
        eyebrow="CHECKOUT / DEMO"
        title="Следующая история — ваша"
        text="Оформление покупки с тестовыми данными. Настоящего списания нет."
      />
      <Link to="/cart" className="back-link">
        ← Вернуться в корзину
      </Link>
      {!items.length ? (
        <Empty
          title="Корзина пока пуста"
          text="Выберите игру, которую хочется открыть следующей."
        />
      ) : (
        <form className="checkout-grid" onSubmit={submit}>
          <section className="payment-form panel">
            <div className="payment-step">
              <span>01</span>
              <div>
                <h2>Для кого приключение?</h2>
                <p className="muted">Можно порадовать себя или друга.</p>
              </div>
            </div>
            <div className="recipient-choice">
              <button
                type="button"
                className={"choice-tile " + (!recipient ? "selected" : "")}
                onClick={() => setRecipient("")}
              >
                <Icon name="user" />
                <strong>Для себя</strong>
              </button>
              <button
                type="button"
                className={"choice-tile " + (recipient ? "selected" : "")}
                disabled={!friends.length}
                onClick={() => setRecipient(friends[0]?.id || "")}
              >
                <Icon name="gift" />
                <strong>В подарок</strong>
              </button>
            </div>
            {!!recipient && (
              <label className="payment-label">
                Получатель
                <select
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                >
                  {friends.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · @{u.handle}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {recipient && (
              <label className="payment-label">
                Послание другу
                <textarea
                  rows={3}
                  maxLength={300}
                  value={giftMessage}
                  onChange={(e) => setGiftMessage(e.target.value)}
                  placeholder="Увидимся в новом приключении!"
                />
              </label>
            )}
            {!friends.length && (
              <p className="fine">Добавьте друга, чтобы отправить подарок.</p>
            )}
            <div className="payment-step space">
              <span>02</span>
              <div>
                <h2>Способ демооплаты</h2>
                <p className="muted">Пример готового платёжного интерфейса.</p>
              </div>
            </div>
            <div className="payment-methods">
              <button
                type="button"
                className={method === "wallet" ? "selected" : ""}
                onClick={() => {
                  setMethod("wallet");
                  setError("");
                }}
              >
                Кошелёк · {me?.wallet || 0} ₴
              </button>
              <button
                type="button"
                className={method === "card" ? "selected" : ""}
                onClick={() => {
                  setMethod("card");
                  setError("");
                }}
              >
                <Icon name="card" />
                Тестовая карта
              </button>
              <button
                type="button"
                className={method === "instant" ? "selected" : ""}
                onClick={() => {
                  setMethod("instant");
                  setError("");
                }}
              >
                <Icon name="spark" />
                Быстрый демозаказ
              </button>
            </div>
            {method === "wallet" && (
              <div className="panel space">
                <h3>Демокошелёк · {me?.wallet || 0} ₴</h3>
                <p className="muted space">
                  {(me?.wallet || 0) < (quote?.total || 0)
                    ? "Недостаточно средств. Пополните кошелёк перед покупкой."
                    : "Сумма заказа будет списана с вашего демобаланса."}
                </p>
                <Link className="btn space" to="/wallet">
                  Пополнить кошелёк ↗
                </Link>
              </div>
            )}
            {method === "card" ? (
              <>
                <div className="demo-credit-card">
                  <div>
                    <strong>GD / PAY</strong>
                    <span>DEMO CARD</span>
                  </div>
                  <span className="card-chip" />
                  <p className="card-digits">
                    {card.number || "•••• •••• •••• ••••"}
                  </p>
                  <div>
                    <span>
                      <small>CARDHOLDER</small>
                      {card.name || "YOUR NAME"}
                    </span>
                    <span>
                      <small>VALID THRU</small>
                      {card.expiry || "MM/YY"}
                    </span>
                  </div>
                </div>
                <div className="form-stack">
                  <label>
                    Номер тестовой карты
                    <input
                      inputMode="numeric"
                      autoComplete="off"
                      value={card.number}
                      onChange={(e) =>
                        field(
                          "number",
                          e.target.value
                            .replace(/\D/g, "")
                            .slice(0, 16)
                            .replace(/(.{4})/g, "$1 ")
                            .trim(),
                        )
                      }
                      maxLength={19}
                    />
                  </label>
                  <label>
                    Имя на демокарте
                    <input
                      autoComplete="off"
                      value={card.name}
                      maxLength={32}
                      onChange={(e) =>
                        field("name", e.target.value.toUpperCase())
                      }
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Срок действия
                      <input
                        inputMode="numeric"
                        autoComplete="off"
                        value={card.expiry}
                        maxLength={5}
                        onChange={(e) => {
                          const v = e.target.value
                            .replace(/\D/g, "")
                            .slice(0, 4);
                          field(
                            "expiry",
                            v.length > 2 ? v.slice(0, 2) + "/" + v.slice(2) : v,
                          );
                        }}
                      />
                    </label>
                    <label>
                      CVC тестовой карты
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={3}
                        value={card.cvc}
                        onChange={(e) =>
                          field("cvc", e.target.value.replace(/\D/g, ""))
                        }
                      />
                    </label>
                  </div>
                </div>
                <p className="fine space">
                  Используйте только 4242 4242 4242 4242 · 12/30 · 123. Не
                  вводите настоящие реквизиты. Поля карты не сохраняются и
                  никуда не отправляются.
                </p>
              </>
            ) : method === "instant" ? (
              <div className="instant-demo">
                <Icon name="spark" size={32} />
                <h3>Без заполнения карты</h3>
                <p>
                  Одно нажатие — и игры в вашей библиотеке. Это демонстрация
                  оформления, не платёжный сервис.
                </p>
              </div>
            ) : null}
          </section>
          <aside className="order-summary panel">
            <p className="eyebrow">ВАШ ЗАКАЗ</p>
            <h2>
              {items.length} {items.length === 1 ? "новый мир" : "новых мира"}
            </h2>
            <div className="checkout-items">
              {items.map((g) => (
                <div key={g.id}>
                  <div className="checkout-thumb">
                    <Art game={g} />
                  </div>
                  <span>
                    {g.title}
                    <small>{g.isPreorder ? "Предзаказ · " + g.platforms : g.genre}</small>
                  </span>
                </div>
              ))}
            </div>
            <label className="payment-label">
              Промокод
              <div className="promo-input">
                <input
                  value={promoDraft}
                  maxLength={20}
                  placeholder="PLAY10"
                  onChange={(e) => setPromoDraft(e.target.value.toUpperCase())}
                />
                <button
                  type="button"
                  onClick={() => {
                    setPromo(promoDraft.trim());
                    setError("");
                  }}
                >
                  Применить
                </button>
              </div>
            </label>
            {promo && (
              <button
                type="button"
                className="promo-applied"
                onClick={() => {
                  setPromo("");
                  setPromoDraft("");
                }}
              >
                {promo} <span>×</span>
              </button>
            )}
            <p className="fine">
              Попробуйте PLAY10 — дополнительная скидка 10%.
            </p>
            {quote && (
              <div className="totals">
                <p className="points-reward">
                  За заказ: ＋{purchasePoints(quote.total)} демобаллов
                </p>
                <div>
                  <span>Стоимость игр</span>
                  <strong>{money(quote.subtotal)}</strong>
                </div>
                <div>
                  <span>Промокод</span>
                  <strong className="accent">−{quote.discount} ₴</strong>
                </div>
                <div className="grand-total">
                  <span>Итого</span>
                  <strong>{money(quote.total)}</strong>
                </div>
              </div>
            )}
            {(error || quoteError) && (
              <p className="payment-error" role="alert">
                {error || quoteError}
              </p>
            )}
            <button className="btn primary pay-submit" disabled={!quote || busy || !state.paymentTestMode}>
              {busy ? "Оформляем…" : recipient ? "Отправить демоподарок" : items.some((g) => g.isPreorder) ? "Оформить учебный предзаказ" : quote?.total === 0 ? "Добавить бесплатно" : "Завершить демопокупку"}
              <Icon name="arrow" />
            </button>
            <p className="payment-footnote">
              <Icon name="shield" size={16} />
              Реальная сумма списания: 0 ₴
            </p>
            <Link className="subtle" to="/cart">
              Изменить состав заказа
            </Link>
          </aside>
        </form>
      )}
    </Gate>
  );
}
