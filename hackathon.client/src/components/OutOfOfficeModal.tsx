import { useEffect, useState } from "react";
import { api } from "../api";

interface Props {
    userId: number;
    onClose: () => void;
    onSaved?: () => void;
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function maxIso() {
    const d = new Date();
    d.setDate(d.getDate() + 90);
    return d.toISOString().slice(0, 10);
}

function formatDate(iso: string) {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
    });
}

export default function OutOfOfficeModal({ userId, onClose, onSaved }: Props) {
    const [start, setStart] = useState(todayIso());
    const [end, setEnd] = useState(todayIso());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    // Keep end >= start as the user adjusts the start input.
    useEffect(() => {
        if (end < start) setEnd(start);
    }, [start, end]);

    const submit = async () => {
        if (!start || !end) return;
        setSaving(true);
        setError(null);
        try {
            await api.addHolidayRange(userId, start, end);
            onSaved?.();
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const days = Math.max(
        0,
        Math.round(
            (new Date(end + "T00:00:00").getTime() - new Date(start + "T00:00:00").getTime())
            / 86_400_000,
        ) + 1,
    );

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-card" onClick={e => e.stopPropagation()}>
                <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
                <h2 style={{ marginTop: 0 }}>Out of office</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                    Pick a date range and the auto-booker will skip you on those days.
                    Any desks already auto-booked for you in that range will be released.
                </p>

                <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
                    <label style={{ display: "grid", gap: 4 }}>
                        <span className="section-label">From</span>
                        <input
                            type="date"
                            value={start}
                            min={todayIso()}
                            max={maxIso()}
                            onChange={e => setStart(e.target.value)}
                        />
                    </label>

                    <label style={{ display: "grid", gap: 4 }}>
                        <span className="section-label">To</span>
                        <input
                            type="date"
                            value={end}
                            min={start || todayIso()}
                            max={maxIso()}
                            onChange={e => setEnd(e.target.value)}
                        />
                    </label>

                    {start && end && end >= start && (
                        <div className="muted" style={{ fontSize: 13 }}>
                            {days === 1
                                ? `Out on ${formatDate(start)}.`
                                : `Out for ${days} days — ${formatDate(start)} to ${formatDate(end)}.`}
                        </div>
                    )}

                    {error && <div className="alert alert-displaced">{error}</div>}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
                    <button className="ghost-btn" onClick={onClose} disabled={saving}>Cancel</button>
                    <button className="primary-btn" onClick={submit} disabled={saving || !start || !end || end < start}>
                        {saving ? "Saving…" : "Set out of office"}
                    </button>
                </div>
            </div>
        </div>
    );
}
