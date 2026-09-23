import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Avatar } from "./Studio";
export const navigationGroups = [
  {
    to: "/",
    icon: "grid",
    label: "Магазин",
    paths: [
      "/",
      "/game",
      "/wishlist",
      "/compare",
      "/discover",
      "/cart",
      "/checkout",
    ],
    tabs: [
      ["/", "Каталог"],
      ["/wishlist", "Желаемое"],
      ["/compare", "Сравнение"],
    ],
  },
  {
    to: "/library",
    icon: "library",
    label: "Библиотека",
    paths: ["/library", "/collections"],
    tabs: [
      ["/library", "Все игры"],
      ["/collections", "Коллекции"],
    ],
  },
  {
    to: "/community",
    icon: "globe",
    label: "Сообщество",
    paths: ["/community", "/workshop", "/teammates", "/events"],
    tabs: [
      ["/community", "Обсуждения"],
      ["/workshop", "Мастерская"],
      ["/teammates", "Поиск напарников"],
      ["/events", "Игровые вечера"],
    ],
  },
  {
    to: "/friends",
    icon: "users",
    label: "Друзья и чаты",
    paths: ["/friends", "/messages"],
    tabs: [["/friends", "Друзья и переписки"]],
  },
];
export const matchesPath = (path, prefix) =>
  path === prefix || (prefix !== "/" && path.startsWith(prefix + "/"));
export function SectionNavigation({ group, path }) {
  if (!group) return null;
  return (
    <nav className="section-navigation" aria-label={"Разделы: " + group.label}>
      {group.tabs.map(([to, label]) => (
        <Link
          key={to}
          to={to}
          className={matchesPath(path, to) ? "active" : ""}
          aria-current={matchesPath(path, to) ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
export function ProfileMenu({ me }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const trigger = useRef(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      className="profile-dropdown"
      ref={ref}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="profile-trigger"
        aria-label="Меню профиля"
        aria-expanded={open}
        aria-controls="profile-navigation"
        onClick={() => setOpen(!open)}
      >
        <Avatar user={me} />
        <span>⌄</span>
      </button>
      {open && (
        <nav
          id="profile-navigation"
          className="profile-popover"
          aria-label="Меню профиля"
        >
          <div>
            <strong>{me?.name || "Гость"}</strong>
            <small>{me ? "Ваше пространство" : "Войдите в аккаунт"}</small>
          </div>
          {(me
            ? [
                ["/profile", "Мой профиль"],
                ["/points-shop", "Оформление"],
                ["/gifts", "Подарки"],
                ["/orders", "История покупок"],
                ["/settings", "Настройки"],
              ]
            : [
                ["/login", "Войти"],
                ["/register", "Регистрация"],
              ]
          ).map(([to, label]) => (
            <Link key={to} to={to} onClick={() => setOpen(false)}>
              {label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
