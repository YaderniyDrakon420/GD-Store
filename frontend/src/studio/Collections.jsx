import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useDemo } from "../demo/context";
import { games } from "../server/catalog.mjs";
import { Head, Gate, Art, GameCard, Empty } from "./Studio";
import { Modal } from "./Personal";
import Icon from "../components/Icon";
export default function Collections() {
  const { state, me, act } = useDemo();
  const { id } = useParams();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(null),
    [remove, setRemove] = useState(false);
  const mine = state.collections.filter((c) => c.owner === me?.id);
  const selected = mine.find((c) => c.id === id);
  const save = async (values) => {
    const collection = edit?.id || crypto.randomUUID();
    if (
      await act(
        {
          ...values,
          type: "collection-save",
          id: collection,
          collection: edit?.id,
        },
        "Коллекция сохранена",
      )
    ) {
      setEdit(null);
      navigate("/collections/" + collection);
    }
  };
  return (
    <Gate>
      <Head
        eyebrow="YOUR LIBRARY, YOUR RULES"
        title={selected ? selected.name : "Порядок в ваших мирах"}
        text="Любимые, пройти позже, для компании — собирайте игры по-своему."
      >
        <button className="btn primary" onClick={() => setEdit(selected || {})}>
          {selected ? "Редактировать" : "＋ Новая коллекция"}
        </button>
      </Head>
      {id && !selected ? (
        <Empty
          title="Коллекция не найдена"
          text="Папки видны только их владельцу."
          link="/collections"
          label="Мои коллекции"
        />
      ) : selected ? (
        <>
          <div className="collection-detail-toolbar">
            <Link className="back-link" to="/collections">
              ← Все коллекции
            </Link>
            <span className="muted">{selected.gameIds.length} игр</span>
            <button className="link-button" onClick={() => setRemove(true)}>
              Удалить коллекцию
            </button>
          </div>
          <div className="game-grid">
            {games
              .filter((g) => selected.gameIds.includes(g.id))
              .map((g) => (
                <GameCard game={g} key={g.id} />
              ))}
          </div>
          {!selected.gameIds.length && (
            <Empty
              title="Место для новых историй"
              text="Нажмите «Редактировать» и выберите игры из своей библиотеки."
              link="/library"
              label="Моя библиотека"
            />
          )}
        </>
      ) : (
        <>
          <div className="collection-tip">
            <Icon name="folder" size={30} />
            <div>
              <h2>Одна игра — сколько угодно коллекций.</h2>
              <p>Игры остаются в библиотеке, даже если вы удалите папку.</p>
            </div>
            <Link className="btn" to="/library">
              Все игры ↗
            </Link>
          </div>
          <div className="collections-grid">
            {mine.map((c) => {
              const covers = games
                .filter((g) => c.gameIds.includes(g.id))
                .slice(0, 3);
              return (
                <Link
                  className={"folder-card " + c.color}
                  key={c.id}
                  to={"/collections/" + c.id}
                >
                  <div className="folder-top">
                    <Icon name="folder" />
                    <span>{c.gameIds.length} игр</span>
                  </div>
                  <div className="folder-covers">
                    {covers.map((g) => (
                      <div key={g.id}>
                        <Art game={g} />
                      </div>
                    ))}
                    {!covers.length && <span>Ваша следующая коллекция</span>}
                  </div>
                  <h2>{c.name}</h2>
                  <span className="folder-open">
                    Открыть коллекцию <Icon name="arrow" size={16} />
                  </span>
                </Link>
              );
            })}
          </div>
          {!mine.length && (
            <div className="inbox-empty">
              <Icon name="folder" size={38} />
              <h2>Соберите первую коллекцию</h2>
              <p>Например, «Пройти на выходных» или «Игры для компании».</p>
              <button className="btn primary space" onClick={() => setEdit({})}>
                Создать коллекцию
              </button>
            </div>
          )}
        </>
      )}
      {edit && (
        <Modal
          title={edit.id ? "Редактировать коллекцию" : "Новая коллекция"}
          onClose={() => setEdit(null)}
        >
          <CollectionForm initial={edit} onSave={save} />
        </Modal>
      )}
      {remove && (
        <Modal title="Удалить коллекцию?" onClose={() => setRemove(false)}>
          <p className="muted">
            Удалится только папка «{selected?.name}». Игры останутся в вашей
            библиотеке.
          </p>
          <div className="actions space">
            <button className="btn" onClick={() => setRemove(false)}>
              Отмена
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                if (
                  await act(
                    { type: "collection-delete", collection: id },
                    "Коллекция удалена",
                  )
                ) {
                  setRemove(false);
                  navigate("/collections");
                }
              }}
            >
              Удалить папку
            </button>
          </div>
        </Modal>
      )}
    </Gate>
  );
}
function CollectionForm({ initial, onSave }) {
  const { state, me } = useDemo();
  const [name, setName] = useState(initial.name || ""),
    [color, setColor] = useState(initial.color || "teal"),
    [gameIds, setGames] = useState(initial.gameIds || []);
  const owned = games.filter((g) => state.library[me.id]?.includes(g.id));
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, color, gameIds });
      }}
    >
      <label>
        Название
        <input
          required
          maxLength={45}
          placeholder="Пройти на выходных"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <fieldset>
        <legend>Цвет папки</legend>
        <div className="folder-colors">
          {[
            ["teal", "Бирюзовый"],
            ["violet", "Фиолетовый"],
            ["amber", "Янтарный"],
            ["rose", "Розовый"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={value}
              aria-label={label}
              aria-pressed={color === value}
              onClick={() => setColor(value)}
            >
              {color === value ? "✓" : ""}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Игры из библиотеки · {gameIds.length}</legend>
        <div className="collection-checklist">
          {owned.map((g) => (
            <label key={g.id}>
              <span>{g.title}</span>
              <input
                type="checkbox"
                checked={gameIds.includes(g.id)}
                onChange={() =>
                  setGames(
                    gameIds.includes(g.id)
                      ? gameIds.filter((i) => i !== g.id)
                      : [...gameIds, g.id],
                  )
                }
              />
            </label>
          ))}
        </div>
        {!owned.length && (
          <p className="fine">
            Папку можно создать пустой, а игры добавить после покупки.
          </p>
        )}
      </fieldset>
      <button className="btn primary">Сохранить коллекцию</button>
    </form>
  );
}
