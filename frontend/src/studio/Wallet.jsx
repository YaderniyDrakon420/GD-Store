import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDemo } from "../demo/context";
import { Head, Gate, money } from "./Studio";
import { date } from "./Personal";
import "./extras.css";

const emptyCard = () => ({ number: "", name: "", expiry: "", cvc: "" });

function WalletTopup({ act, enabled }) {
  const [amount, setAmount] = useState("500");
  const [card, setCard] = useState(emptyCard);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const complete = Object.values(card).every((value) => value.trim().length > 0);
  const field = (key, value) => setCard((current) => ({ ...current, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (!enabled || !complete || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      // Card fields are only a local demo: never include them in the request.
      const result = await act(
        { type: "wallet-topup", amount: Number(amount) },
        "Демокошелёк пополнен",
      );
      if (result) setCard(emptyCard());
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="panel form-stack" onSubmit={submit} autoComplete="off" aria-busy={busy}>
      <h2>Пополнить кошелёк</h2>
      <div className="actions">
        {[100, 500, 1000, 2000].map((n) => (
          <button
            type="button"
            key={n}
            className={"btn " + (Number(amount) === n ? "primary" : "")}
            onClick={() => setAmount(String(n))}
            disabled={busy}
          >
            {n} ₴
          </button>
        ))}
      </div>
      <label>
        Своя сумма, ₴
        <input
          required type="number" min={1} max={10000} step={1}
          value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy}
        />
      </label>
      <div className="demo-credit-card" aria-hidden="true">
        <div><strong>GD / PAY</strong><span>DEMO CARD</span></div>
        <span className="card-chip" />
        <p className="card-digits">{card.number || "•••• •••• •••• ••••"}</p>
        <div>
          <span><small>CARDHOLDER</small>{card.name || "YOUR NAME"}</span>
          <span><small>VALID THRU</small>{card.expiry || "MM/YY"}</span>
        </div>
      </div>
      <label>
        Номер тестовой карты
        <input
          required type="text" inputMode="numeric" name="demo-number"
          value={card.number} onChange={(e) => field("number", e.target.value)}
          placeholder="Например, 4242 4242 4242 4242" disabled={busy}
        />
      </label>
      <label>
        Имя на тестовой карте
        <input
          required type="text" name="demo-name"
          value={card.name} onChange={(e) => field("name", e.target.value)}
          placeholder="Например, DEMO USER" disabled={busy}
        />
      </label>
      <div className="form-grid">
        <label>
          Срок действия
          <input
            required type="text" name="demo-expiry"
            value={card.expiry} onChange={(e) => field("expiry", e.target.value)}
            placeholder="ММ/ГГ" disabled={busy}
          />
        </label>
        <label>
          CVC тестовой карты
          <input
            required type="password" inputMode="numeric" name="demo-cvc" autoComplete="off"
            value={card.cvc} onChange={(e) => field("cvc", e.target.value)}
            placeholder="Например, 123" disabled={busy}
          />
        </label>
      </div>
      <p className="fine">
        Заполните все поля любыми тестовыми данными — проверяется только их
        заполнение. Настоящие реквизиты не нужны: данные карты не сохраняются
        и не отправляются, реальные деньги не списываются. Пополнение не
        начисляет демобаллы.
      </p>
      {!enabled && <p className="fine">Учебные пополнения сейчас выключены на сервере.</p>}
      <button className="btn primary" disabled={!enabled || !complete || busy}>
        {busy ? "Пополняем…" : "Пополнить демобаланс"}
      </button>
    </form>
  );
}

export default function Wallet() {
  const { state, me, act } = useDemo();
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
        <WalletTopup key={me?.id || "guest"} act={act} enabled={state.paymentTestMode} />
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
