import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useNotifications } from "../notifications";
import BookingsCarousel from "../components/BookingsCarousel";
import OutOfOfficeModal from "../components/OutOfOfficeModal";
import TradeRequestAlert from "../components/TradeRequestAlert";
import type { Booking, Holiday } from "../types";

function formatDate(iso: string) {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
    });
}

function addDaysIso(iso: string, days: number) {
    // Parse + format in UTC so a local timezone offset can't shift the result —
    // otherwise this can return the same string in eastern timezones and the
    // conflict-detection loop below spins forever.
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

interface OooRange { start: string; end: string; days: number; }

function groupConsecutive(dates: string[]): OooRange[] {
    if (dates.length === 0) return [];
    const sorted = [...dates].sort();
    const ranges: OooRange[] = [];
    let start = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        const expected = addDaysIso(prev, 1);
        if (sorted[i] === expected) {
            prev = sorted[i];
            continue;
        }
        ranges.push({ start, end: prev, days: daysBetween(start, prev) });
        start = sorted[i];
        prev = sorted[i];
    }
    ranges.push({ start, end: prev, days: daysBetween(start, prev) });
    return ranges;
}

function daysBetween(startIso: string, endIso: string) {
    const ms = new Date(endIso + "T00:00:00").getTime() - new Date(startIso + "T00:00:00").getTime();
    return Math.round(ms / 86_400_000) + 1;
}

function formatNotificationTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const diffMs = Date.now() - then;
    if (diffMs < 60_000) return "just now";
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(iso).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
}

export default function DashboardPage() {
    const { user } = useAuth();
    const { unread, markRead, refresh: refreshNotifications, bookingsChangedAt } = useNotifications();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [loading, setLoading] = useState(true);
    const [oooOpen, setOooOpen] = useState(false);
    // Tracks the last-seen invalidation tick so the auto-reload effect only fires
    // when the signal actually changes — not on initial mount when the value is
    // already non-zero (e.g. user re-navigated to the dashboard).
    const lastInvalidationRef = useRef(bookingsChangedAt);

    const load = async () => {
        if (!user) return;
        setLoading(true);
        const [b, h] = await Promise.all([
            api.myBookings(user.id),
            api.holidays(user.id),
        ]);
        setBookings(b);
        setHolidays(h);
        // Pull the latest notifications too so banners stay in sync after actions
        // that may have changed them (e.g. cancelling out-of-office which clears
        // a displaced-by-OOO notification).
        await refreshNotifications();
        setLoading(false);
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    // Auto-refresh when something off-page changed our bookings — e.g. another user
    // accepted our swap request, or we accepted one of theirs from the bell.
    useEffect(() => {
        if (bookingsChangedAt !== lastInvalidationRef.current) {
            lastInvalidationRef.current = bookingsChangedAt;
            load();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookingsChangedAt]);

    if (!user) return null;

    const cancel = async (id: number) => {
        await api.cancelBooking(user.id, id);
        await load();
    };

    const today = new Date().toISOString().slice(0, 10);
    const upcoming = bookings
        .filter(b => b.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
    const mandatory = upcoming.filter(b => b.kind === "Mandatory");
    const optional = upcoming.filter(b => b.kind === "Manual");

    const oooRanges = groupConsecutive(
        holidays.map(h => h.date).filter(d => d >= today),
    );
    const bookingDates = new Set(upcoming.map(b => b.date));
    const oooBanners = oooRanges.map(r => {
        const conflicts: string[] = [];
        for (let d = r.start; d <= r.end; d = addDaysIso(d, 1)) {
            if (bookingDates.has(d)) conflicts.push(d);
        }
        return { ...r, conflicts };
    });

    const dismiss = async (id: number) => {
        await markRead(id);
    };

    const cancelOoo = async (startIso: string, endIso: string) => {
        const label = startIso === endIso ? formatDate(startIso) : `${formatDate(startIso)} – ${formatDate(endIso)}`;
        if (!window.confirm(`Cancel out-of-office for ${label}?`)) return;
        try {
            await api.cancelHolidayRange(user.id, startIso, endIso);
        } catch (e) {
            window.alert(`Couldn't cancel out-of-office: ${(e as Error).message}`);
            return;
        }
        await load();
    };

    return (
        <div className="page dashboard-page">
            <section className="hero hero-slim">
                <div>
                    <h1>Hi {user.name.split(" ")[0]} 👋</h1>
                    <p>
                        {upcoming.length === 0
                            ? "No upcoming bookings yet."
                            : `${upcoming.length} upcoming booking${upcoming.length === 1 ? "" : "s"}`}
                        {mandatory.length > 0 && ` · ${mandatory.length} mandatory`}
                        {optional.length > 0 && ` · ${optional.length} optional`}
                    </p>
                </div>
                <div className="hero-actions">
                    <Link to="/floors" className="primary-btn">Book a desk</Link>
                    <button type="button" className="ghost-btn" onClick={() => setOooOpen(true)}>
                        I'm out of office
                    </button>
                </div>
            </section>

            {oooOpen && (
                <OutOfOfficeModal
                    userId={user.id}
                    onClose={() => setOooOpen(false)}
                    onSaved={load}
                />
            )}

            {oooBanners.length > 0 && (
                <section className="alert-stack">
                    {oooBanners.map(r => {
                        const label = r.start === r.end
                            ? formatDate(r.start)
                            : `${formatDate(r.start)} – ${formatDate(r.end)} (${r.days} days)`;
                        return (
                            <div key={r.start} className="alert alert-info">
                                <div>
                                    <strong>Out of office {label}.</strong>{" "}
                                    {r.conflicts.length === 0
                                        ? "No desks will be auto-booked for you in this period."
                                        : `No auto-bookings, but you still have ${r.conflicts.length} manual booking${r.conflicts.length === 1 ? "" : "s"} in this period — cancel below if you don't need ${r.conflicts.length === 1 ? "it" : "them"}.`}
                                </div>
                                <button
                                    type="button"
                                    className="link-btn"
                                    onClick={() => cancelOoo(r.start, r.end)}
                                >
                                    Cancel out-of-office
                                </button>
                            </div>
                        );
                    })}
                </section>
            )}

            {unread.length > 0 && (
                <section className="alert-stack">
                    {unread.map(n => {
                        if (n.kind === "trade") {
                            return (
                                <TradeRequestAlert
                                    key={n.id}
                                    notification={n}
                                    relativeTime={formatNotificationTime(n.createdAt)}
                                    onResolved={load}
                                />
                            );
                        }
                        const titleByKind: Record<string, string> = {
                            "trade-accepted": "Swap accepted",
                            "trade-declined": "Swap declined",
                        };
                        const title = titleByKind[n.kind];
                        return (
                            <div key={n.id} className={`alert alert-${n.kind}`}>
                                <div className="alert-body">
                                    {title && <span className="alert-title">{title}</span>}
                                    <span>{n.message}</span>
                                </div>
                                <button className="link-btn" onClick={() => dismiss(n.id)}>Dismiss</button>
                            </div>
                        );
                    })}
                </section>
            )}

            <section className="carousel-section">
                <header className="carousel-section-head">
                    <div>
                        <h2>Your upcoming bookings</h2>
                        <p className="muted">
                            Tap the floor map to expand it — pan and zoom to explore the building.
                        </p>
                    </div>
                </header>
                {loading ? (
                    <div className="carousel-empty"><p className="muted">Loading…</p></div>
                ) : (
                    <BookingsCarousel
                        bookings={upcoming}
                        currentUserId={user.id}
                        onCancel={cancel}
                    />
                )}
            </section>
        </div>
    );
}
