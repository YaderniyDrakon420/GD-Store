import { useState } from "react";
import { useDemo } from "../demo/context";
import { games } from "../server/catalog.mjs";
import { GameCard, Empty } from "./Studio";
import { Modal } from "./Personal";
export default function Showcase({ user }) {
  const { state, me, act } = useDemo();
  const owned = games.filter((g) => state.library[user.id]?.includes(g.id));
  const selected = user.showcase?.games ?? owned.slice(0, 3).map((g) => g.id);
  const [draft, setDraft] = useState(null);
  return (
    <>
      <div className="section-title">
        <div>
          <p className="eyebrow">PLAYER'S CHOICE</p>
          <h2>{user.showcase?.title || "Любимые миры"}</h2>
        </div>
        {me?.id === user.id && (
          <button
            className="btn"
            onClick={() =>
              setDraft({
                title: user.showcase?.title || "Любимые миры",
                games: [...selected],
              })
            }
          >
            Настроить витрину
          </button>
        )}
      </div>
      <div className="game-grid profile-games">
        {selected.map((id) => {
          const g = owned.find((x) => x.id === id);
          return g ? <GameCard key={id} game={g} /> : null;
        })}
      </div>
      {!selected.length && (
        <Empty
          title="Витрина ещё пуста"
          text="Здесь появятся выбранные владельцем игры."
        />
      )}
      {draft && (
        <Modal title="Ваша витрина" onClose={() => setDraft(null)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ type: "showcase-save", ...draft }, "Витрина обновлена"))
                setDraft(null);
            }}
          >
            <label>
              Заголовок
              <input
                maxLength={60}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <p className="muted">
              До трёх игр из библиотеки. Порядок выбора задаёт порядок на
              витрине; снимите выбор, чтобы переставить игру.
            </p>
            <div className="showcase-picker">
              {owned.map((g) => (
                <button
                  type="button"
                  key={g.id}
                  className={
                    "showcase-option " +
                    (draft.games.includes(g.id) ? "selected" : "")
                  }
                  disabled={
                    !draft.games.includes(g.id) && draft.games.length === 3
                  }
                  onClick={() =>
                    setDraft({
                      ...draft,
                      games: draft.games.includes(g.id)
                        ? draft.games.filter((id) => id !== g.id)
                        : [...draft.games, g.id],
                    })
                  }
                >
                  <img src={g.image} alt="" />
                  <strong>{g.title}</strong>
                  <span>
                    {draft.games.includes(g.id)
                      ? draft.games.indexOf(g.id) + 1
                      : "＋"}
                  </span>
                </button>
              ))}
            </div>
            {!owned.length && (
              <p className="muted">Сначала добавьте игры в библиотеку.</p>
            )}
            <button className="btn primary">Сохранить витрину</button>
          </form>
        </Modal>
      )}
    </>
  );
}
