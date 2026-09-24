import { useDemo } from "../demo/context";
import { Link } from "react-router-dom";
import { Head, Gate } from "./Studio";

export function BadgeBoard({ user }) {
  const { state, me, act } = useDemo();
  if (!user) return null;
  const earned = new Map((user.badges || []).map((b) => [b.code, b]));
  return (
    <section className="panel">
      <h2>Достижения GD Store · уровень {user.level || 1}</h2>
      <p className="muted space">
        {user.xp || 0} XP · следующий уровень: {user.nextLevelXp || 200} XP.
        Значки выдаются за действия в магазине и сообществе.
      </p>
      <progress
        className="xp-progress"
        max={200}
        value={(user.xp || 0) % 200}
        aria-label="Прогресс уровня"
      />
      <div className="gd-feature-grid space">
        {(state.badgeDefinitions || []).map((b) => (
          <article
            className={"feature-card " + (earned.has(b.code) ? "earned" : "")}
            key={b.code}
          >
            <span className="pill">
              {earned.has(b.code) ? "Получено" : "Ещё впереди"} · {b.xp} XP
            </span>
            <h3>{b.title}</h3>
            <p className="muted">{b.description}</p>
            {me?.id === user.id && earned.has(b.code) && (
              <button
                className="btn"
                disabled={user.featuredBadge === b.code}
                onClick={() =>
                  act({ type: "badge-equip", badge: b.code }, "Значок выбран")
                }
              >
                {user.featuredBadge === b.code
                  ? "В профиле"
                  : "Показать в профиле"}
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export default function Progression() {
  const { me } = useDemo();
  return (
    <Gate>
      <Head
        title="Мой путь в GD Store"
        text="Опыт, значки и коллекционные карточки за ваши действия."
      >
        <Link className="btn" to="/inventory">
          Открыть инвентарь
        </Link>
      </Head>
      <BadgeBoard user={me} />
    </Gate>
  );
}
