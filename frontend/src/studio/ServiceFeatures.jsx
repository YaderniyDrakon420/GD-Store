import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useDemo } from "../demo/context";
import { games } from "../server/catalog.mjs";
import { Head, Gate } from "./Studio";
import { Author, date } from "./Personal";
export function Privacy() {
  const { state, me, act } = useDemo();
  if (!me) return null;
  const s = state.settings[me.id] || {};
  const change = async (key, value) =>
    await act(
      {
        type: "privacy-save",
        values: { [key]: value },
      },
      "Настройки сохранены",
    );
  return (
    <section className="panel space">
      <h2>Приватность и уведомления</h2>
      {[
        ["libraryPrivacy", "Библиотека и витрина"],
        ["activityPrivacy", "Активность"],
        ["friendsPrivacy", "Список друзей"],
        ["requestsPrivacy", "Заявки в друзья"],
      ].map(([key, label]) => (
        <label className="setting-row" key={key}>
          {label}
          <select
            aria-label={label}
            value={s[key] || "all"}
            onChange={(e) => change(key, e.target.value)}
          >
            <option value="all">Все</option>
            {key !== "requestsPrivacy" && (
              <option value="friends">Друзья</option>
            )}
            <option value="none">
              {key === "requestsPrivacy" ? "Никто" : "Только я"}
            </option>
          </select>
        </label>
      ))}
      <label className="setting-row">
        Скидки на желаемое
        <input
          type="checkbox"
          checked={s.saleAlerts !== false}
          onChange={(e) => change("saleAlerts", e.target.checked)}
        />
      </label>
      <Link className="btn" to="/points-history">
        История демобаллов
      </Link>
    </section>
  );
}
export function SaleWatcher() {
  const { me, act } = useDemo();
  useEffect(() => {
    if (me && !me.banned) act({ type: "sale-check" });
  }, [me?.id]);
  return null;
}
export function SaleDemo() {
  const { state, me, act } = useDemo();
  const items = games.filter((g) => state.wishlist[me?.id]?.includes(g.id));
  return (
    <section className="panel space">
      <h2>Уведомления о скидках</h2>
      <p className="muted space">
        При проверке сервер сравнивает текущие цены с предыдущими и сообщает
        о снижении цены игр из желаемого.
      </p>
      <div className="actions space">
        <button
          className="btn"
          disabled={!me || me.banned}
          onClick={async () => await act({ type: "sale-check" }, "Цены проверены")}
        >
          Проверить цены
        </button>
        <button
          className="btn"
          disabled={
            !state.paymentTestMode || !items.length || state.settings[me?.id]?.saleAlerts === false
          }
          onClick={async () =>
            await act(
              { type: "sale-demo", game: items[0].id },
              "Пример отправлен в уведомления",
            )
          }
        >
          Пример уведомления
        </button>
      </div>
      <p className="fine space">
        Пример не меняет цену игры. Добавьте игру в желаемое, чтобы попробовать.
      </p>
    </section>
  );
}
export function PointsHistory() {
  const { state, me } = useDemo();
  const [filter, setFilter] = useState("all");
  const rows = (state.pointsLog || []).filter(
    (r) =>
      r.user === me?.id &&
      (filter === "all" ||
        (filter === "income" ? r.amount >= 0 : r.amount < 0)),
  );
  return (
    <Gate>
      <Head
        eyebrow="YOUR POINTS"
        title="История демобаллов"
        text="Начисления за игры и покупки оформления."
      >
        <div className="points-balance">
          <strong>{me?.points || 0}</strong>
          <span>демобаллов</span>
        </div>
      </Head>
      <div className="tabs">
        {[
          ["all", "Все"],
          ["income", "Начисления"],
          ["spent", "Расходы"],
        ].map(([v, l]) => (
          <button
            className={filter === v ? "active" : ""}
            key={v}
            onClick={() => setFilter(v)}
          >
            {l}
          </button>
        ))}
      </div>
      <section className="panel">
        {rows.map((r) => (
          <div className="ledger-row" key={r.id}>
            <div>
              <strong>{r.text}</strong>
              <small>
                {r.at ? date(r.at) : "Баланс на момент начала истории"}
              </small>
            </div>
            <strong className={r.amount >= 0 ? "accent" : ""}>
              {r.amount > 0 ? "+" : ""}
              {r.amount}
            </strong>
          </div>
        ))}
        {!rows.length && <p className="muted">Операций пока нет.</p>}
      </section>
    </Gate>
  );
}
export function ReviewList({ game }) {
  const { state, me, act } = useDemo();
  const [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("new");
  const reviews = state.reviews
    .filter(
      (r) =>
        r.game === game &&
        (filter === "all" || r.positive === (filter === "positive")),
    )
    .sort((a, b) =>
      sort === "helpful"
        ? (b.helpful?.length || 0) - (a.helpful?.length || 0)
        : Date.parse(b.at) - Date.parse(a.at),
    );
  return (
    <>
      <div className="party-filters">
        <select
          aria-label="Оценка отзыва"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Все отзывы</option>
          <option value="positive">Рекомендуют</option>
          <option value="negative">Не рекомендуют</option>
        </select>
        <select
          aria-label="Сортировка отзывов"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="new">Сначала новые</option>
          <option value="helpful">Сначала полезные</option>
        </select>
      </div>
      {reviews.map((r) => (
        <article className="review" key={r.id}>
          <Author id={r.author} />
          <span className="accent">
            {r.positive ? "Рекомендует" : "Не рекомендует"}
          </span>
          <p>{r.text}</p>
          <button
            className="btn"
            disabled={!me || me.banned || me.id === r.author}
            aria-pressed={r.helpful?.includes(me?.id) || false}
            onClick={async () => await act({ type: "review-vote", review: r.id })}
          >
            {r.helpful?.includes(me?.id) ? "Полезно ✓" : "Полезно"} ·{" "}
            {r.helpful?.length || 0}
          </button>
        </article>
      ))}
      {!reviews.length && (
        <p className="muted space">Отзывов с такой оценкой пока нет.</p>
      )}
    </>
  );
}
