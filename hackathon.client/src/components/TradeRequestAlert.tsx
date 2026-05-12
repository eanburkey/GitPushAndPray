import { useState } from "react";
import { useNotifications } from "../notifications";
import type { Notification } from "../types";

interface Props {
    notification: Notification;
    relativeTime?: string;
    onResolved?: () => void;
}

export default function TradeRequestAlert({ notification, relativeTime, onResolved }: Props) {
    const { respondSwap } = useNotifications();
    const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
    const [error, setError] = useState<string | null>(null);

    const respond = async (accept: boolean) => {
        setBusy(accept ? "accept" : "decline");
        setError(null);
        try {
            await respondSwap(notification.id, accept);
            onResolved?.();
        } catch (e) {
            setError((e as Error).message);
            setBusy(null);
        }
    };

    return (
        <div className="alert alert-trade">
            <span className="alert-icon" aria-hidden>⇄</span>
            <div className="alert-body">
                <span className="alert-title">Desk swap requested</span>
                <span>{notification.message}</span>
                {relativeTime && <span className="alert-time">{relativeTime}</span>}
                {error && <span className="alert-error">{error}</span>}
            </div>
            <div className="alert-actions">
                <button
                    type="button"
                    className="primary-btn small"
                    disabled={busy !== null}
                    onClick={() => respond(true)}
                >
                    {busy === "accept" ? "Accepting…" : "Accept"}
                </button>
                <button
                    type="button"
                    className="ghost-btn small"
                    disabled={busy !== null}
                    onClick={() => respond(false)}
                >
                    {busy === "decline" ? "Declining…" : "Decline"}
                </button>
            </div>
        </div>
    );
}
