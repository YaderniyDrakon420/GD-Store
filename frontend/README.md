# GD Store frontend

React + Vite. Данные и учётные записи загружаются из Django; автономного режима с localStorage больше нет.

## Запуск

Сначала запустите Django по инструкции в корневом README. Нужен Node.js 22.12+.

```powershell
npm.cmd ci
npm.cmd run dev
```

Vite проксирует `/api` и `/media` на `http://127.0.0.1:8000`. Для другого адреса задайте переменную окружения `API_PROXY_TARGET` до запуска. Браузер обращается к тому же адресу Vite; сессия Django хранится в HttpOnly-cookie.

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

`src/server/api.mjs` отправляет запросы с CSRF и ключами идемпотентности, `src/server/context.jsx` синхронизирует серверное состояние, `src/server/catalog.mjs` содержит текущий каталог из API. Страницы `src/studio` сохраняют исходные CSS-классы и оформление.

Старые `src/demo/*.mjs` оставлены для тестовых фикстур и чистых вспомогательных функций. Страницы больше не вызывают локальный reducer и не сохраняют профили в браузере. `src/demo/context.jsx` — совместимый экспорт нового серверного провайдера.

Сборку `dist` нужно размещать вместе с прокси `/api` и `/media` на Django. `vite preview` сам по себе предназначен только для просмотра сборки и не заменяет сервер приложений.
