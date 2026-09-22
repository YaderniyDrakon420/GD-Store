import { Link, useNavigate } from "react-router-dom";
import { useDemo } from "../demo/context";
import { games } from "../server/catalog.mjs";
import { Head, Art, Gate, Empty } from "./Studio";
import { Modal, Author, date } from "./Personal";
import Icon from "../components/Icon";
export function GiftArrival() {
  const { state, me, act } = useDemo();
  const navigate = useNavigate();
  const gift = state.gifts.find((g) => g.to === me?.id && !g.opened);
  if (!gift || me?.banned || state.settings[me?.id]?.notifications?.gifts===false) return null;
  const close = async () => await act({ type: "gift-open", gift: gift.id });
  return (
    <Modal key={gift.id} title="Для вас приготовили подарок" onClose={close}>
      <div className="gift-arrival">
        <span className="gift-seal">
          <Icon name="gift" size={42} />
        </span>
        <Author id={gift.from} />
        <h2>Дарит вам новое приключение</h2>
        {gift.message && <blockquote>{gift.message}</blockquote>}
        <div className="gift-game-names">
          {gift.gameIds.map((id) => (
            <strong key={id}>{games.find((g) => g.id === id)?.title}</strong>
          ))}
        </div>
        <p className="fine">Игры уже добавлены в вашу библиотеку.</p>
        <button
          className="btn primary"
          onClick={() => {
            if (close()) navigate("/gifts");
          }}
        >
          Посмотреть подарок <Icon name="arrow" />
        </button>
      </div>
    </Modal>
  );
}
export default function Gifts() {
  const { state, me } = useDemo();
  const received = state.gifts.filter((g) => g.to === me?.id);
  return (
    <Gate>
      <Head
        eyebrow="SOMEONE THOUGHT OF YOU"
        title="Маленькие знаки внимания"
        text="Подарки друзей, которые становятся большими историями."
      />
      {received.map((gift) => (
        <article className="gift-history panel" key={gift.id}>
          <div className="gift-history-head">
            <Author id={gift.from} />
            <span className="muted">{date(gift.at)}</span>
            <span className="status-tag">В вашей библиотеке</span>
          </div>
          {gift.message && <blockquote>{gift.message}</blockquote>}
          <div className="gift-covers">
            {gift.gameIds.map((id) => {
              const game = games.find((g) => g.id === id);
              return (
                <Link to={"/game/" + id} className="gift-cover" key={id}>
                  <Art game={game} />
                  <strong>{game.title}</strong>
                </Link>
              );
            })}
          </div>
          <Link className="btn space" to="/library">
            Открыть библиотеку
          </Link>
        </article>
      ))}
      {!received.length && (
        <Empty
          title="Здесь будут ваши подарки"
          text="Друг может выбрать вас получателем при оформлении демопокупки."
          link="/friends"
          label="Мои друзья"
        />
      )}
    </Gate>
  );
}
