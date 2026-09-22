import { useState } from "react";
import { useDemo } from "../demo/context";
import { reportReasons } from "../demo/community.mjs";
import { Modal, Author, date } from "./Personal";
export function ReportButton({ user, message, compact = false }) {
  const { me, act } = useDemo();
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(reportReasons[0]),
    [details, setDetails] = useState("");
  if (!me || me.id === user || me.banned) return null;
  return (
    <>
      <button
        type="button"
        className={compact ? "message-report" : "btn report-button"}
        title="Пожаловаться"
        aria-label={
          message ? "Пожаловаться на сообщение" : "Пожаловаться на игрока"
        }
        onClick={() => setOpen(true)}
      >
        {compact ? "⚑" : "Пожаловаться"}
      </button>
      {open && (
        <Modal
          title={message ? "Жалоба на сообщение" : "Жалоба на игрока"}
          onClose={() => setOpen(false)}
        >
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  {
                    type: "report-create",
                    kind: message ? "message" : "player",
                    user,
                    messageId: message,
                    reason,
                    details,
                  },
                  "Жалоба отправлена администраторам",
                )
              ) {
                setOpen(false);
                setDetails("");
              }
            }}
          >
            <p className="muted">
              Администратор увидит причину жалобы
              {message ? " и текст этого сообщения" : ""}.
            </p>
            <label>
              Причина
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {reportReasons.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              Подробности
              <textarea
                maxLength={1000}
                rows={4}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Что произошло?"
              />
            </label>
            <button className="btn primary">Отправить жалобу</button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function ReportsQueue() {
  const { state, me, act } = useDemo();
  const [filter, setFilter] = useState("pending"),
    [review, setReview] = useState(null),
    [note, setNote] = useState("");
  if (me?.role !== "admin" || me.banned) return null;
  const reports = state.reports.filter(
    (r) => filter === "all" || r.status === filter,
  );
  return (
    <>
      <div className="section-title">
        <h2>Очередь жалоб</h2>
        <select
          aria-label="Статус жалоб"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="pending">Ожидают решения</option>
          <option value="resolved">Подтверждены</option>
          <option value="dismissed">Отклонены</option>
          <option value="all">Все</option>
        </select>
      </div>
      {reports.map((r) => (
        <article className="panel report-card space" key={r.id}>
          <div className="section-title">
            <div>
              <p className="eyebrow">
                {r.kind === "message" ? "СООБЩЕНИЕ" : "ПРОФИЛЬ"} · {date(r.at)}
              </p>
              <h3>{r.reason}</h3>
            </div>
            <span className="status-tag">
              {r.status === "pending"
                ? "Ожидает"
                : r.status === "resolved"
                  ? "Подтверждена"
                  : "Отклонена"}
            </span>
          </div>
          <div className="report-people">
            <span>
              От <Author id={r.reporter} />
            </span>
            <span>
              На <Author id={r.user} />
            </span>
          </div>
          {r.evidence && <blockquote>{r.evidence}</blockquote>}
          {r.details && <p className="report-details">{r.details}</p>}
          {r.note && <p className="report-decision">Решение: {r.note}</p>}
          {r.status === "pending" && (
            <div className="actions space">
              <button
                className="btn primary"
                onClick={() => {
                  setReview({ id: r.id, status: "resolved" });
                  setNote("");
                }}
              >
                Подтвердить жалобу
              </button>
              <button
                className="btn"
                onClick={() => {
                  setReview({ id: r.id, status: "dismissed" });
                  setNote("");
                }}
              >
                Отклонить
              </button>
              {state.users.find((u) => u.id === r.user)?.role !== "admin" &&
                !state.users.find((u) => u.id === r.user)?.banned && (
                  <button
                    className="btn danger"
                    onClick={async () =>
                      await act(
                        { type: "admin-ban", user: r.user, reason: r.reason },
                        "Игрок заблокирован",
                      )
                    }
                  >
                    Заблокировать игрока
                  </button>
                )}
            </div>
          )}
        </article>
      ))}
      {!reports.length && (
        <div className="inbox-empty">
          <h2>Очередь пуста</h2>
          <p>Новые жалобы игроков появятся здесь.</p>
        </div>
      )}
      {review && (
        <Modal title="Решение по жалобе" onClose={() => setReview(null)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  {
                    type: "admin-report-resolve",
                    report: review.id,
                    status: review.status,
                    note,
                  },
                  "Решение сохранено",
                )
              )
                setReview(null);
            }}
          >
            <p className="fine">
              Пояснение получит автор жалобы. Подтверждение жалобы само по себе
              не блокирует игрока.
            </p>
            <label>
              Пояснение
              <textarea
                required
                maxLength={500}
                rows={4}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button className="btn primary">Сохранить решение</button>
          </form>
        </Modal>
      )}
    </>
  );
}
