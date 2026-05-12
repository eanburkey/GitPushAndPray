import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const MAX_LEN = 500;

export default function FloorAnnouncementModal({
    floor,
    callerId,
    onClose,
}: {
    floor: number;
    callerId: number;
    onClose: () => void;
}) {
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        textareaRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    const trimmed = message.trim();
    const canSend = trimmed.length > 0 && trimmed.length <= MAX_LEN && !busy;

    const send = async () => {
        if (!canSend) return;
        setBusy(true);
        setResult(null);
        try {
            const r = await api.broadcastFloorAnnouncement(callerId, floor, trimmed);
            if (r.sent === 0) {
                setResult({ kind: "ok", text: `No one is based on Floor ${floor} — nothing was sent.` });
            } else {
                setResult({
                    kind: "ok",
                    text: `Announcement sent to ${r.sent} ${r.sent === 1 ? "person" : "people"} on Floor ${floor}.`,
                });
                setMessage("");
            }
        } catch (e) {
            setResult({ kind: "err", text: (e as Error).message });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-card announcement-modal" role="dialog" aria-modal="true" aria-label={`Send announcement to Floor ${floor}`}>
                <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
                <h2 style={{ marginTop: 0, marginBottom: 4 }}>Announce to Floor {floor}</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                    Everyone who's on this floor will receive this message in their notifications.
                </p>
                <textarea
                    ref={textareaRef}
                    className="announcement-textarea"
                    placeholder="Write a message…"
                    value={message}
                    maxLength={MAX_LEN}
                    onChange={e => setMessage(e.target.value)}
                    rows={5}
                />
                <div className="announcement-meta">
                    <span className={trimmed.length > MAX_LEN ? "muted is-error" : "muted"}>
                        {trimmed.length}/{MAX_LEN}
                    </span>
                </div>
                {result && (
                    <div className={result.kind === "ok" ? "announcement-ok" : "announcement-err"}>
                        {result.text}
                    </div>
                )}
                <div className="announcement-actions">
                    <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
                        Close
                    </button>
                    <button type="button" className="primary-btn" onClick={send} disabled={!canSend}>
                        {busy ? "Sending…" : "Send"}
                    </button>
                </div>
            </div>
        </div>
    );
}
