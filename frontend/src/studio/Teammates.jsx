import { TeamChat } from "./TeamChat";
import { useState } from "react";
import { useDemo } from "../demo/context";
import { games } from "../server/catalog.mjs";
import { Head, Gate, Art, Empty } from "./Studio";
import { Modal, Author } from "./Personal";
export default function Teammates() {
  const { state, me, act } = useDemo();
  const [game, setGame] = useState(""),
    [language, setLanguage] = useState(""),
    [mine, setMine] = useState(false),
    [form, setForm] = useState(null);
  const list = state.parties.filter(
    (p) =>
      (mine
        ? p.members.includes(me?.id)
        : !p.closed &&
          Date.parse(p.startsAt) > Date.now() &&
          !state.users.find((u) => u.id === p.host)?.banned) &&
      (!game || p.game === game) &&
      (!language || p.language === language),
  );
  const field = (k, v) => setForm({ ...form, [k]: v });
  return (
    <Gate>
      <Head
        eyebrow="FIND YOUR SQUAD"
        title="Хорошая игра начинается с команды"
        text="Найдите людей для следующего игрового вечера."
      >
        <button
          className="btn primary"
          onClick={() =>
            setForm({
              title: "",
              game: games[0].id,
              capacity: 4,
              language: "Русский",
              startsAt: "",
              description: "",
            })
          }
        >
          ＋ Собрать команду
        </button>
      </Head>
      <div className="party-intro">
        <span>CO-OP / COMMUNITY</span>
        <h2>
          Один мир. Разные игроки.
          <br />
          Ваш следующий отряд.
        </h2>
        <p>
          Выбирайте игру, язык и время. Участие в команде не добавляет игрока в
          друзья автоматически.
        </p>
      </div>
      <div className="party-filters">
        <select
          aria-label="Игра"
          value={game}
          onChange={(e) => setGame(e.target.value)}
        >
          <option value="">Все игры</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
        <select
          aria-label="Язык"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="">Любой язык</option>
          {["Русский", "Українська", "English"].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <button
          className={"btn " + (mine ? "primary" : "")}
          onClick={() => setMine(!mine)}
        >
          {mine ? "Мои команды ✓" : "Мои команды"}
        </button>
      </div>
      <div className="party-grid">
        {list.map((p) => {
          const ended = p.closed || Date.parse(p.startsAt) <= Date.now();
          const joined = p.members.includes(me?.id);
          return (
            <article className="panel party-card" key={p.id}>
              <Art game={games.find((g) => g.id === p.game)} />
              <div className="party-body">
                <p className="eyebrow">
                  {p.language} ·{" "}
                  {ended
                    ? "НАБОР ЗАВЕРШЁН"
                    : `${p.capacity - p.members.length} СВОБОДНЫХ МЕСТ`}
                </p>
                <h2>{p.title}</h2>
                <p className="muted">
                  {new Date(p.startsAt).toLocaleString("ru-RU", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
                <p className="party-description">{p.description}</p>
                <TeamChat key={p.id + me?.id} party={p} />
                <div className="party-members">
                  {p.members.map((id) => (
                    <Author key={id} id={id} />
                  ))}
                </div>
                <div className="actions space">
                  {p.host === me?.id ? (
                    <>
                      <button
                        className="btn"
                        disabled={ended}
                        onClick={() =>
                          setForm({
                            ...p,
                            party: p.id,
                            startsAt: new Date(
                              Date.parse(p.startsAt) -
                                new Date(p.startsAt).getTimezoneOffset() *
                                  60000,
                            )
                              .toISOString()
                              .slice(0, 16),
                          })
                        }
                      >
                        Изменить
                      </button>
                      <button
                        className="btn"
                        disabled={ended}
                        onClick={async () =>
                          await act(
                            { type: "party-close", party: p.id },
                            "Набор закрыт",
                          )
                        }
                      >
                        Закрыть набор
                      </button>
                    </>
                  ) : joined ? (
                    <button
                      className="btn"
                      onClick={async () =>
                        await act(
                          { type: "party-leave", party: p.id },
                          "Вы вышли из команды",
                        )
                      }
                    >
                      Покинуть команду
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      disabled={ended || p.members.length >= p.capacity}
                      onClick={async () =>
                        await act(
                          { type: "party-join", party: p.id },
                          "Вы в команде!",
                        )
                      }
                    >
                      Присоединиться
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!list.length && (
        <Empty
          title="Команда начинается с вас"
          text="Создайте объявление или измените фильтры."
          link="/friends"
          label="Мои друзья"
        />
      )}
      {form && (
        <Modal
          title={form.party ? "Изменить объявление" : "Собрать команду"}
          onClose={() => setForm(null)}
        >
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  {
                    ...form,
                    type: "party-save",
                    startsAt: new Date(form.startsAt).toISOString(),
                  },
                  "Объявление сохранено",
                )
              )
                setForm(null);
            }}
          >
            <label>
              Название
              <input
                required
                maxLength={80}
                value={form.title}
                onChange={(e) => field("title", e.target.value)}
                placeholder="Ищем команду на вечер"
              />
            </label>
            <label>
              Игра
              <select
                value={form.game}
                onChange={(e) => field("game", e.target.value)}
              >
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Всего мест, включая вас
                <input
                  type="number"
                  min={2}
                  max={8}
                  required
                  value={form.capacity}
                  onChange={(e) => field("capacity", Number(e.target.value))}
                />
              </label>
              <label>
                Язык
                <select
                  value={form.language}
                  onChange={(e) => field("language", e.target.value)}
                >
                  {["Русский", "Українська", "English"].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Когда играем — ваше местное время
              <input
                required
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => field("startsAt", e.target.value)}
              />
            </label>
            <label>
              О команде
              <textarea
                maxLength={500}
                rows={3}
                value={form.description}
                onChange={(e) => field("description", e.target.value)}
                placeholder="Темп игры, опыт и пожелания"
              />
            </label>
            <button className="btn primary">Сохранить</button>
          </form>
        </Modal>
      )}
    </Gate>
  );
}
