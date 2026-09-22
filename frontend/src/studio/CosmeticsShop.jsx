import { useState } from "react";
import { Link } from "react-router-dom";
import { useDemo } from "../demo/context";
import { cosmetics } from "../server/catalog.mjs";
import { Head, Gate, Avatar } from "./Studio";
import Icon from "../components/Icon";
export default function CosmeticsShop() {
  const { state, me, act } = useDemo();
  const [tab, setTab] = useState("all");
  const owned = state.cosmeticsOwned[me?.id] || [];
  const items = cosmetics.filter(
    (x) =>
      tab === "all" ||
      (tab === "owned" ? owned.includes(x.id) : x.type === tab),
  );
  return (
    <Gate>
      <Head
        eyebrow="POINTS SHOP / DEMO"
        title="Сделайте профиль своим"
        text="Аватары, баннеры и рамки с вашим характером."
      >
        <div className="points-balance">
          <Icon name="spark" />
          <strong>{me?.points ?? 1000}</strong>
          <span>демобаллов</span>
        </div>
      </Head>
      <div className="wardrobe-banner">
        <div>
          <p className="eyebrow">ВАШ СТИЛЬ — ВАШИ ПРАВИЛА</p>
          <h2>Узнаваемый с первого взгляда.</h2>
          <p>
            1000 стартовых демобаллов и 1 балл за каждые 10 ₴ демопокупки после
            скидки. Баллы за подарок получает покупатель. Настоящие деньги не
            используются.
          </p>
          <Link className="btn space" to="/profile">
            Мой профиль ↗
          </Link>
        </div>
        <Avatar user={me} large />
      </div>
      <Link className="btn space" to="/points-history">
        История демобаллов ↗
      </Link>
      <div className="tabs">
        {[
          ["all", "Всё"],
          ["avatar", "Аватары"],
          ["banner", "Баннеры"],
          ["frame", "Рамки"],
          ["owned", "Мои предметы"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="cosmetic-grid">
        {items.map((item) => {
          const has = owned.includes(item.id);
          const active =
            me?.[
              "cosmetic" + item.type[0].toUpperCase() + item.type.slice(1)
            ] === item.id;
          return (
            <article className="cosmetic-card" key={item.id}>
              <div className={"cosmetic-preview " + item.type}>
                {item.type === "frame" ? (
                  <span
                    className="frame-preview"
                    style={{ "--frame": item.color }}
                  >
                    <Avatar user={{ ...me, cosmeticFrame: "" }} large />
                  </span>
                ) : (
                  <img src={item.image} alt={item.name} />
                )}
                <span className="cosmetic-type">
                  {item.type === "avatar"
                    ? "АВАТАР"
                    : item.type === "banner"
                      ? "БАННЕР"
                      : "РАМКА"}
                </span>
              </div>
              <div className="cosmetic-info">
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <div>
                  <strong>
                    {has ? "В коллекции" : item.price + " баллов"}
                  </strong>
                  {has ? (
                    <button
                      className={"btn " + (active ? "" : "primary")}
                      onClick={async () =>
                        await act(
                          {
                            type: "cosmetic-equip",
                            slot: item.type,
                            item: active ? "" : item.id,
                          },
                          active ? "Оформление снято" : "Оформление применено",
                        )
                      }
                    >
                      {active ? "Снять" : "Применить"}
                    </button>
                  ) : (
                    <button
                      className="btn"
                      disabled={(me?.points ?? 0) < item.price}
                      onClick={async () =>
                        await act(
                          { type: "cosmetic-buy", item: item.id },
                          "Предмет добавлен в коллекцию",
                        )
                      }
                    >
                      Купить
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!items.length && (
        <div className="inbox-empty">
          <h2>Пока без обновок</h2>
          <p>Приобретённые предметы появятся здесь.</p>
        </div>
      )}
    </Gate>
  );
}
