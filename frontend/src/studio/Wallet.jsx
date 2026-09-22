import { useState } from "react";
import { Link } from "react-router-dom";
import { useDemo } from "../demo/context";
import { Head, Gate, money } from "./Studio";
import { date } from "./Personal";
export default function Wallet() {
  const { state, me, act } = useDemo();
  const [amount, setAmount] = useState("500");
  return (
    <Gate>
      <Head
        eyebrow="GD WALLET / DEMO"
        title="Ваш кошелёк"
        text="Пополняйте демобаланс и оплачивайте игры."
      />
      <div className="wallet-layout">
        <section className="wallet-card">
          <p>Доступно для покупок</p>
          <h2>{new Intl.NumberFormat("ru-RU").format(me?.wallet || 0)} ₴</h2>
            <span>УЧЕБНЫЙ БАЛАНС</span>
          <Link className="btn space" to="/points-history">
            ✦ {me?.points || 0} демобаллов →
          </Link>
        </section>
        <form
          className="panel form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            await act(
              { type: "wallet-topup", amount: Number(amount) },
              "Демокошелёк пополнен",
            );
          }}
        >
          <h2>Пополнить кошелёк</h2>
          <div className="actions">
            {[100, 500, 1000, 2000].map((n) => (
              <button
                type="button"
                key={n}
                className={"btn " + (Number(amount) === n ? "primary" : "")}
                onClick={() => setAmount(String(n))}
              >
                {n} ₴
              </button>
            ))}
          </div>
          <label>
            Своя сумма, ₴
            <input
              required
              type="number"
              min={1}
              max={10000}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <p className="fine">
            Демонстрационное пополнение без карты и списания денег. Пополнение
            не начисляет демобаллы — они выдаются за покупки игр.
          </p>
          <button className="btn primary" disabled={!state.paymentTestMode}>Добавить демосредства</button>
        </form>
      </div>
      <section className="panel space">
        <h2>Операции кошелька</h2>
        {(state.walletLog || [])
          .filter((r) => r.user === me?.id)
          .map((r) => (
            <div className="ledger-row" key={r.id}>
              <div>
                <strong>{r.text}</strong>
                <small>{date(r.at)}</small>
              </div>
              <strong className={r.amount > 0 ? "accent" : ""}>
                {r.amount > 0 ? "+" : "−"}
                {money(Math.abs(r.amount))}
              </strong>
            </div>
          ))}
        {!(state.walletLog || []).some((r) => r.user === me?.id) && (
          <p className="muted space">Здесь появятся пополнения и покупки.</p>
        )}
      </section>
    </Gate>
  );
}
