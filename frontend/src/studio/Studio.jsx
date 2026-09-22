import {
  navigationGroups,
  matchesPath,
  SectionNavigation,
  ProfileMenu,
} from "./Navigation";
import { SaleWatcher } from "./ServiceFeatures";
import { cosmetics } from "../server/catalog.mjs";
import { GiftArrival } from "./Gifts";
import { DiscoveryStrip } from "./Discovery";
import { useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { useDemo } from "../demo/context";
import { games, price } from "../server/catalog.mjs";
import Icon from "../components/Icon";
export const money = (n) =>
  n === 0 ? "Бесплатно" : new Intl.NumberFormat("ru-RU").format(n) + " ₴";
export function Avatar({ user, large = false }) {
  const avatar =
    cosmetics.find((x) => x.id === user?.cosmeticAvatar)?.image || user?.avatar;
  const frame = cosmetics.find((x) => x.id === user?.cosmeticFrame)?.color;
  return (
    <span
      className={"avatar " + (large ? "large" : "")}
      style={{
        "--avatar": user?.color || "#78a9a3",
        boxShadow: frame
          ? `0 0 0 3px ${frame}, 0 0 22px ${frame}55`
          : undefined,
      }}
    >
      {avatar ? (
        <img src={avatar} alt="" />
      ) : (
        user?.initials || user?.name?.slice(0, 2) || "?"
      )}
    </span>
  );
}
export function Art({ game, className = "" }) {
  if (!game) return <div className={"art " + className}><span className="art-shade" /></div>;
  return (
    <div className={"art " + className} style={{ backgroundColor: game.color }}>
      <img src={game.image} alt="" />
      <span className="art-shade" />
    </div>
  );
}
export function Empty({
  title = "Пока ничего нет",
  text,
  link = "/",
  label = "Открыть магазин",
}) {
  return (
    <div className="empty">
      <Icon name="spark" size={32} />
      <h2>{title}</h2>
      <p>{text}</p>
      <Link className="btn primary" to={link}>
        {label}
      </Link>
    </div>
  );
}
export function Gate({ children }) {
  const { me } = useDemo();
  if (me?.banned)
    return (
      <Empty
        title="Профиль заблокирован"
        text={me.banReason}
        link="/settings"
        label="Открыть настройки"
      />
    );
  return me ? (
    children
  ) : (
    <Empty
      title="Ваше игровое пространство"
      text="Войдите в аккаунт, чтобы продолжить."
      link="/login"
      label="Войти"
    />
  );
}
export function Head({ eyebrow, title, text, children }) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {text && <p className="muted">{text}</p>}
      </div>
      {children}
    </div>
  );
}
export function Shell() {
  const { state, me, act } = useDemo();
  const [search, setSearch] = useState("");
  const nav = useNavigate();
  const { pathname } = useLocation();
  const group = navigationGroups.find((g) =>
    g.paths.some((p) => matchesPath(pathname, p)),
  );
  const friends = state.friends.filter(
    (f) => f.status === "accepted" && [f.from, f.to].includes(me?.id),
  );
  return (
    <div
      className={
        "app-shell " +
        (state.settings[me?.id]?.compact ? "density-compact " : "") +
        (state.settings[me?.id]?.motionOff ? "motion-off" : "")
      }
    >
      <a className="skip" href="#main">
        К содержимому
      </a>
      <aside className="sidebar">
        <Link className="logo" to="/">
          <span className="logo-icon">G↗</span>GD<span>STORE</span>
        </Link>
        <p className="nav-label">ПРОСТРАНСТВО</p>
        <nav className="primary-navigation" aria-label="Основная навигация">
          {navigationGroups.map((g) => (
            <Link
              key={g.to}
              to={g.to}
              className={group === g ? "active" : ""}
              aria-current={group === g ? "true" : undefined}
            >
              <Icon name={g.icon} />
              <span>{g.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-line" />
        <div className="friends-label">
          <p className="nav-label">ДРУЗЬЯ</p>
          <Link to="/friends" aria-label="Добавить друзей">
            ＋
          </Link>
        </div>
        <div className="sidebar-friends">
          {friends.slice(0, 4).map((f) => {
            const u = state.users.find(
              (u) => u.id === (f.from === me.id ? f.to : f.from),
            );
            return (
              <Link to={"/messages/" + u.id} key={u.id}>
                <Avatar user={u} />
                <span>
                  {u.name}
                  <small className={u.status === "playing" ? "accent" : ""}>
                    {u.status === "playing"
                      ? "В игре"
                      : u.status === "online"
                        ? "В сети"
                        : "Не в сети"}
                  </small>
                </span>
                <i className={"presence " + u.status} />
              </Link>
            );
          })}
          {!friends.length && (
            <Link to="/friends" className="muted">
              Найти свою команду →
            </Link>
          )}
        </div>
        <div className="sidebar-bottom">
          <NavLink to="/support" title="Поддержка">
            <Icon name="shield" />
            <span>Поддержка</span>
          </NavLink>
          {me?.role === "admin" && !me.banned && (
            <NavLink
              className="admin-link"
              title="Администрирование"
              to="/admin"
            >
              <Icon name="shield" />
              <span>Управление сайтом</span>
            </NavLink>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="crumb">
            Игра начинается здесь<span>/</span>
            <strong>GD Store</strong>
          </div>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              nav("/?search=" + encodeURIComponent(search));
            }}
          >
            <Icon name="search" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Найти игру"
              aria-label="Поиск игр"
            />
            <kbd>↵</kbd>
          </form>
          <Link className="icon-btn" to="/friends" aria-label="Друзья и заявки">
            <Icon name="users" />
            {state.friends.some(
              (f) => f.to === me?.id && f.status === "pending",
            ) && <i className="notification-dot" />}
          </Link>
          <Link
            className="icon-btn notification-nav"
            to="/notifications"
            aria-label="Уведомления"
          >
            <Icon name="bell" />
            {state.notifications.some((n) => n.to === me?.id && !n.read) && (
              <b>
                {Math.min(
                  99,
                  state.notifications.filter((n) => n.to === me?.id && !n.read)
                    .length,
                )}
              </b>
            )}
          </Link>
          <Link className="icon-btn" to="/cart" aria-label="Корзина">
            <Icon name="cart" />
            {!!state.cart[me?.id]?.length && <b>{state.cart[me.id].length}</b>}
          </Link>
          {me && (
            <div className="header-balances">
              <Link to="/wallet" title="Демокошелёк">
                <span>Кошелёк ＋</span>
                <strong>
                  {new Intl.NumberFormat("ru-RU").format(me.wallet || 0)} ₴
                </strong>
              </Link>
              <Link to="/points-history" title="История демобаллов">
                <span>Демобаллы</span>
                <strong>✦ {me.points || 0}</strong>
              </Link>
            </div>
          )}
          <ProfileMenu me={me} />
        </header>
        <div className="demo-bar">
          <span>
            <i /> {state.paymentTestMode ? "Учебный режим · без реальных покупок" : "Покупки выключены на сервере"}
          </span>
          <Link to="/settings">Настройки профиля ↗</Link>
        </div>
        {state.announcement.enabled && (
          <div className="site-announcement live-announcement">
            <Icon name="spark" />
            <span>{state.announcement.text}</span>
          </div>
        )}
        {me?.banned && (
          <div className="ban-banner" role="status">
            Профиль заблокирован: {me.banReason}. Публикации, сообщения и
            покупки недоступны.
          </div>
        )}
        <SectionNavigation group={group} path={pathname} />
        <main id="main">
          <Outlet key={["/login", "/register", "/forgot-password"].includes(pathname) ? "auth" : state.active || "guest"} />
          <SaleWatcher />
          <GiftArrival />
        </main>
        <footer>
          <span>GD STORE / PLAY YOUR WAY</span>
          <span>Учебный магазин. Без реальных списаний и выдачи игровых ключей.</span>
          <button
            className="link-button"
            onClick={async () => {
              if (await act({ type: "switch", user: null })) nav("/login");
            }}
          >
            Сменить аккаунт
          </button>
        </footer>
      </div>
    </div>
  );
}
export function GameCard({ game }) {
  const { state, me, act } = useDemo();
  const wished = state.wishlist[me?.id]?.includes(game.id);
  return (
    <article className="game-card">
      <Link to={"/game/" + game.id} className="game-art">
        <Art game={game} />
        <span className="cover-title">{game.title}</span>
        {game.discount > 0 && (
          <span className="discount">−{game.discount}%</span>
        )}
      </Link>
      <button
        className={"wish-btn " + (wished ? "selected" : "")}
        aria-label={
          (wished ? "Убрать из" : "Добавить в") + " желаемое: " + game.title
        }
        onClick={async () =>
          await act(
            { type: "wishlist", game: game.id },
            wished ? "Удалено из желаемого" : "Добавлено в желаемое",
          )
        }
      >
        <Icon name="heart" size={18} />
      </button>
      <button
        className={
          "compare-toggle " +
          (state.comparison[me?.id]?.includes(game.id) ? "selected" : "")
        }
        aria-label={"Сравнить " + game.title}
        aria-pressed={!!state.comparison[me?.id]?.includes(game.id)}
        onClick={async () => await act({ type: "compare", game: game.id })}
      >
        <Icon name="compare" size={17} />
      </button>
      <div className="card-info">
        <p className="micro">
          {game.genre}
          <span className="rating">{game.rating == null ? "Нет отзывов" : `● ${game.rating}%`}</span>
        </p>
        <Link to={"/game/" + game.id}>
          <h3>{game.title}</h3>
        </Link>
        <div className="card-bottom">
          <span>{game.isPreorder ? "Предзаказ" : game.tags[0]}</span>
          <div>
            {game.discount > 0 && <del>{money(game.price)}</del>}
            <strong>{money(price(game))}</strong>
          </div>
        </div>
      </div>
    </article>
  );
}
export function Store() {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") || "";
  const [genre, setGenre] = useState("Все игры"),
    [sort, setSort] = useState("popular"),
    [sale, setSale] = useState(false);
  const featured = games.filter((g) => g.available !== false);
  const hero = featured[0];
  const found = games
    .filter(
      (g) =>
        g.available !== false &&
        (genre === "Все игры" || g.genre === genre) &&
        (!sale || g.discount > 0) &&
        (g.title + " " + g.tags.join(" "))
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "price" ? price(a) - price(b) : b.rating - a.rating,
    );
  return (
    <>
      <div className="store-heading">
        <div>
          <p className="eyebrow">CURATED FOR YOU</p>
          <h1>
            Найди свой следующий мир<span className="accent">.</span>
          </h1>
        </div>
        <Link className="subtle" to="/wishlist">
          Ваш список желаемого <Icon name="arrow" size={17} />
        </Link>
      </div>
      {!search && hero && (
        <div className="feature-grid">
          <Link to={"/game/" + hero.id} className="hero">
            <Art game={hero} />
            <div className="hero-copy">
              <span className="pill">
                <i /> В ФОКУСЕ
              </span>
              <p className="hero-kicker">{hero.developer}</p>
              <h2>{hero.title}</h2>
              <p>{hero.tagline}</p>
              <div className="hero-bottom">
                <span className="btn primary">
                  Исследовать игру <Icon name="arrow" size={18} />
                </span>
                <div>
                  {hero.discount > 0 && <span className="discount">−{hero.discount}%</span>}
                  <strong>{money(price(hero))}</strong>
                </div>
              </div>
            </div>
            <div className="hero-index">
              01 <span>/ FEATURED</span>
            </div>
          </Link>
          <div className="feature-side">
            {featured[1] && <Link className="mini-feature" to={"/game/" + featured[1].id}>
              <Art game={featured[1]} />
              <div>
                <span className="micro">{featured[1].isPreorder ? "ПРЕДЗАКАЗ" : "В КАТАЛОГЕ"}</span>
                <h2>
                  {featured[1].title}
                </h2>
                <span className="circle-arrow">↗</span>
              </div>
            </Link>}
            <Link className="community-promo" to="/friends">
              <span className="small-orbit">
                <Icon name="users" size={27} />
              </span>
              <div>
                <h3>
                  Хорошие игры.
                  <br />
                  Лучшая компания.
                </h3>
                <p>
                  Найдите свою команду <span>↗</span>
                </p>
              </div>
            </Link>
          </div>
        </div>
      )}
      <DiscoveryStrip />
      <section className="catalog-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">СТОИТ ПОПРОБОВАТЬ</p>
            <h2>
              {search ? "Результаты: " + search : "Большие истории. Ваш выбор."}
            </h2>
          </div>
          <div className="filter-actions">
            <button
              className={"chip " + (sale ? "active" : "")}
              onClick={() => setSale(!sale)}
            >
              Только скидки
            </button>
            <select
              aria-label="Сортировка"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="popular">По рейтингу</option>
              <option value="price">Сначала дешевле</option>
            </select>
          </div>
        </div>
        <div className="genre-row">
          {["Все игры", ...new Set(featured.map((g) => g.genre))].map((g) => (
            <button
              className={"chip " + (genre === g ? "active" : "")}
              onClick={() => setGenre(g)}
              key={g}
            >
              {g}
            </button>
          ))}
          {search && (
            <button className="chip" onClick={() => setParams({})}>
              Сбросить поиск ×
            </button>
          )}
        </div>
        <div className="game-grid">
          {found.map((g) => (
            <GameCard game={g} key={g.id} />
          ))}
        </div>
        {!found.length && (
          <Empty
            title="Ничего не нашлось"
            text="Попробуйте другой запрос или категорию."
          />
        )}
      </section>
      <section className="discovery-banner">
        <div>
          <p className="eyebrow">СОЗДАВАЙ БОЛЬШЕ</p>
          <h2>Твоя игра. Твои правила.</h2>
          <p>Моды, новые миры и идеи от сообщества.</p>
        </div>
        <Link to="/workshop" className="btn">
          Открыть мастерскую <Icon name="arrow" />
        </Link>
      </section>
    </>
  );
}
export function NotFound() {
  return <Empty title="Страница не найдена" text="Вернёмся к играм?" />;
}
