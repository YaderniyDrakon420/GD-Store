import { useEffect, useRef } from "react";
import { api } from "../server/api.mjs";
import { studioUrl } from "../server/urls.mjs";

export function Attachment({ media }) {
  if (!media) return null;
  const url = studioUrl("attachments/" + encodeURIComponent(media.id) + "/");
  return (
    <a className="chat-attachment" href={url} target="_blank" rel="noreferrer">
      {media.mime.startsWith("image/") && (
        <img src={url} alt={media.name} loading="lazy" />
      )}
      <span>
        {media.name} · {Math.ceil(media.size / 1024)} КБ ↗
      </span>
    </a>
  );
}

export function useChatActivity({ me, peer, allowed, lastMessage }) {
  const lastTyping = useRef(0);
  useEffect(() => {
    if (!me || !peer || !allowed) return;
    const mark = () => {
      if (document.visibilityState !== "hidden" && document.hasFocus())
        api
          .request("chat-activity/", {
            method: "POST",
            body: { user: peer, read: true, typing: false },
            user: me,
          })
          .catch(() => {});
    };
    mark();
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [me, peer, allowed, lastMessage]);
  return (typing) => {
    if (
      !me ||
      !peer ||
      !allowed ||
      (typing && Date.now() - lastTyping.current < 3500)
    )
      return;
    lastTyping.current = Date.now();
    api
      .request("chat-activity/", {
        method: "POST",
        body: { user: peer, typing },
        user: me,
      })
      .catch(() => {});
  };
}
