import { useState } from "react";
import { Link } from "react-router-dom";
import { games, price } from "../server/catalog.mjs";
import { pickGames } from "../demo/extras.mjs";
import { useDemo } from "../demo/context";
import { Head, Art, GameCard, Empty, Gate, money } from "./Studio";
import Icon from "../components/Icon";
export function DiscoveryStrip() {
  return (
    <div className="discovery-tools">
      <Link to="/discover">
        <span className="discovery-tool-icon">
          <Icon name="dice" size={24} />
        </span>
        <div>
          <strong>Во что сыграем сегодня?</strong>
          <small>Подберём мир под ваше настроение</small>
        </div>
        <Icon name="arrow" />
      </Link>
      <Link to="/compare">
        <span className="discovery-tool-icon violet">
          <Icon name="compare" size={24} />
        </span>
        <div>
          <strong>Сложно выбрать?</strong>
          <small>Сравните цену, жанр и оценки</small>
        </div>
        <Icon name="arrow" />
      </Link>
    </div>
  );
}
export function Compare() {
  const { state, me, act } = useDemo();
  const selected = (state.comparison[me?.id] || [])
    .map((id) => games.find((g) => g.id === id))
    .filter(Boolean);
  const options = games.filter(
    (g) => g.available !== false && !selected.some((s) => s.id === g.id),
  );
  const rows = [
    ["Цена", (g) => money(price(g))],
    ["Скидка", (g) => (g.discount ? "−" + g.discount + "%" : "Без скидки")],
    [
      "Оценка игроков",
      (g) => (g.rating == null ? "Нет отзывов" : g.rating + "% положительных"),
    ],
    ["Жанр", (g) => g.genre],
    ["Игровые особенности", (g) => g.tags.join(" · ")],
    ["Разработчик", (g) => g.developer],
    ["Платформы", (g) => g.platforms || "Не указаны"],
    ["Статус", (g) => (g.isPreorder ? "Предзаказ" : "Вышла")],
  ];
  return (
    <Gate>
      <Head
        eyebrow="SIDE BY SIDE"
        title="Выбирайте свой мир"
        text="До трёх игр рядом — всё важное без лишних вкладок."
      >
        {!!selected.length && (
          <button
            className="btn"
            onClick={async () => await act({ type: "compare-clear" })}
          >
            Очистить сравнение
          </button>
        )}
      </Head>
      <div className="compare-picker">
        <span className="muted">{selected.length} / 3 игры</span>
        <select
          aria-label="Добавить игру к сравнению"
          value=""
          disabled={selected.length >= 3}
          onChange={async (e) => {
            if (e.target.value)
              await act({ type: "compare", game: e.target.value });
          }}
        >
          <option value="">＋ Выберите игру</option>
          {options.map((g) => (
            <option value={g.id} key={g.id}>
              {g.title}
            </option>
          ))}
        </select>
        <Link to="/" className="subtle">
          В каталог ↗
        </Link>
      </div>
      {selected.length ? (
        <div className="comparison-scroll">
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">В деталях</th>
                {selected.map((g) => (
                  <th scope="col" key={g.id}>
                    <Link className="compare-art" to={"/game/" + g.id}>
                      <Art game={g} />
                      <strong>{g.title}</strong>
                    </Link>
                    <button
                      className="link-button"
                      onClick={async () =>
                        await act({ type: "compare", game: g.id })
                      }
                    >
                      Убрать ×
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, get]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  {selected.map((g) => (
                    <td
                      key={g.id}
                      className={
                        name === "Цена" &&
                        price(g) === Math.min(...selected.map(price))
                          ? "best-value"
                          : ""
                      }
                    >
                      {get(g)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row">Узнать больше</th>
                {selected.map((g) => (
                  <td key={g.id}>
                    <Link className="btn primary" to={"/game/" + g.id}>
                      Открыть игру
                    </Link>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="Хорошие игры заслуживают сравнения"
          text="Выберите игру в списке выше или нажмите значок сравнения на карточке."
        />
      )}
      <p className="fine space">
        Цены служат для учебных заказов. Оценки рассчитаны по отзывам
        пользователей GD Store.
      </p>
    </Gate>
  );
}
export function Discover() {
  const { state, me, act } = useDemo();
  const suggestion = (state.recommendationQueue || [])[0];
  const recommended = games.find((g) => g.id === suggestion?.game);
  const [mood, setMood] = useState("any"),
    [budget, setBudget] = useState(1200),
    [excludeOwned, setExcludeOwned] = useState(true),
    [picked, setPicked] = useState(null);
  const candidates = pickGames(
    games.filter((g) => g.available !== false && !g.isPreorder),
    {
      mood,
      budget,
      owned: excludeOwned ? state.library[me?.id] || [] : [],
    },
  );
  const result = candidates.find((g) => g.id === picked);
  function choose() {
    const available =
      candidates.length > 1
        ? candidates.filter((g) => g.id !== picked)
        : candidates;
    if (available.length)
      setPicked(available[Math.floor(Math.random() * available.length)].id);
  }
  return (
    <>
      <Head
        eyebrow="FIND YOUR NEXT ADVENTURE"
        title="Сегодня хочется…"
        text="Выберите настроение и бюджет. Остальное оставьте случаю."
      />
      {me && (
        <section className="panel space">
          <h2>Ваша очередь рекомендаций</h2>
          {recommended ? (
            <div className="gd-feature-grid space">
              <GameCard game={recommended} />
              <div>
                <h3>{recommended.title}</h3>
                <p className="muted space">{suggestion.reason}</p>
                <div className="actions space">
                  <button
                    className="btn primary"
                    onClick={() =>
                      act(
                        {
                          type: "recommendation",
                          game: recommended.id,
                          value: "like",
                        },
                        "Добавлено в желаемое",
                      )
                    }
                  >
                    Интересно
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      act({
                        type: "recommendation",
                        game: recommended.id,
                        value: "skip",
                      })
                    }
                  >
                    Не интересно
                  </button>
                </div>
                <small className="muted">
                  Основано на вашей библиотеке, желаемом и предыдущих ответах.
                </small>
              </div>
            </div>
          ) : (
            <>
              <p className="muted space">
                Вы просмотрели все доступные варианты или уже владеете ими.
              </p>
              <button
                className="btn space"
                onClick={() => act({ type: "recommendations-reset" })}
              >
                Сбросить ответы
              </button>
            </>
          )}
        </section>
      )}
      <div className="discover-layout">
        <section className="panel">
          <h2>Какой у вас план?</h2>
          <div className="mood-grid">
            {[
              ["any", "spark", "Открыть что-то новое", "Без ограничений"],
              ["calm", "globe", "Выдохнуть", "Инди и стратегии"],
              ["adventure", "trophy", "Уйти в приключение", "RPG и новые миры"],
              [
                "together",
                "users",
                "Собрать друзей",
                "Кооператив и мультиплеер",
              ],
            ].map(([value, icon, title, text]) => (
              <button
                key={value}
                className={"mood-card " + (mood === value ? "selected" : "")}
                onClick={() => {
                  setMood(value);
                  setPicked(null);
                }}
              >
                <Icon name={icon} />
                <strong>{title}</strong>
                <small>{text}</small>
              </button>
            ))}
          </div>
          <label className="budget-label">
            Бюджет{" "}
            <strong>
              {budget === 0 ? "Только бесплатные" : "До " + money(budget)}
            </strong>
            <input
              type="range"
              min={0}
              max={1500}
              step={50}
              value={budget}
              onChange={(e) => {
                setBudget(Number(e.target.value));
                setPicked(null);
              }}
            />
          </label>
          <label className="inline-check space">
            <input
              type="checkbox"
              checked={excludeOwned}
              onChange={(e) => {
                setExcludeOwned(e.target.checked);
                setPicked(null);
              }}
            />
            Искать игры вне моей библиотеки
          </label>
          <button
            className="btn primary space"
            onClick={choose}
            disabled={!candidates.length}
          >
            <Icon name="dice" />
            {result ? "Ещё один вариант" : "Подобрать игру"}
          </button>
          <p className="fine space">
            Подходит игр: {candidates.length}. Выбор случайный среди результатов
            фильтра.
          </p>
        </section>
        <section className="discovery-result">
          {result ? (
            <>
              <p className="eyebrow">КАЖЕТСЯ, МЫ НАШЛИ ВАШ ПЛАН</p>
              <GameCard game={result} />
              <p>{result.description}</p>
              <Link className="btn primary" to={"/game/" + result.id}>
                Это то, что нужно <Icon name="arrow" />
              </Link>
            </>
          ) : (
            <div className="discovery-waiting">
              <span>
                <Icon name="dice" size={52} />
              </span>
              <h2>
                {candidates.length
                  ? "Маленькая случайность. Большая история."
                  : "Немного изменим план?"}
              </h2>
              <p>
                {candidates.length
                  ? "Нажмите «Подобрать игру» — здесь появится ваш следующий мир."
                  : "Для этих фильтров игр пока нет. Увеличьте бюджет или выберите другое настроение."}
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
