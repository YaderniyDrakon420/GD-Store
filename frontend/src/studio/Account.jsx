import { NotificationSettings } from "./TeamChat";
import { Privacy, SaleDemo } from "./ServiceFeatures";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDemo } from "../demo/context";
import { games } from "../server/catalog.mjs";
import { Head, Avatar, Gate, Empty, money } from "./Studio";
import { Modal, date } from "./Personal";
export { default as Account } from "./AuthScreen";
export function Settings() {
  const { state, me, act, reset } = useDemo();
  const [confirm, setConfirm] = useState(false);
  const nav = useNavigate();
  const settings = state.settings[me?.id] || {};
  return (
    <>
      <Head
        eyebrow="MAKE IT YOURS"
        title="Настройки пространства"
        text="Оформление, аккаунт и ваши настройки."
      />
      <div className="settings-grid">
        <section className="panel">
          <h2>Ваш профиль</h2>
          <p className="muted space">
            Профиль и переписки сохраняются на сервере. Для другого аккаунта
            используйте вход с его логином и паролем.
          </p>
          <div className="account-choices">
            {state.users
              .filter((u) => u.id === me?.id)
              .map((u) => (
                <button
                  key={u.id}
                  onClick={() => nav("/profile")}
                >
                  <Avatar user={u} />
                  <span>
                    {u.name}
                    <small>@{u.handle}</small>
                  </span>
                  <span className="accent">{u.id === me?.id ? "✓" : "→"}</span>
                </button>
              ))}
          </div>
          <Link className="btn" to="/register">
            ＋ Новый профиль
          </Link>
          <Link className="btn space" to="/login">
            Войти с паролем
          </Link>
        </section>
        <div>
          <section className="panel">
            <h2>Оформление</h2>
            <Gate>
              <div className="setting-row">
                <div>
                  <strong>Компактный интерфейс</strong>
                  <p className="muted">Меньше отступы в карточках и списках</p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Компактный интерфейс"
                  checked={!!settings.compact}
                  onChange={async (e) =>
                    await act({
                      type: "settings",
                      values: { compact: e.target.checked },
                    })
                  }
                />
              </div>
              <div className="setting-row">
                <div>
                  <strong>Меньше движения</strong>
                  <p className="muted">Отключить эффекты наведения</p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Отключить анимации"
                  checked={!!settings.motionOff}
                  onChange={async (e) =>
                    await act({
                      type: "settings",
                      values: { motionOff: e.target.checked },
                    })
                  }
                />
              </div>
              <Link className="btn" to="/profile">
                Изменить профиль
              </Link>
            </Gate>
          </section>
          <Privacy />
          <NotificationSettings />
          <SaleDemo />
          <section className="panel space">
            <h2>Настройки аккаунта</h2>
            <p className="muted space">
              Настройки привязаны к аккаунту. Здесь можно вернуть стандартное
              оформление и параметры приватности.
            </p>
            <button
              className="btn danger space"
              onClick={() => setConfirm(true)}
            >
              Сбросить настройки
            </button>
          </section>
        </div>
      </div>
      {confirm && (
        <Modal
          title="Сбросить настройки аккаунта?"
          onClose={() => setConfirm(false)}
        >
          <p className="muted">
            Оформление, приватность и уведомления вернутся к стандартным значениям.
            Библиотека, сообщения и заказы сохранятся.
          </p>
          <div className="actions space">
            <button className="btn" onClick={() => setConfirm(false)}>
              Отмена
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                if (!await reset()) return;
                setConfirm(false);
                nav("/");
              }}
            >
              Сбросить
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Orders() {
  const { state, me, act } = useDemo();
  const [confirmOrder, setConfirmOrder] = useState(null);
  const orders = state.orders.filter((o) => o.user === me?.id);
  return (
    <Gate>
      <Head
        eyebrow="ВАШИ ПОКУПКИ"
        title="История демозаказов"
        text="Заказы сохранены на сервере. Реальные деньги не списываются."
      />
      {orders.map((o) => (
        <section className="panel order space" key={o.id}>
          <div className="section-title">
            <div>
              <p className="eyebrow">ДЕМОЗАКАЗ / {o.id.slice(0, 8)}</p>
              <h3>{date(o.at)}</h3>
            </div>
            <span className="pill accent">
              {o.status !== "paid" ? ({pending: "Ожидает оплаты", cancelled: "Отменён", refunded: "Возвращён", failed: "Ошибка оплаты", expired: "Истёк"}[o.status] || o.status) : o.recipient && o.recipient !== o.user
                ? "Подарок отправлен"
                : o.awaitingRelease?.length ? "Предзаказ · ожидает релиза" : "В библиотеке"}
            </span>
          </div>
          {o.recipient && o.recipient !== o.user && (
            <p className="muted">
              Для {state.users.find((u) => u.id === o.recipient)?.name}
            </p>
          )}
          {o.promo && (
            <p className="fine">
              Промокод {o.promo} · скидка {o.discount} ₴
            </p>
          )}
          {o.games.map((id) => (
            <Link className="order-game" to={"/game/" + id} key={id}>
              {games.find((g) => g.id === id)?.title}
              <span>↗</span>
            </Link>
          ))}
          <div className="order-total">
            <span>Демонстрационная сумма</span>
            <strong>{money(o.total)}</strong>
            <small className="accent">{o.status === "refunded" ? "Баллы возвращены" : `＋${o.pointsEarned || 0} демобаллов`}</small>
          </div>
          {["paid", "pending"].includes(o.status) && <button className="btn space" onClick={() => setConfirmOrder(o)}>{o.status === "paid" ? "Вернуть учебную покупку" : "Отменить заказ"}</button>}
        </section>
      ))}
      {!orders.length && (
        <Empty
          title="Здесь будут ваши заказы"
          text="Добавьте игру в корзину и оформите демозаказ."
        />
      )}
      {confirmOrder && <Modal title="Подтвердить действие с заказом?" onClose={() => setConfirmOrder(null)}>
        <p className="muted">{confirmOrder.status === "paid" ? "Игры этого заказа будут убраны из библиотеки получателя. Учебные средства вернутся в кошелёк, если покупка оплачена из него; начисленные баллы будут отменены." : "Заказ будет отменён."}</p>
        <div className="actions space"><button className="btn" onClick={() => setConfirmOrder(null)}>Назад</button><button className="btn danger" onClick={async () => { if (await act({ type: confirmOrder.status === "paid" ? "order-refund" : "order-cancel", order: confirmOrder.id }, "Заказ обновлён")) setConfirmOrder(null); }}>Подтвердить</button></div>
      </Modal>}
    </Gate>
  );
}
