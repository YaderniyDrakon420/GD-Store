import { ReviewList } from "./ServiceFeatures";
import { BadgeBoard } from "./Progression";
import { ProductOffers, ProductLibrary } from "./Products";
import { GameExtras } from "./GameExtras";
import { visibleSection } from "../demo/service.mjs";
import Showcase from "./Showcase";
import { ReportButton } from "./Reports";
import { cosmetics } from "../server/catalog.mjs";
import { useState, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useDemo } from "../demo/context";
import { games, price } from "../server/catalog.mjs";
import {
  Art,
  Avatar,
  Empty,
  Gate,
  Head,
  GameCard,
  NotFound,
  money,
} from "./Studio";
import Icon from "../components/Icon";
export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
    const d = ref.current;
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Author({ id }) {
  const { state } = useDemo();
  const u = state.users.find((u) => u.id === id);
  return (
    <Link to={"/profile/" + id} className="author">
      <Avatar user={u} />
      <span>{u?.name || "Игрок"}</span>
    </Link>
  );
}
export const date = (at) =>
  new Date(at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
export function Game() {
  const { slug } = useParams();
  const g = games.find((g) => g.id === slug);
  const { state, me, act } = useDemo();
  const [tab, setTab] = useState("Об игре"),
    [review, setReview] = useState(""),
    [positive, setPositive] = useState(true);
  const visitAction = useRef(act);
  visitAction.current = act;
  const lastVisit = useRef("");
  useEffect(() => {
    const key = `${me?.id}:${g?.id}`;
    if (me?.id && g?.id && g.available !== false && lastVisit.current !== key) {
      lastVisit.current = key;
      void visitAction.current({ type: "game-view", game: g.id });
    }
  }, [me?.id, g?.id, g?.available]);
  if (!g) return <NotFound />;
  const owned = state.library[me?.id]?.includes(g.id),
    cart = state.cart[me?.id]?.includes(g.id),
    wished = state.wishlist[me?.id]?.includes(g.id);
  return (
    <>
      <Link className="back-link" to="/">
        ← В магазин
      </Link>
      <div className="detail-hero">
        <Art game={g} />
        <div className="detail-copy">
          <p className="eyebrow">{g.developer}</p>
          <h1>{g.title}</h1>
          <p>{g.tagline}</p>
          <div className="tags">
            {g.tags.map((t) => (
              <span className="pill" key={t}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="detail-layout">
        <div>
          <div className="tabs">
            {["Об игре", "Отзывы", "Достижения"].map((t) => (
              <button
                className={t === tab ? "active" : ""}
                onClick={() => setTab(t)}
                key={t}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "Об игре" ? (
            <div className="panel prose">
              <h2>Откройте новый мир</h2>
              <p>{g.description}</p>
              <GameExtras key={g.id} game={g} />
              <div className="detail-links">
                <Link to={"/hub/" + g.id}>Центр игры ↗</Link>
                <Link to={"/community?game=" + g.id}>Обсуждения ↗</Link>
                <Link to={"/workshop?game=" + g.id}>Мастерская ↗</Link>
              </div>
              <h3>Об этой витрине</h3>
              <p>
                GD Store — учебный магазин. Указанные суммы используются только
                для тестовых заказов. Реальные деньги не списываются, лицензии,
                игровые ключи и клиент игры не выдаются.
              </p>
              <dl className="specs">
                <dt>Разработчик</dt>
                <dd>{g.developer}</dd>
                <dt>Жанр</dt>
                <dd>{g.genre}</dd>
                <dt>Платформа</dt>
                <dd>{g.platforms || "Не указана"}</dd>
                <dt>Статус</dt>
                <dd>{g.isPreorder ? "Предзаказ · ожидает релиза" : "Вышла"}</dd>
                {g.releaseDate && (
                  <>
                    <dt>Дата релиза</dt>
                    <dd>
                      {new Date(g.releaseDate + "T12:00:00").toLocaleDateString(
                        "ru-RU",
                      )}
                    </dd>
                  </>
                )}
                {g.officialUrl && (
                  <>
                    <dt>Подробнее</dt>
                    <dd>
                      <a href={g.officialUrl} target="_blank" rel="noreferrer">
                        Официальная страница ↗
                      </a>
                    </dd>
                  </>
                )}
              </dl>
            </div>
          ) : tab === "Достижения" ? (
            <div className="panel">
              <h2>Коллекция достижений</h2>
              <p className="muted space">
                Интеграция с игровыми достижениями не подключена
              </p>
              <Achievements game={g} owned={false} />
            </div>
          ) : (
            <div className="panel">
              <h2>Отзывы игроков</h2>
              <div className="review-score">
                <strong>{g.rating == null ? "—" : `${g.rating}%`}</strong>
                <span>
                  Положительные
                  <br />
                  <small>{g.reviewCount || 0} отзывов в GD Store</small>
                </span>
              </div>
              <ReviewList game={g.id} />
              {owned && !g.isPreorder ? (
                <form
                  className="form-stack"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      await act(
                        { type: "review", game: g.id, text: review, positive },
                        "Отзыв сохранён",
                      )
                    )
                      setReview("");
                  }}
                >
                  <label>
                    Ваш отзыв
                    <textarea
                      required
                      maxLength={2000}
                      value={review}
                      onChange={(e) => setReview(e.target.value)}
                      rows={4}
                    />
                  </label>
                  <label>
                    Впечатление
                    <select
                      value={positive ? "yes" : "no"}
                      onChange={(e) => setPositive(e.target.value === "yes")}
                    >
                      <option value="yes">Рекомендую</option>
                      <option value="no">Не рекомендую</option>
                    </select>
                  </label>
                  <button className="btn primary">Сохранить отзыв</button>
                </form>
              ) : (
                <p className="muted">
                  {g.isPreorder
                    ? "Отзывы станут доступны после релиза."
                    : "Добавьте игру в библиотеку, чтобы оставить отзыв."}
                </p>
              )}
            </div>
          )}
          <section className="space">
            <h2 className="space">Издания и дополнения</h2>
            <ProductOffers game={g.id} />
          </section>
        </div>
        <aside className="panel purchase">
          <p className="eyebrow">ВАША СЛЕДУЮЩАЯ ИГРА</p>
          <h2>{g.title}</h2>
          <p className="muted">{g.description}</p>
          <div className="purchase-price">
            {g.discount > 0 && (
              <>
                <span className="discount">−{g.discount}%</span>
                <del>{money(g.price)}</del>
              </>
            )}
            <strong>{money(price(g))}</strong>
          </div>
          {owned ? (
            <Link className="btn primary" to="/library">
              <Icon name="library" />
              {g.isPreorder ? "Предзаказ в библиотеке" : "В библиотеке"}
            </Link>
          ) : (
            <button
              className="btn primary"
              disabled={g.available === false && !cart}
              onClick={async () =>
                await act(
                  { type: "cart", game: g.id },
                  cart ? "Удалено из корзины" : "Добавлено в корзину",
                )
              }
            >
              <Icon name="cart" />
              {cart
                ? "Убрать из корзины"
                : g.available === false
                  ? "Снято с продажи"
                  : g.isPreorder
                    ? "Предзаказ в корзину"
                    : "В корзину"}
            </button>
          )}
          <button
            className="btn"
            onClick={async () =>
              await act(
                { type: "wishlist", game: g.id },
                wished ? "Удалено из желаемого" : "Добавлено в желаемое",
              )
            }
          >
            <Icon name="heart" />
            {wished ? "В желаемом ✓" : "В список желаемого"}
          </button>
          <p className="fine">Демонстрация · деньги не списываются</p>
        </aside>
      </div>
    </>
  );
}
export function Achievements() {
  return (
    <div className="achievements">
      <div className="achievement">
        <span>
          <Icon name="trophy" size={25} />
        </span>
        <div>
          <strong>Нет данных о достижениях</strong>
          <small>
            GD Store не получает игровой прогресс из Steam или консолей.
          </small>
        </div>
      </div>
    </div>
  );
}
export function Collection({ kind }) {
  const { state, me, act } = useDemo();
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("title");

  const list = games
    .filter(
      (g) =>
        state[kind][me?.id]?.includes(g.id) &&
        g.title.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "title" ? a.title.localeCompare(b.title) : b.hours - a.hours,
    );
  const titles = {
    library: "Всё, во что хочется играть",
    wishlist: "Сохранено на потом",
    cart: "До нового мира — один шаг",
  };
  const total = games
    .filter((g) => state.cart[me?.id]?.includes(g.id))
    .reduce((s, g) => s + price(g), 0);
  return (
    <Gate>
      <Head
        eyebrow={
          {
            library: "БИБЛИОТЕКА",
            wishlist: "СПИСОК ЖЕЛАЕМОГО",
            cart: "КОРЗИНА",
          }[kind]
        }
        title={titles[kind]}
        text={(state[kind][me?.id]?.length || 0) + " игр в коллекции"}
      >
        <Link className="btn" to="/orders">
          История заказов
        </Link>
      </Head>
      {kind === "library" && <ProductLibrary />}
      {kind === "library" && (
        <div className="library-collections-link">
          <div>
            <p className="eyebrow">ВАШИ ПОДБОРКИ</p>
            <h3>Любимые миры — по своим полкам</h3>
            <p>
              {state.collections.filter((c) => c.owner === me?.id).length}{" "}
              коллекций в библиотеке
            </p>
          </div>
          <Link className="btn" to="/collections">
            <Icon name="folder" />
            Мои коллекции
          </Link>
        </div>
      )}
      {kind === "library" && list.length > 0 && (
        <Link to={"/game/" + list[0].id} className="library-feature">
          <Art game={list[0]} />
          <div>
            <span className="pill">ВАША КОЛЛЕКЦИЯ</span>
            <h2>{list[0].title}</h2>
            <p>{list[0].tagline}</p>
            <span className="btn primary">
              Открыть страницу <Icon name="arrow" />
            </span>
          </div>
        </Link>
      )}
      <div className="collection-tools">
        <input
          placeholder="Поиск по коллекции"
          aria-label="Поиск по коллекции"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Сортировка коллекции"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="title">По названию</option>
          <option value="hours">По времени в игре</option>
        </select>
      </div>
      {kind === "library" ? (
        <div className="game-grid">
          {list.map((g) => (
            <div key={g.id}>
              <GameCard game={g} />
              <div className="library-meta">
                <span>
                  {g.isPreorder
                    ? "Предзаказ · ожидает релиза"
                    : "Учебная библиотека"}
                </span>
                <span>
                  {g.isPreorder && g.releaseDate
                    ? new Date(g.releaseDate + "T12:00:00").toLocaleDateString(
                        "ru-RU",
                      )
                    : "Без игрового клиента"}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="list-panel">
          {list.map((g) => (
            <div className="game-row" key={g.id}>
              <Link to={"/game/" + g.id} className="row-art">
                <Art game={g} />
              </Link>
              <div className="grow">
                <Link to={"/game/" + g.id}>
                  <h3>{g.title}</h3>
                </Link>
                <p className="muted">
                  {g.available === false
                    ? "Снято с продажи — удалите из корзины"
                    : g.isPreorder
                      ? "Предзаказ · " + g.platforms
                      : g.genre}
                </p>
              </div>
              <strong>{money(price(g))}</strong>
              {kind === "wishlist" && (
                <button
                  className="btn"
                  disabled={
                    g.available === false || state.cart[me?.id]?.includes(g.id)
                  }
                  onClick={async () =>
                    await act(
                      { type: "cart", game: g.id },
                      "Добавлено в корзину",
                    )
                  }
                >
                  В корзину
                </button>
              )}
              <button
                className="link-button"
                aria-label={"Удалить " + g.title}
                onClick={async () => await act({ type: kind, game: g.id })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {!list.length && (
        <Empty
          title="Пока пусто"
          text="Добавьте игры из магазина или измените поиск."
        />
      )}
      {kind === "cart" && !!state.cart[me?.id]?.length && (
        <div className="checkout-panel">
          <div>
            <p className="muted">Итого в демозаказе</p>
            <strong>{money(total)}</strong>
          </div>
          <Link className="btn primary" to="/checkout">
            Перейти к оформлению <Icon name="arrow" />
          </Link>
        </div>
      )}
    </Gate>
  );
}
export function Profile() {
  const { id } = useParams();
  const { state, me, act } = useDemo();
  const user = state.users.find((u) => u.id === (id || me?.id));
  const [edit, setEdit] = useState(false),
    [tab, setTab] = useState("Витрина");
  if (!user)
    return (
      <Empty title="Профиль не найден" link="/login" label="Выбрать профиль" />
    );
  const own = me?.id === user.id;
  const libraryVisible = visibleSection(
    state,
    user.id,
    me?.id,
    "libraryPrivacy",
  );
  const friendsVisible = visibleSection(
    state,
    user.id,
    me?.id,
    "friendsPrivacy",
  );
  const activityVisible = visibleSection(
    state,
    user.id,
    me?.id,
    "activityPrivacy",
  );
  const owned = games.filter(
    (g) => libraryVisible && state.library[user.id]?.includes(g.id),
  );
  const fs = state.friends.filter(
    (f) =>
      friendsVisible &&
      f.status === "accepted" &&
      [f.from, f.to].includes(user.id),
  );
  const relation = state.friends.find(
    (f) => [f.from, f.to].includes(me?.id) && [f.from, f.to].includes(user.id),
  );
  return (
    <>
      <div className="profile-cover">
        <Art
          game={
            games.find(
              (g) =>
                g.id ===
                (cosmetics.find((x) => x.id === user.cosmeticBanner)?.game ||
                  user.cover),
            ) || games[0]
          }
        />
        <span className="cover-label">
          PLAYER SPACE / {user.handle.toUpperCase()}
        </span>
      </div>
      <div className="profile-identity">
        <Avatar user={user} large />
        <div className="grow">
          <div className="name-line">
            <h1>{user.name}</h1>
            <span className="level">LVL {user.level}</span>
          </div>
          <p className="muted">
            @{user.handle}
            {user.country ? " · " + user.country : ""}
          </p>
          <p className="online-label">
            <i className={"presence " + user.status} />{" "}
            {user.status === "playing"
              ? "В игре"
              : user.status === "online"
                ? "В сети"
                : "Не в сети"}
          </p>
        </div>
        {own ? (
          <button className="btn" onClick={() => setEdit(true)}>
            Редактировать профиль
          </button>
        ) : relation?.status === "accepted" ? (
          <Link className="btn primary" to={"/messages/" + user.id}>
            Написать
          </Link>
        ) : (
          <button
            className="btn primary"
            disabled={!!relation}
            onClick={async () =>
              await act({ type: "request", user: user.id }, "Заявка отправлена")
            }
          >
            {relation ? "Заявка / блокировка" : "Добавить в друзья"}
          </button>
        )}
      </div>
      <div className="actions profile-tools">
        {own ? (
          <Link className="btn" to="/points-shop">
            Оформление профиля ↗
          </Link>
        ) : (
          <ReportButton user={user.id} />
        )}
      </div>
      <div className="profile-layout">
        <div>
          <div className="stats-strip">
            {[
              [libraryVisible ? owned.length : "—", "Игр"],
              [
                owned.reduce((s, g) => s + (own ? g.hours : 0), 0),
                "Часов в игре",
              ],
              [friendsVisible ? fs.length : "—", "Друзей"],
              [state.mods.filter((m) => m.author === user.id).length, "Работ"],
            ].map(([n, t]) => (
              <div key={t}>
                <strong>{n}</strong>
                <span>{t}</span>
              </div>
            ))}
          </div>
          <div className="tabs">
            {["Витрина", "Активность", "Достижения"].map((t) => (
              <button
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
                key={t}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "Витрина" ? (
            libraryVisible ? (
              <Showcase key={user.id} user={user} />
            ) : (
              <p className="panel muted">
                Библиотека и витрина скрыты владельцем.
              </p>
            )
          ) : tab === "Достижения" ? (
            activityVisible ? (
              <BadgeBoard user={user} />
            ) : (
              <p className="panel muted">Достижения скрыты владельцем.</p>
            )
          ) : (
            <div className="panel">
              <h2>Последняя активность</h2>
              {state.activity
                .filter((a) => activityVisible && a.author === user.id)
                .map((a) => (
                  <div className="activity-row" key={a.id}>
                    <Icon name="spark" />
                    <span>
                      {user.name} {a.text}
                    </span>
                    <small>{date(a.at)}</small>
                  </div>
                ))}
              {(!activityVisible ||
                !state.activity.some((a) => a.author === user.id)) && (
                <p className="muted space">
                  {activityVisible
                    ? "Здесь появятся новые игры, обсуждения и работы мастерской."
                    : "Активность скрыта владельцем."}
                </p>
              )}
            </div>
          )}
        </div>
        <aside>
          <div className="panel">
            <p className="eyebrow">ОБ ИГРОКЕ</p>
            <p>{user.bio || "Игрок ещё не рассказал о себе."}</p>
            <div className="profile-badge">
              <Icon name="trophy" size={30} />
              <div>
                <strong>
                  {user.badges?.find((b) => b.code === user.featuredBadge)
                    ?.title ||
                    user.badges?.[0]?.title ||
                    "Новый игрок"}
                </strong>
                <small>
                  {user.xp || 0} XP · уровень {user.level || 1}
                </small>
              </div>
            </div>
          </div>
          <div className="panel space">
            <div className="section-title">
              <h3>
                Друзья <span className="muted">{fs.length}</span>
              </h3>
              <Link to="/friends" className="accent">
                ↗
              </Link>
            </div>
            {fs.map((f) => (
              <div className="friend-mini" key={f.id}>
                <Author id={f.from === user.id ? f.to : f.from} />
              </div>
            ))}
            {!fs.length && (
              <p className="muted">
                {friendsVisible
                  ? "Всё начинается с первой заявки."
                  : "Список друзей скрыт владельцем."}
              </p>
            )}
          </div>
        </aside>
      </div>
      {edit && (
        <Modal title="Ваш профиль" onClose={() => setEdit(false)}>
          <ProfileForm
            user={user}
            onSave={async (values) => {
              if (await act({ type: "profile", ...values }, "Профиль обновлён"))
                setEdit(false);
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function ProfileForm({ user, onSave }) {
  const [values, setValues] = useState(() => ({
    ...user,
    status: user.statusPreference || "online",
    cover: user.cover || games.find((g) => g.available !== false)?.id || "",
  }));
  const [uploadError, setUploadError] = useState("");
  const field = (k, v) => setValues({ ...values, [k]: v });
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values);
      }}
    >
      <label>
        Имя
        <input
          required
          maxLength={40}
          value={values.name}
          onChange={(e) => field("name", e.target.value)}
        />
      </label>
      <label>
        О себе
        <textarea
          rows={3}
          maxLength={300}
          value={values.bio}
          onChange={(e) => field("bio", e.target.value)}
        />
      </label>
      <div className="form-grid">
        <label>
          Страна
          <input
            maxLength={40}
            value={values.country}
            onChange={(e) => field("country", e.target.value)}
          />
        </label>
        <label>
          Отображение статуса
          <select
            value={values.status}
            onChange={(e) => field("status", e.target.value)}
          >
            <option value="online">Автоматически</option>
            <option value="playing">В игре (вручную)</option>
            <option value="offline">Невидимый</option>
          </select>
        </label>
      </div>
      <p className="fine">
        Статус обновляется, пока сайт открыт. После потери связи — «Не в сети»
        примерно через 90 секунд. «Невидимый» всегда скрывает ваше присутствие.
      </p>
      <label>
        Аватар (PNG, JPEG, WebP до 500 КБ)
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (
              f.size > 500000 ||
              !["image/png", "image/jpeg", "image/webp"].includes(f.type)
            ) {
              setUploadError("Выберите PNG, JPEG или WebP до 500 КБ.");
              return;
            }
            setUploadError("");
            const reader = new FileReader();
            reader.onload = () =>
              setValues((v) => ({ ...v, avatar: reader.result }));
            reader.onerror = () =>
              setUploadError("Не удалось прочитать изображение.");
            reader.readAsDataURL(f);
          }}
        />
      </label>
      {uploadError && (
        <p role="alert" className="fine">
          {uploadError}
        </p>
      )}
      {values.avatar && (
        <div className="actions">
          <Avatar user={values} />
          <button
            className="link-button"
            type="button"
            onClick={() => field("avatar", "")}
          >
            Удалить аватар
          </button>
        </div>
      )}
      <label>
        Обложка профиля
        <select
          value={values.cover || ""}
          onChange={(e) => field("cover", e.target.value)}
        >
          {games
            .filter((g) => g.available !== false || g.id === values.cover)
            .map((g) => (
              <option value={g.id} key={g.id}>
                {g.title}
              </option>
            ))}
        </select>
      </label>
      <fieldset>
        <legend>Цвет профиля</legend>
        <div className="color-options">
          {["#49dcc8", "#bba2ff", "#ffb979", "#f295ba", "#8eafff"].map((c) => (
            <button
              type="button"
              key={c}
              aria-label={"Цвет " + c}
              aria-pressed={values.color === c}
              style={{ background: c }}
              onClick={() => field("color", c)}
            >
              {values.color === c ? "✓" : ""}
            </button>
          ))}
        </div>
      </fieldset>
      <button className="btn primary">Сохранить изменения</button>
    </form>
  );
}
