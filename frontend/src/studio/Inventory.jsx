import { useState } from "react";
import { Link } from "react-router-dom";
import { useDemo } from "../demo/context";
import { Head, Gate, money } from "./Studio";
import { Modal, Author, date } from "./Personal";

const statusNames = {
  pending: "Ожидает ответа",
  accepted: "Завершён",
  declined: "Отклонён",
  cancelled: "Отменён",
  expired: "Истёк",
  unavailable: "Предметы изменились",
};
const names = (items) =>
  items.map((i) => i.title).join(", ") || "Без предметов";

export default function Inventory() {
  const { state, me, act } = useDemo();
  const [tab, setTab] = useState("items"),
    [peer, setPeer] = useState(""),
    [offered, setOffered] = useState([]),
    [requested, setRequested] = useState([]);
  const [listing, setListing] = useState(null),
    [price, setPrice] = useState("10"),
    [confirm, setConfirm] = useState(null),
    [busy, setBusy] = useState(false);
  const items = state.inventory || [],
    own = items.filter((i) => i.owner === me?.id);
  const friends = state.users.filter(
    (u) =>
      state.friends.some(
        (f) =>
          f.status === "accepted" &&
          [f.from, f.to].includes(me?.id) &&
          [f.from, f.to].includes(u.id),
      ) && u.id !== me?.id,
  );
  const choose = (id, selected, update) =>
    update(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  async function execute() {
    setBusy(true);
    try {
      if (await act(confirm.action, "Готово")) {
        setConfirm(null);
        setOffered([]);
        setRequested([]);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Gate>
      <Head
        title="Инвентарь"
        text="Коллекционные карточки GD Store. Обмены с друзьями и площадка за учебный баланс."
      >
        <Link className="btn" to="/progress">
          Как получить карточки
        </Link>
      </Head>
      <div className="tabs">
        {[
          ["items", "Мои предметы"],
          ["trades", "Обмены"],
          ["market", "Торговая площадка"],
        ].map(([key, name]) => (
          <button
            className={tab === key ? "active" : ""}
            key={key}
            onClick={() => setTab(key)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "items" && (
        <>
          <div className="gd-feature-grid">
            {own.map((i) => (
              <article className="panel" key={i.id}>
                <span className="pill">Коллекционная карточка</span>
                <h3 className="space">{i.title}</h3>
                <small>#{i.id.slice(0, 8)}</small>
                <p className="muted space">
                  {i.reserved
                    ? "Зарезервирована в обмене или продаже"
                    : "Можно обменять или продать"}
                </p>
                <button
                  className="btn"
                  disabled={i.reserved || !state.paymentTestMode}
                  onClick={() => {
                    setListing(i);
                    setPrice("10");
                  }}
                >
                  Выставить на продажу
                </button>
              </article>
            ))}
          </div>
          {!own.length && (
            <p className="panel muted">
              Получите любой значок — вместе с ним появится карточка. Повторно
              за тот же значок она не выдаётся.
            </p>
          )}
        </>
      )}
      {tab === "trades" && (
        <>
          <form
            className="panel form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirm({
                title: "Отправить предложение обмена?",
                text: `Вы отдаёте: ${names(items.filter((i) => offered.includes(i.id)))}. Вы получаете: ${names(items.filter((i) => requested.includes(i.id)))}. Друг должен подтвердить обмен.`,
                action: {
                  type: "trade-create",
                  user: peer,
                  offered,
                  requested,
                },
              });
            }}
          >
            <h2>Новый обмен</h2>
            <label>
              Друг
              <select
                required
                value={peer}
                onChange={(e) => {
                  setPeer(e.target.value);
                  setRequested([]);
                }}
              >
                <option value="">Выберите друга</option>
                {friends.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="gd-feature-grid">
              {[
                ["Вы отдаёте", own, offered, setOffered],
                [
                  "Вы получаете",
                  items.filter((i) => i.owner === peer),
                  requested,
                  setRequested,
                ],
              ].map(([title, choices, selected, change]) => (
                <fieldset key={title}>
                  <legend>{title}</legend>
                  {choices
                    .filter((i) => !i.reserved)
                    .map((i) => (
                      <label className="setting-row" key={i.id}>
                        {i.title}
                        <input
                          type="checkbox"
                          checked={selected.includes(i.id)}
                          onChange={() => choose(i.id, selected, change)}
                        />
                      </label>
                    ))}
                  {!choices.some((i) => !i.reserved) && (
                    <p className="muted">Свободных предметов пока нет.</p>
                  )}
                </fieldset>
              ))}
            </div>
            <button
              className="btn primary"
              disabled={!peer || (!offered.length && !requested.length)}
            >
              Проверить предложение
            </button>
            <small className="muted">
              Предложение действует 7 дней. Ваши выбранные карточки будут
              зарезервированы.
            </small>
          </form>
          {(state.trades || []).map((t) => (
            <article className="panel space" key={t.id}>
              <div className="section-title">
                <Author id={t.from === me?.id ? t.to : t.from} />
                <span className="pill">
                  {statusNames[t.status] || t.status}
                </span>
              </div>
              <p className="space">Отправитель отдаёт: {names(t.offered)}</p>
              <p>Получатель отдаёт: {names(t.requested)}</p>
              <small>{date(t.at)}</small>
              {t.status === "pending" && (
                <div className="actions space">
                  {t.to === me?.id && (
                    <button
                      className="btn primary"
                      onClick={() =>
                        setConfirm({
                          title: "Подтвердить обмен?",
                          text: `Вы отдаёте: ${names(t.requested)}. Вы получаете: ${names(t.offered)}. Предметы перейдут новым владельцам сразу.`,
                          action: { type: "trade-accept", trade: t.id },
                        })
                      }
                    >
                      Принять
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() =>
                      act({
                        type:
                          t.from === me?.id ? "trade-cancel" : "trade-decline",
                        trade: t.id,
                      })
                    }
                  >
                    {t.from === me?.id ? "Отменить" : "Отклонить"}
                  </button>
                </div>
              )}
            </article>
          ))}
        </>
      )}
      {tab === "market" && (
        <>
          <p className="panel">
            Учебный баланс: <strong>{money(me?.wallet || 0)}</strong> ·{" "}
            <Link to="/wallet">Пополнить</Link>. Все сделки используют
            виртуальные средства GD Store.
          </p>
          <div className="gd-feature-grid space">
            {(state.market || [])
              .filter((l) => l.status === "active")
              .map((l) => (
                <article className="panel" key={l.id}>
                  <h3>{l.item.title}</h3>
                  <div className="space">
                    <Author id={l.seller} />
                  </div>
                  <p className="space">{money(l.price)}</p>
                  {l.seller === me?.id ? (
                    <button
                      className="btn"
                      onClick={() =>
                        act({ type: "market-cancel", listing: l.id })
                      }
                    >
                      Снять с продажи
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      disabled={!state.paymentTestMode}
                      onClick={() =>
                        setConfirm({
                          title: "Купить карточку?",
                          text: `${l.item.title} за ${money(l.price)} с учебного кошелька.`,
                          action: { type: "market-buy", listing: l.id },
                        })
                      }
                    >
                      Купить
                    </button>
                  )}
                </article>
              ))}
          </div>
          {!(state.market || []).some((l) => l.status === "active") && (
            <p className="muted space">Предметов в продаже пока нет.</p>
          )}
          <h3 className="space">Мои сделки</h3>
          {(state.market || [])
            .filter((l) => l.status !== "active")
            .map((l) => (
              <p className="panel space" key={l.id}>
                {l.item.title} · {money(l.price)} ·{" "}
                {l.status === "sold"
                  ? l.seller === me?.id
                    ? "Продано"
                    : "Куплено"
                  : "Снято с продажи"}
              </p>
            ))}
        </>
      )}
      {listing && (
        <Modal title="Продать карточку" onClose={() => setListing(null)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                if (
                  await act(
                    { type: "market-list", item: listing.id, price },
                    "Предмет выставлен",
                  )
                )
                  setListing(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>{listing.title}</p>
            <label>
              Цена в учебном кошельке
              <input
                type="number"
                min="0.01"
                max="10000"
                step="0.01"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={busy}>
              Выставить
            </button>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => !busy && setConfirm(null)}>
          <p>{confirm.text}</p>
          <div className="actions space">
            <button
              className="btn"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Отмена
            </button>
            <button className="btn primary" disabled={busy} onClick={execute}>
              Подтвердить
            </button>
          </div>
        </Modal>
      )}
    </Gate>
  );
}
