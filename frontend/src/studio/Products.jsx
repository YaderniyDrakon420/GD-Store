import { useState } from "react";
import { Link } from "react-router-dom";
import { useDemo } from "../demo/context";
import { games } from "../server/catalog.mjs";
import { api } from "../server/api.mjs";
import { Head, money } from "./Studio";
import { Modal } from "./Personal";

const kinds = { edition: "Издание", dlc: "Дополнение", bundle: "Комплект" };
export function ProductOffers({ game }) {
  const { state, me, act, notify } = useDemo();
  const [quote, setQuote] = useState(null),
    [busy, setBusy] = useState(false);
  const products = (state.products || []).filter(
    (p) => p.published && (!game || p.game === game || p.games.includes(game)),
  );
  async function calculate(p) {
    setBusy(true);
    try {
      setQuote({
        ...(await api.request("quote/", {
          method: "POST",
          body: { product: p.id },
          user: me.id,
        })),
        product: p.id,
      });
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="gd-feature-grid">
        {products.map((p) => (
          <article className="panel" key={p.id}>
            <span className="pill">{kinds[p.kind]}</span>
            <h3 className="space">{p.title}</h3>
            <p className="feature-prose">{p.description}</p>
            <p className="muted">
              {p.kind === "dlc" ? "Нужна основная игра: " : "В составе: "}
              {(p.kind === "bundle" ? p.games : [p.game])
                .map((id) => games.find((g) => g.id === id)?.title || id)
                .join(", ")}
            </p>
            <p className="space">
              <strong>{money(p.finalPrice)}</strong>
              {p.discount > 0 && <span className="pill">−{p.discount}%</span>}
            </p>
            {p.kind === "bundle" && (
              <p className="fine space">
                При расчёте учитывается стоимость только недостающих игр.
              </p>
            )}
            {(state.licenses || []).some((l) => l.product === p.id) ? (
              <Link className="btn" to="/library">
                В библиотеке
              </Link>
            ) : me ? (
              <button
                className="btn primary"
                disabled={busy || !state.paymentTestMode}
                onClick={() => calculate(p)}
              >
                Рассчитать покупку
              </button>
            ) : (
              <Link className="btn" to="/login">
                Войти для покупки
              </Link>
            )}
          </article>
        ))}
      </div>
      {!products.length && (
        <p className="muted">
          Издания, дополнения и комплекты пока не опубликованы.
        </p>
      )}
      {quote && (
        <Modal
          title="Подтверждение учебной покупки"
          onClose={() => !busy && setQuote(null)}
        >
          <h3>{quote.title}</h3>
          <p className="space">
            С учебного кошелька спишется <strong>{money(quote.total)}</strong>.
            Баланс: {money(me?.wallet || 0)}.
          </p>
          <p className="muted space">
            {quote.games.length
              ? "Новые игры: " +
                quote.games
                  .map((id) => games.find((g) => g.id === id)?.title || id)
                  .join(", ")
              : "Цифровое дополнение появится в библиотеке."}
          </p>
          {quote.preorders.length > 0 && (
            <p className="fine">
              В составе есть предзаказ: он будет ожидать релиза.
            </p>
          )}
          <div className="actions space">
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await act(
                      {
                        type: "product-buy",
                        product: quote.product,
                        token: quote.token,
                      },
                      "Покупка добавлена в библиотеку",
                    );
                  setQuote(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Подтвердить покупку
            </button>
            <Link className="btn" to="/wallet">
              Пополнить
            </Link>
          </div>
        </Modal>
      )}
    </>
  );
}

export function ProductLibrary() {
  const { state } = useDemo();
  if (!state.licenses?.length) return null;
  return (
    <section className="panel space">
      <h2>Мои издания и дополнения</h2>
      {state.licenses.map((p) => (
        <details className="space" key={p.product}>
          <summary>
            {p.title} · {kinds[p.kind]}
          </summary>
          <p className="feature-prose">
            {p.content || "Лицензия сохранена в вашей учебной библиотеке."}
          </p>
          <Link to="/orders">Открыть заказ и возврат</Link>
        </details>
      ))}
    </section>
  );
}

const blank = {
  slug: "",
  title: "",
  kind: "bundle",
  game: "",
  games: [],
  description: "",
  bonus: "",
  price: "0",
  discount: 0,
  published: true,
};
export default function Products() {
  const { state, me, act } = useDemo();
  const [form, setForm] = useState(null),
    [busy, setBusy] = useState(false);
  const field = (key, value) => setForm({ ...form, [key]: value });
  return (
    <>
      <Head
        title="Издания и комплекты"
        text="Дополнения, расширенные издания и наборы игр. Оплата только учебным кошельком."
      >
        {me?.role === "admin" && (
          <button className="btn primary" onClick={() => setForm({ ...blank })}>
            Добавить товар
          </button>
        )}
      </Head>
      <ProductOffers />
      {me?.role === "admin" && (
        <section className="panel space">
          <h2>Управление товарами</h2>
          {(state.products || []).map((p) => (
            <div className="setting-row" key={p.id}>
              <span>
                {p.title} · {p.published ? "Опубликован" : "Черновик"}
              </span>
              <button
                className="btn"
                onClick={() =>
                  setForm({
                    ...p,
                    slug: p.id,
                    price: String(p.price),
                    bonus: p.bonus || "",
                    editing: true,
                  })
                }
              >
                Изменить
              </button>
            </div>
          ))}
        </section>
      )}
      {form && (
        <Modal title="Товар магазина" onClose={() => !busy && setForm(null)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                if (
                  await act({ ...form, type: "product-save" }, "Товар сохранён")
                )
                  setForm(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Код
              <input
                required
                maxLength={50}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                disabled={form.editing}
                value={form.slug}
                onChange={(e) => field("slug", e.target.value)}
              />
            </label>
            <label>
              Название
              <input
                required
                maxLength={160}
                value={form.title}
                onChange={(e) => field("title", e.target.value)}
              />
            </label>
            <label>
              Тип
              <select
                value={form.kind}
                onChange={(e) => field("kind", e.target.value)}
              >
                {Object.entries(kinds).map(([key, title]) => (
                  <option key={key} value={key}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            {form.kind !== "bundle" ? (
              <label>
                Основная игра
                <select
                  required
                  value={form.game || ""}
                  onChange={(e) => field("game", e.target.value)}
                >
                  <option value="">Выберите игру</option>
                  {games
                    .filter((g) => g.available !== false)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <fieldset>
                <legend>Игры комплекта</legend>
                {games
                  .filter((g) => g.available !== false)
                  .map((g) => (
                    <label className="setting-row" key={g.id}>
                      {g.title}
                      <input
                        type="checkbox"
                        checked={form.games.includes(g.id)}
                        onChange={() =>
                          field(
                            "games",
                            form.games.includes(g.id)
                              ? form.games.filter((id) => id !== g.id)
                              : [...form.games, g.id],
                          )
                        }
                      />
                    </label>
                  ))}
              </fieldset>
            )}
            <label>
              Описание
              <textarea
                maxLength={5000}
                rows={3}
                value={form.description}
                onChange={(e) => field("description", e.target.value)}
              />
            </label>
            <label>
              Цифровое содержимое для владельца
              <textarea
                maxLength={12000}
                rows={4}
                value={form.bonus}
                onChange={(e) => field("bonus", e.target.value)}
              />
            </label>
            <div className="form-grid">
              <label>
                Цена
                <input
                  type="number"
                  min="0"
                  max="999999"
                  step="0.01"
                  required
                  value={form.price}
                  onChange={(e) => field("price", e.target.value)}
                />
              </label>
              <label>
                Скидка %
                <input
                  type="number"
                  min="0"
                  max="100"
                  required
                  value={form.discount}
                  onChange={(e) => field("discount", Number(e.target.value))}
                />
              </label>
            </div>
            <label className="setting-row">
              Опубликован
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => field("published", e.target.checked)}
              />
            </label>
            <button className="btn primary" disabled={busy}>
              Сохранить
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
