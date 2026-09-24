import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDemo } from "../demo/context";
import { api } from "../server/api.mjs";
import { Head, Gate } from "./Studio";

export default function Security() {
  const { me } = useDemo();
  const [data, setData] = useState(null),
    [password, setPassword] = useState(""),
    [otp, setOtp] = useState("");
  const [setup, setSetup] = useState(null),
    [codes, setCodes] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (me)
      api
        .request("security/")
        .then((r) => {
          if (!cancelled) setData(r);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [me?.id]);
  async function action(mode, extra = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.request("security/", {
        method: "POST",
        body: { mode, password, otp, ...extra },
        user: me.id,
      });
      if (result.secret) setSetup(result);
      if (result.backupCodes) {
        setCodes(result.backupCodes);
        setSetup(null);
      }
      if (mode !== "totp-setup") {
        setPassword("");
        setOtp("");
      }
      setNotice(
        mode === "send-verification"
          ? "Письмо с подтверждением отправлено."
          : "Настройки сохранены.",
      );
      setData(await api.request("security/"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Gate>
      <Head
        title="Защита аккаунта"
        text="Почта, двухфакторный вход и устройства, на которых вы вошли."
      />
      {error && (
        <p className="payment-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="panel" role="status">
          {notice}
        </p>
      )}
      {data && (
        <>
          <section className="panel space">
            <h2>Почта</h2>
            <p className="space">
              {data.email} ·{" "}
              {data.emailVerified ? "Подтверждена" : "Не подтверждена"}
            </p>
            {!data.emailVerified && (
              <button
                className="btn space"
                disabled={busy}
                onClick={() => action("send-verification")}
              >
                Отправить подтверждение
              </button>
            )}
            {data.mailMode === "local" && (
              <p className="fine space">
                Локальный режим: письмо сохраняется в папку backend/local_emails
                на компьютере с сервером. Откройте из него ссылку.
              </p>
            )}
          </section>
          <section className="panel space form-stack">
            <h2>
              Двухфакторный вход {data.twoFactor ? "включён" : "выключен"}
            </h2>
            <p className="muted">
              После пароля понадобится код приложения-аутентификатора. Для
              изменения защиты и завершения сеансов подтвердите текущий пароль.
            </p>
            <label>
              Текущий пароль
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {(data.twoFactor || setup) && (
              <label>
                Код приложения или резервный код
                <input
                  autoComplete="one-time-code"
                  maxLength={32}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
              </label>
            )}
            {setup ? (
              <>
                <p>
                  Добавьте в аутентификатор аккаунт GD Store с этим ключом (тип:
                  по времени, 6 цифр):
                </p>
                <code className="security-codes">{setup.secret}</code>
                <a className="btn" href={setup.uri}>
                  Открыть аутентификатор
                </a>
                <button
                  className="btn primary"
                  disabled={busy || !password || !otp}
                  onClick={() => action("totp-enable")}
                >
                  Проверить код и включить
                </button>
              </>
            ) : (
              <button
                className="btn"
                disabled={busy || !password || (data.twoFactor && !otp)}
                onClick={() =>
                  action(data.twoFactor ? "totp-disable" : "totp-setup")
                }
              >
                {data.twoFactor ? "Отключить 2FA" : "Настроить 2FA"}
              </button>
            )}
            {codes && (
              <div>
                <h3>Сохраните резервные коды</h3>
                <p className="muted space">
                  Показаны один раз. Каждый заменяет код приложения только для
                  одного входа или действия.
                </p>
                <pre className="security-codes">{codes.join("\n")}</pre>
                <button className="btn" onClick={() => setCodes(null)}>
                  Я сохранил коды
                </button>
              </div>
            )}
            {data.twoFactor && (
              <small>Осталось резервных кодов: {data.backupCodesLeft}</small>
            )}
          </section>
          <section className="panel space">
            <h2>Активные сеансы</h2>
            {data.devices.map((d) => (
              <div className="setting-row" key={d.id}>
                <span>
                  {d.label} {d.current ? "· Этот сеанс" : ""}
                  <small>{new Date(d.at).toLocaleString("ru-RU")}</small>
                </span>
                {!d.current && (
                  <button
                    className="btn"
                    disabled={busy || !password || (data.twoFactor && !otp)}
                    onClick={() => action("revoke-device", { device: d.id })}
                  >
                    Завершить
                  </button>
                )}
              </div>
            ))}
            <button
              className="btn space"
              disabled={busy || !password || (data.twoFactor && !otp)}
              onClick={() => action("revoke-others")}
            >
              Завершить остальные сеансы
            </button>
          </section>
        </>
      )}
    </Gate>
  );
}

export function AccountAction() {
  const [params] = useSearchParams(),
    { account } = useDemo();
  const purpose = params.get("purpose"),
    token = params.get("token");
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [otp, setOtp] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Head
        title={purpose === "verify" ? "Подтверждение почты" : "Новый пароль"}
        text="Ссылка из письма GD Store действует 30 минут."
      />
      <section className="panel">
        {done ? (
          <>
            <p>
              {purpose === "verify"
                ? "Почта подтверждена."
                : "Пароль изменён. Старые сеансы завершены."}
            </p>
            <Link
              className="btn space"
              to={purpose === "verify" ? "/security" : "/login"}
            >
              Продолжить
            </Link>
          </>
        ) : (
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (purpose !== "verify" && password !== confirm) {
                setError("Пароли не совпадают.");
                return;
              }
              setBusy(true);
              setError("");
              try {
                await api.request("security/", {
                  method: "POST",
                  body: {
                    mode: purpose === "verify" ? "verify-email" : "reset-email",
                    token,
                    password,
                    otp,
                  },
                });
                if (purpose !== "verify") await account({ mode: "logout" });
                setDone(true);
              } catch (error) {
                setError(error.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {purpose !== "verify" && (
              <>
                <label>
                  Новый пароль
                  <input
                    required
                    minLength={8}
                    maxLength={128}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label>
                  Повторите пароль
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
                <label>
                  Код 2FA, если включён
                  <input
                    autoComplete="one-time-code"
                    value={otp}
                    maxLength={32}
                    onChange={(e) => setOtp(e.target.value)}
                  />
                </label>
              </>
            )}
            {error && (
              <p className="payment-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="btn primary"
              disabled={
                busy || !token || !["verify", "reset"].includes(purpose)
              }
            >
              {purpose === "verify" ? "Подтвердить почту" : "Обновить пароль"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}

export function RequestPasswordEmail() {
  const [login, setLogin] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form-stack panel space"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const result = await api.request("security/", {
            method: "POST",
            body: { mode: "request-reset", login },
          });
          setMessage(result.message);
        } catch (error) {
          setMessage(error.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Восстановить через почту</h3>
      <label>
        Логин или email
        <input
          required
          maxLength={254}
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />
      </label>
      <button className="btn" disabled={busy}>
        Отправить письмо
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
