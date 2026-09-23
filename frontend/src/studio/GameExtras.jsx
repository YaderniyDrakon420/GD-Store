import { Fragment, useState } from "react";
import { Modal } from "./Personal";
import "./extras.css";

export function GameExtras({ game }) {
  const images = game.screenshots || [];
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const index = Math.min(selected, Math.max(0, images.length - 1));
  const image = images[index];
  const move = (step) => setSelected((index + step + images.length) % images.length);
  const controls = images.length > 1 && (
    <div className="actions">
      <button type="button" className="btn" onClick={() => move(-1)} aria-label="Предыдущий скриншот">←</button>
      <span className="muted" aria-live="polite">{index + 1} / {images.length}</span>
      <button type="button" className="btn" onClick={() => move(1)} aria-label="Следующий скриншот">→</button>
    </div>
  );
  const requirements = game.requirements || {};
  const fields = [["os", "Операционная система"], ["cpu", "Процессор"], ["ram", "Оперативная память"],
    ["gpu", "Видеокарта"], ["storage", "Место на диске"]].filter(([key]) => requirements[key]);
  return (
    <>
      <section className="game-gallery space" aria-label={"Скриншоты " + game.title}>
        <div className="section-title"><h3>Скриншоты</h3>{controls}</div>
        {image ? (
          <>
            <button className="gallery-main" onClick={() => setExpanded(true)} aria-label="Увеличить скриншот">
              <img src={image.image} alt={`Скриншот ${index + 1}: ${game.title}`} />
            </button>
            <div className="gallery-thumbs">
              {images.map((shot, i) => (
                <button key={shot.id} className={i === index ? "active" : ""} onClick={() => setSelected(i)}
                  aria-pressed={i === index} aria-label={`Скриншот ${i + 1}`}>
                  <img src={shot.image} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </>
        ) : <p className="muted">Скриншоты пока не добавлены.</p>}
      </section>
      <section className="game-requirements space" aria-label="Системные требования">
        <h3>Минимальные требования к ПК</h3>
        {fields.length ? (
          <dl className="specs">
            {fields.map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{requirements[key]}</dd></Fragment>)}
          </dl>
        ) : <p className="muted">Требования к ПК пока не опубликованы в каталоге. Платформы игры: {game.platforms || "не указаны"}.</p>}
        {requirements.notes && <p className="fine">{requirements.notes}</p>}
        {game.officialUrl && <a href={game.officialUrl} target="_blank" rel="noreferrer">Актуальные сведения на официальной странице ↗</a>}
      </section>
      {expanded && image && (
        <Modal title={game.title + " · скриншоты"} onClose={() => setExpanded(false)}>
          <img className="gallery-modal-image" src={image.image} alt={`Скриншот ${index + 1}: ${game.title}`} />
          {controls}
        </Modal>
      )}
    </>
  );
}
