import { useEffect, useState } from "react";
import { api } from "../api";
import type { CancelHolidayResult, Holiday } from "../types";

function formatDate(iso: string) {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
    });
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function maxIso() {
    const d = new Date();
    d.setDate(d.getDate() + 60); // holidays can be added further out than bookings
    return d.toISOString().slice(0, 10);
}

interface Props {
    userId: number;
    onChanged?: () => void;
}

export default function HolidaysCard({ userId, onChanged }: Props) {
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [loading, setLoading] = useState(true);
    const [newDate, setNewDate] = useState(todayIso());
    const [adding, setAdding] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setHolidays(await api.holidays(userId));
        setLoading(false);
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    const add = async () => {
        if (!newDate) return;
        setAdding(true);
        setMessage(null);
        try {
            const r = await api.addHoliday(userId, newDate);
            setMessage(
                r.freedAutoBooking
                    ? `Holiday added for ${formatDate(newDate)} — your auto-booked desk for that day was released.`
                    : `Holiday added for ${formatDate(newDate)}.`,
            );
            await load();
            onChanged?.();
        } catch (e) {
            setMessage((e as Error).message);
        } finally {
            setAdding(false);
        }
    };

    const cancel = async (h: Holiday) => {
        setMessage(null);
        try {
            const r: CancelHolidayResult = await api.cancelHoliday(userId, h.id);
            if (r.autoBooked && r.desk) {
                setMessage(
                    `Holiday cancelled. You've been auto-booked back onto Floor ${r.desk.floor} · Desk ${r.desk.number} (${formatDate(r.date)}).`,
                );
            } else if (r.isTeamDay) {
                setMessage(
                    r.notice ?? `Holiday cancelled. No desks free next to your team on ${formatDate(r.date)} — please book one manually.`,
                );
            } else {
                setMessage(`Holiday cancelled for ${formatDate(r.date)}.`);
            }
            await load();
            onChanged?.();
        } catch (e) {
            setMessage((e as Error).message);
        }
    };

    return (
        <section className="card">
            <header className="card-head">
                <h2>My holidays</h2>
                <span className="hint">
                    Synced hourly from Workday. The auto-booker skips you on these days.
                </span>
            </header>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                <input
                    type="date"
                    value={newDate}
                    min={todayIso()}
                    max={maxIso()}
                    onChange={e => setNewDate(e.target.value)}
                />
                <button className="primary-btn" disabled={adding} onClick={add}>
                    {adding ? "Adding…" : "Book holiday"}
                </button>
                {message && <span className="hint">{message}</span>}
            </div>

            {loading ? (
                <div className="muted">Loading…</div>
            ) : holidays.length === 0 ? (
                <div className="empty">No upcoming holidays.</div>
            ) : (
                <ul className="booking-list">
                    {holidays.map(h => (
                        <li key={h.id} className="booking-row">
                            <div>
                                <div className="booking-date">{formatDate(h.date)}</div>
                                <div className="muted">Out of office — auto-booker will skip this day.</div>
                            </div>
                            <button className="ghost-btn" onClick={() => cancel(h)}>Cancel holiday</button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
