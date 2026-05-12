import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import MiniFloorPlan from "./MiniFloorPlan";
import FullFloorMapModal from "./FullFloorMapModal";
import { ACCESSIBILITY_LABELS } from "./AccessibilityIcon";
import type { Booking } from "../types";
import { api } from "../api";

const REGION_LABEL: Record<string, string> = {
    N: "North Workstations",
    S: "South Workstations",
    E: "East Workstations",
    W: "West Workstations",
    NW: "Lounge Area",
    NE: "Collaborative Zone",
    SW: "Casual Seating",
    SE: "Huddle Area",
    INNER: "Inner Workstations",
};

function formatDate(iso: string) {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
    });
}

function relativeLabel(iso: string): string | null {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(iso + "T00:00:00");
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays > 1 && diffDays < 7) return `In ${diffDays} days`;
    return null;
}

function isToday(iso: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(iso + "T00:00:00");
    return target.getTime() === today.getTime();
}

interface Props {
    bookings: Booking[];
    currentUserId: number;
    onCancel: (id: number) => void;
}

// Cards beyond this offset stay mounted but fully transparent, so navigating
// to them never triggers a fresh MiniFloorPlan mount mid-animation.
const VISIBLE_NEIGHBOURS = 2;

export default function BookingsCarousel({ bookings, currentUserId, onCancel }: Props) {
    const [index, setIndex] = useState(0);
    const [expanded, setExpanded] = useState<Booking | null>(null);
    const [checkedInAt, setCheckedInAt] = useState<string | null>(null);
    const [checkingIn, setCheckingIn] = useState(false);
    const wheelLockRef = useRef(0);
    const stageRef = useRef<HTMLDivElement>(null);

    // Load today's check-in status once so the button shows the right state.
    useEffect(() => {
        let cancelled = false;
        api.checkInStatus(currentUserId)
            .then(s => { if (!cancelled) setCheckedInAt(s.arrivedAt); })
            .catch(() => { /* non-fatal */ });
        return () => { cancelled = true; };
    }, [currentUserId]);

    const handleCheckIn = async () => {
        setCheckingIn(true);
        try {
            const res = await api.checkIn(currentUserId);
            setCheckedInAt(res.arrivedAt);
        } catch (e) {
            window.alert(`Couldn't check in: ${(e as Error).message}`);
        } finally {
            setCheckingIn(false);
        }
    };

    useEffect(() => {
        if (index > bookings.length - 1) {
            setIndex(Math.max(0, bookings.length - 1));
        }
    }, [bookings.length, index]);

    const total = bookings.length;
    const safeIndex = Math.min(index, Math.max(0, total - 1));

    const go = (delta: number) => {
        setIndex(i => Math.max(0, Math.min(total - 1, i + delta)));
    };

    // Keyboard navigation when the stage has focus or the user just clicked it.
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
        };
        stage.addEventListener("keydown", handler);
        return () => stage.removeEventListener("keydown", handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [total]);

    if (bookings.length === 0) {
        return (
            <div className="carousel-empty">
                <p>You have no upcoming bookings.</p>
                <Link className="primary-btn" to="/floors">Book a desk</Link>
            </div>
        );
    }

    // Throttle wheel events so a single trackpad flick doesn't skip many cards.
    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (Math.abs(delta) < 8) return;
        const now = performance.now();
        if (now - wheelLockRef.current < 220) return;
        wheelLockRef.current = now;
        go(delta > 0 ? 1 : -1);
    };

    return (
        <div className="booking-carousel">
            <div
                className="booking-carousel-stage"
                ref={stageRef}
                tabIndex={0}
                role="region"
                aria-roledescription="carousel"
                aria-label="Upcoming bookings"
                onWheel={handleWheel}
            >
                <button
                    type="button"
                    className="carousel-arrow left"
                    onClick={() => go(-1)}
                    disabled={safeIndex === 0}
                    aria-label="Previous booking"
                >
                    ‹
                </button>

                <div className="booking-carousel-track">
                    {bookings.map((b, i) => {
                        const offset = i - safeIndex;
                        const abs = Math.abs(offset);
                        const isCurrent = offset === 0;
                        const offscreen = abs > VISIBLE_NEIGHBOURS;
                        const relative = relativeLabel(b.date);
                        const regionLabel = REGION_LABEL[b.desk.region] ?? b.desk.region;
                        const slideStyle = {
                            "--offset": offset,
                            "--abs-offset": abs,
                        } as React.CSSProperties;
                        const cls = isCurrent
                            ? "booking-slide current"
                            : `booking-slide adjacent${offscreen ? " offscreen" : ""}`;
                        return (
                            <div
                                key={b.id}
                                className={cls}
                                style={slideStyle}
                                data-offset={offset}
                                aria-hidden={!isCurrent}
                                onClick={isCurrent || offscreen ? undefined : () => setIndex(i)}
                            >
                                <MiniFloorPlan
                                    floor={b.desk.floor}
                                    date={b.date}
                                    deskId={b.desk.id}
                                    currentUserId={currentUserId}
                                    onClick={isCurrent ? () => setExpanded(b) : undefined}
                                />
                                <div className="booking-slide-info">
                                    <div className="booking-slide-tags">
                                        {relative && <span className="tag tag-relative">{relative}</span>}
                                        <span className={`tag tag-${b.kind.toLowerCase()}`}>
                                            {b.isAutoBooked ? "Auto · " : ""}{b.kind}
                                        </span>
                                        {b.desk.accessibilityType && (
                                            <span className="tag tag-a11y">
                                                {ACCESSIBILITY_LABELS[b.desk.accessibilityType]}
                                            </span>
                                        )}
                                    </div>
                                    <h2 className="booking-slide-desk">Desk {b.desk.number}</h2>
                                    <p className="booking-slide-date">{formatDate(b.date)}</p>
                                    <p className="booking-slide-region muted">
                                        Floor {b.desk.floor} · {regionLabel}
                                    </p>
                                    <div className="booking-slide-actions">
                                        {isToday(b.date) && (
                                            checkedInAt ? (
                                                <span className="tag tag-checked-in" aria-live="polite">
                                                    Checked in · {checkedInAt}
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="primary-btn"
                                                    disabled={checkingIn}
                                                    onClick={e => { e.stopPropagation(); handleCheckIn(); }}
                                                    tabIndex={isCurrent ? 0 : -1}
                                                >
                                                    {checkingIn ? "Checking in…" : "Check in"}
                                                </button>
                                            )
                                        )}
                                        <button
                                            type="button"
                                            className="ghost-btn"
                                            onClick={e => { e.stopPropagation(); setExpanded(b); }}
                                            tabIndex={isCurrent ? 0 : -1}
                                        >
                                            View full map
                                        </button>
                                        <button
                                            type="button"
                                            className="ghost-btn danger"
                                            onClick={e => { e.stopPropagation(); onCancel(b.id); }}
                                            tabIndex={isCurrent ? 0 : -1}
                                        >
                                            Cancel booking
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <button
                    type="button"
                    className="carousel-arrow right"
                    onClick={() => go(1)}
                    disabled={safeIndex === bookings.length - 1}
                    aria-label="Next booking"
                >
                    ›
                </button>
            </div>

            {bookings.length > 1 && (
                <div className="booking-carousel-dots" role="tablist">
                    {bookings.map((b, i) => (
                        <button
                            key={b.id}
                            type="button"
                            role="tab"
                            aria-selected={i === safeIndex}
                            className={`carousel-dot${i === safeIndex ? " active" : ""}`}
                            onClick={() => setIndex(i)}
                            aria-label={`Booking ${i + 1} of ${bookings.length}`}
                        />
                    ))}
                </div>
            )}

            {expanded && (
                <FullFloorMapModal
                    floor={expanded.desk.floor}
                    date={expanded.date}
                    focusDeskId={expanded.desk.id}
                    currentUserId={currentUserId}
                    onClose={() => setExpanded(null)}
                />
            )}
        </div>
    );
}
