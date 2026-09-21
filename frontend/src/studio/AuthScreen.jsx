import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDemo } from "../demo/context";
import { Art, Avatar } from "./Studio";

import Icon from "../components/Icon";
export default function AuthScreen({ register = false, reset = false }) {
  const { games } = useDemo();
  const { account } = useDemo();
  const navigate = useNavigate();
  const [form, setForm] = useState({
      name: "",
      handle: "",
      email: "",
      login: "",
      password: "",
      confirm: "",
      recovery: "",
    }),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [code] = useState(""),
    [done, setDone] = useState(false);
  const field = (key, value) => {
    setForm({ ...form, [key]: value });
    setError("");
  };
  async function submit(e) {
    e.preventDefault();
    setError("");
    if ((register || reset) && form.password !== form.confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    setBusy(true);
    try {
      await account({
        ...form,
        mode: register ? "register" : reset ? "reset" : "login",
      });
      if (register) {
        navigate("/profile");
        return;
      } else if (reset) {
        setDone(true);
        setForm({ ...form, password: "", confirm: "", recovery: "" });
      } else navigate("/profile");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-experience">
      <aside className="auth-art">
        <Art game={games[0]} />
        <div>
          <span className="pill">GD STORE / PLAYER ID</span>
          <h1>
            Твой следующий
            <br />
            мир начинается
            <br />
            <em>здесь.</em>
          </h1>
          <p>
            Игры, друзья и истории,
            <br />
            которые остаются с тобой.
          </p>
          <div className="auth-perks">
            <span>
              <Icon name="library" />
              Своя коллекция
            </span>
            <span>
              <Icon name="users" />
              Своя команда
            </span>
          </div>
        </div>
      </aside>
      <section className="auth-content">
        <div className="auth-tabs">
          <Link className={!register && !reset ? "active" : ""} to="/login">
            Вход
          </Link>
          <Link className={register ? "active" : ""} to="/register">
            Регистрация
          </Link>
        </div>
        {code ? (
          <div className="recovery-success">
            <Icon name="shield" size={38} />
            <h2>Профиль готов</h2>
            <p>
              Сохраните код восстановления. Он понадобится, если вы забудете
              локальный пароль.
            </p>
            <code>{code}</code>
            <p className="fine">
              Код показан один раз. Письмо не отправляется: это локальная
              демонстрация.
            </p>
            <button
              className="btn primary"
              onClick={() => navigate("/profile")}
            >
              Я сохранил код →
            </button>
          </div>
        ) : done ? (
          <div className="recovery-success">
            <Icon name="check" size={38} />
            <h2>Пароль обновлён</h2>
            <p>Войдите с новым локальным паролем.</p>
            <Link className="btn primary" to="/login">
              Перейти ко входу
            </Link>
          </div>
        ) : (
          <>
            <p className="eyebrow">
              {reset ? "ACCOUNT RECOVERY" : "WELCOME TO YOUR WORLD"}
            </p>
            <h2>
              {register
                ? "Создай свой Player ID"
                : reset
                  ? "Вернём доступ"
                  : "Рады видеть снова"}
            </h2>
            <p className="auth-hint">
              {register
                ? "Выберите имя, под которым вас узнают друзья."
                : reset
                  ? "Введите логин и сохранённый код восстановления."
                  : "Войдите в свой аккаунт GD Store."}
            </p>
            <form className="form-stack" onSubmit={submit}>
              {register ? (
                <>
                  <label>
                    Имя игрока
                    <input
                      required
                      autoComplete="nickname"
                      value={form.name}
                      maxLength={40}
                      onChange={(e) => field("name", e.target.value)}
                      placeholder="Как вас называть?"
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Логин
                      <input
                        required
                        pattern="[A-Za-z0-9_]{3,20}"
                        title="3–20 латинских букв, цифр или _"
                        maxLength={20}
                        value={form.handle}
                        onChange={(e) => field("handle", e.target.value)}
                        placeholder="player_one"
                      />
                    </label>
                    <label>
                      Email
                      <input
                        required
                        type="email"
                        maxLength={120}
                        value={form.email}
                        onChange={(e) => field("email", e.target.value)}
                        placeholder="player@example.com"
                      />
                    </label>
                  </div>
                </>
              ) : (
                <label>
                  Логин
                  <input
                    required
                    value={form.login}
                    maxLength={120}
                    autoComplete="username"
                    onChange={(e) => field("login", e.target.value)}
                    placeholder="Ваш Player ID"
                  />
                </label>
              )}
              {reset && (
                <label>
                  Код восстановления
                  <input
                    required
                    autoComplete="off"
                    value={form.recovery}
                    maxLength={40}
                    onChange={(e) =>
                      field("recovery", e.target.value.toUpperCase())
                    }
                    placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                  />
                </label>
              )}
              <label>
                {reset ? "Новый пароль" : "Пароль"}
                <div className="password-field">
                  <input
                    required
                    minLength={8}
                    maxLength={128}
                    type={show ? "text" : "password"}
                    autoComplete={
                      register || reset ? "new-password" : "current-password"
                    }
                    value={form.password}
                    onChange={(e) => field("password", e.target.value)}
                    placeholder="От 8 символов"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-label={show ? "Скрыть пароль" : "Показать пароль"}
                  >
                    {show ? "Скрыть" : "Показать"}
                  </button>
                </div>
              </label>
              {(register || reset) && (
                <label>
                  Повторите пароль
                  <input
                    required
                    minLength={8}
                    maxLength={128}
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={form.confirm}
                    onChange={(e) => field("confirm", e.target.value)}
                  />
                </label>
              )}
              {!register && !reset && (
                <Link className="forgot-link" to="/forgot-password">
                  Забыли пароль?
                </Link>
              )}
              {error && (
                <p className="payment-error" role="alert">
                  {error}
                </p>
              )}
              <button className="btn primary auth-submit" disabled={busy}>
                {busy
                  ? "Проверяем…"
                  : register
                    ? "Создать профиль"
                    : reset
                      ? "Обновить пароль"
                      : "Войти"}
                <Icon name="arrow" />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
