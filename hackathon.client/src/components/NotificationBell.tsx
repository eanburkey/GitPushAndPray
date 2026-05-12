import { useEffect, useRef, useState } from "react";
import { useNotifications } from "../notifications";
import type { Notification } from "../types";

type SwapBusy = "accept" | "decline" | null;

function formatRelative(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const diffMs = Date.now() - then;
    if (diffMs < 0) return "just now";
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NotificationBell() {
    const { notifications, unread, markRead, respondSwap } = useNotifications();
    const [open, setOpen] = useState(false);
    const [busyByNotif, setBusyByNotif] = useState<Record<number, SwapBusy>>({});
    const wrapRef = useRef<HTMLDivElement>(null);

    const respond = async (id: number, accept: boolean) => {
        setBusyByNotif(prev => ({ ...prev, [id]: accept ? "accept" : "decline" }));
        try {
            await respondSwap(id, accept);
        } catch {
            /* error surfaced elsewhere — bell stays tight */
        } finally {
            setBusyByNotif(prev => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
        }
    };

    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", onClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const recent = notifications.slice(0, 8);
    const unreadCount = unread.length;

    return (
        <div className="notif-bell-wrap" ref={wrapRef}>
            <button
                type="button"
                className={`notif-bell-button ${unreadCount > 0 ? "has-unread" : ""}`}
                aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
                aria-expanded={open}
                aria-haspopup="menu"
                onClick={() => setOpen(o => !o)}
            >
                <BellIcon />
                {unreadCount > 0 && (
                    <span className="notif-bell-badge" aria-hidden>
                        {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="notif-popover" role="menu">
                    <header className="notif-popover-head">
                        <span>Notifications</span>
                        {unreadCount > 0 && <span className="notif-popover-count">{unreadCount} new</span>}
                    </header>

                    {recent.length === 0 ? (
                        <div className="notif-popover-empty">You're all caught up.</div>
                    ) : (
                        <ul className="notif-popover-list">
                            {recent.map(n => (
                                <NotificationRow
                                    key={n.id}
                                    notification={n}
                                    busy={busyByNotif[n.id] ?? null}
                                    onMarkRead={() => markRead(n.id)}
                                    onRespond={accept => respond(n.id, accept)}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

function NotificationRow({ notification, busy, onMarkRead, onRespond }: {
    notification: Notification;
    busy: SwapBusy;
    onMarkRead: () => void;
    onRespond: (accept: boolean) => void;
}) {
    const { isRead, kind, message, createdAt } = notification;
    const isActionableTrade = !isRead && kind === "trade" && notification.tradeRequesterId !== null;
    return (
        <li className={`notif-row notif-row-${kind} ${isRead ? "is-read" : "is-unread"}`}>
            <span className={`notif-row-dot notif-row-dot-${kind}`} aria-hidden />
            <div className="notif-row-body">
                <div className="notif-row-message">{message}</div>
                <div className="notif-row-meta">
                    <span>{formatRelative(createdAt)}</span>
                    {!isRead && !isActionableTrade && (
                        <button type="button" className="link-btn" onClick={onMarkRead}>
                            Mark read
                        </button>
                    )}
                </div>
                {isActionableTrade && (
                    <div className="notif-row-actions">
                        <button
                            type="button"
                            className="primary-btn small"
                            disabled={busy !== null}
                            onClick={() => onRespond(true)}
                        >
                            {busy === "accept" ? "Accepting…" : "Accept"}
                        </button>
                        <button
                            type="button"
                            className="ghost-btn small"
                            disabled={busy !== null}
                            onClick={() => onRespond(false)}
                        >
                            {busy === "decline" ? "Declining…" : "Decline"}
                        </button>
                    </div>
                )}
            </div>
        </li>
    );
}

function BellIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false">
            <path
                fill="currentColor"
                d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-1.7 1.7A1 1 0 0 0 4 19.4h16a1 1 0 0 0 .7-1.7Z"
            />
        </svg>
    );
}
