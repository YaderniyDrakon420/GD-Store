import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.mjs";
import { mapUser } from "../api/mapping.mjs";
import { useDemo } from "../demo/context";
import { Avatar, Art, GameCard, Head, Gate } from "./Studio";
export default function ServerProfile() {
  const { id } = useParams();
  const { me, games, state, refresh } = useDemo();
  const [user, setUser] = useState(null),
    [name, setName] = useState(""),
    [country, setCountry] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const own = !id || id === me?.id;
  useEffect(() => {
    const c = new AbortController();
    setUser(null);
    setError("");
    if (own) {
      setUser(me);
      setName(me?.name || "");
      setCountry(me?.country || "");
    } else
      api(`auth/users/${id}/`, { signal: c.signal })
        .then((value) => setUser(mapUser(value)))
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        });
    return () => c.abort();
  }, [id, me?.id]);
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const value = await api("auth/me/", {
        method: "PATCH",
        body: { display_name: name, country_code: country },
      });
      setUser(mapUser(value));
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!me && own) return <Gate />;
  return (
    <>
      <Head eyebrow="PLAYER PROFILE" title={user?.name || "Профиль"} />
      {error && (
        <p role="alert" className="payment-error">
          {error}
        </p>
      )}
      <div className="detail-hero">
        <Art game={games[0]} />
        <div className="detail-copy">
          <Avatar user={user} large />
          <h1>{user?.name}</h1>
          <p>@{user?.handle}</p>
        </div>
      </div>
      <div className="detail-layout">
        <section className="panel">
          <h2>{own ? "Ваша библиотека" : "Профиль игрока"}</h2>
          {own ? (
            <div className="game-grid">
              {games
                .filter((g) => state.library[me.id]?.includes(g.id))
                .map((g) => (
                  <GameCard key={g.id} game={g} />
                ))}
            </div>
          ) : (
            <Link className="btn primary" to={"/messages/" + id}>
              Открыть переписку
            </Link>
          )}
        </section>
        {own && (
          <form className="panel form-stack" onSubmit={save}>
            <h2>Настройки профиля</h2>
            <label>
              Отображаемое имя
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
              />
            </label>
            <label>
              Код страны
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="UA"
              />
            </label>
            <button className="btn primary" disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
