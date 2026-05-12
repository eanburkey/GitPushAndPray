import { useEffect, useRef, useState } from "react";
import type { AutoCheckoutSuggestion, User } from "../types";
import { api } from "../api";
import { useAuth } from "../auth";
import { ACCESSIBILITY_GLYPHS, ACCESSIBILITY_LABELS } from "./AccessibilityIcon";
import HolidaysModal from "./HolidaysModal";

const MAX_AUTO_CHECKOUT = "10:30";

function clampToMax(time: string): string {
    if (!time) return time;
    return time > MAX_AUTO_CHECKOUT ? MAX_AUTO_CHECKOUT : time;
}

interface Props {
    user: User;
    onSignOut: () => void;
}

function initialsOf(name: string) {
    const parts = name.split(" ").filter(Boolean);
    return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

export default function AccountMenu({ user, onSignOut }: Props) {
    const { updateUser } = useAuth();
    const [open, setOpen] = useState(false);
    const [holidaysOpen, setHolidaysOpen] = useState(false);
    const [savingAutoBook, setSavingAutoBook] = useState(false);
    const [savingCheckout, setSavingCheckout] = useState(false);
    const [suggestion, setSuggestion] = useState<AutoCheckoutSuggestion | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const initials = user.initials || initialsOf(user.name);
    const needs = user.accessibilityNeeds ?? [];
    const autoBookingEnabled = user.isAutoBookingEnabled ?? true;
    // Defensive fallback only — the server always projects a value. Auto-checkout
    // can't be disabled by the user; the only knob is the time itself.
    const autoCheckoutTime = user.autoCheckoutTime ?? MAX_AUTO_CHECKOUT;

    // Fetch the suggested time when the menu opens. Cheap, scoped to one user,
    // and only shows up while the panel is visible — no need to refresh after.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        api.autoCheckoutSuggestion(user.id)
            .then(s => { if (!cancelled) setSuggestion(s); })
            .catch(() => { if (!cancelled) setSuggestion(null); });
        return () => { cancelled = true; };
    }, [open, user.id]);

    const updateCheckoutTime = async (next: string) => {
        const previous = autoCheckoutTime;
        setSavingCheckout(true);
        updateUser({ autoCheckoutTime: next });
        try {
            await api.setAutoCheckoutTime(user.id, next);
        } catch (e) {
            updateUser({ autoCheckoutTime: previous });
            window.alert(`Couldn't update auto-checkout: ${(e as Error).message}`);
        } finally {
            setSavingCheckout(false);
        }
    };

    const onTimeChange = (raw: string) => {
        if (!raw) return;
        updateCheckoutTime(clampToMax(raw));
    };

    const applySuggestion = () => {
        if (suggestion?.suggestedTime) updateCheckoutTime(suggestion.suggestedTime);
    };

    const toggleAutoBooking = async () => {
        const next = !autoBookingEnabled;
        setSavingAutoBook(true);
        // Optimistic update — revert on failure.
        updateUser({ isAutoBookingEnabled: next });
        try {
            await api.setAutoBookingEnabled(user.id, next);
        } catch (e) {
            updateUser({ isAutoBookingEnabled: !next });
            window.alert(`Couldn't update auto-booking preference: ${(e as Error).message}`);
        } finally {
            setSavingAutoBook(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", handler);
        document.addEventListener("keydown", esc);
        return () => {
            document.removeEventListener("mousedown", handler);
            document.removeEventListener("keydown", esc);
        };
    }, [open]);

    return (
        <div className="account-menu-wrap" ref={wrapRef}>
            <button
                type="button"
                className="account-button"
                aria-expanded={open}
                aria-haspopup="menu"
                onClick={() => setOpen(o => !o)}
            >
                <span className="account-avatar">{initials}</span>
                <span className="account-meta">
                    <span className="account-name">{user.name}</span>
                    {user.teamName && <span className="account-team">{user.teamName}</span>}
                </span>
            </button>

            {open && (
                <div className="account-menu" role="menu">
                    <header className="account-menu-head">
                        <span className="account-avatar">{initials}</span>
                        <div>
                            <div style={{ fontWeight: 700 }}>{user.name}</div>
                            <div className="muted" style={{ fontSize: 12 }}>{user.email}</div>
                            {user.teamName && (
                                <div className="muted" style={{ fontSize: 12 }}>{user.teamName}</div>
                            )}
                        </div>
                    </header>

                    <div className="account-menu-needs">
                        <span className="section-label">Accessibility needs</span>
                        {needs.length === 0 ? (
                            <div className="muted" style={{ fontSize: 12 }}>
                                No accessibility requirements on file. Speak to your office admin if this is wrong.
                            </div>
                        ) : (
                            <div className="account-menu-needs-list">
                                {needs.map(n => (
                                    <span key={n} className="multi-need-chip">
                                        <span aria-hidden>{ACCESSIBILITY_GLYPHS[n]}</span>
                                        {ACCESSIBILITY_LABELS[n]}
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className="muted" style={{ fontSize: 11 }}>
                            Synced from Workday hourly. The auto-booker uses these to choose your desk.
                        </div>
                    </div>

                    <div className="account-menu-needs">
                        <span className="section-label">Auto-booking</span>
                        <label className="toggle-row">
                            <input
                                type="checkbox"
                                checked={autoBookingEnabled}
                                disabled={savingAutoBook}
                                onChange={toggleAutoBooking}
                            />
                            <span className="toggle-switch" aria-hidden />
                            <span>Auto-book me on team days</span>
                        </label>
                        <div className="muted" style={{ fontSize: 11 }}>
                            {autoBookingEnabled
                                ? "Desks are reserved for you automatically on your team's mandatory days. Use out-of-office for short absences."
                                : "You won't be auto-booked on any day. Book desks manually when you plan to come in."}
                        </div>
                    </div>

                    <div className="account-menu-needs">
                        <span className="section-label">Auto check-out</span>
                        <div className="auto-checkout-row">
                            <label htmlFor="auto-checkout-time-input">Release my desk if I haven't arrived by</label>
                            <input
                                id="auto-checkout-time-input"
                                type="time"
                                value={autoCheckoutTime}
                                max={MAX_AUTO_CHECKOUT}
                                step={300}
                                disabled={savingCheckout}
                                onChange={e => onTimeChange(e.target.value)}
                                aria-label="Auto check-out time"
                            />
                        </div>
                        <div className="muted" style={{ fontSize: 11 }}>
                            Latest allowed: {MAX_AUTO_CHECKOUT}. Auto check-out is always on so an idle desk goes back to the pool.
                        </div>
                        {suggestion && suggestion.suggestedTime && (
                            <div className="muted" style={{ fontSize: 11 }}>
                                Based on your last {suggestion.sampleSize} check-ins you usually arrive around{" "}
                                <strong>{suggestion.typicalArrivalTime}</strong>. Suggested cutoff:{" "}
                                <button
                                    type="button"
                                    className="link-btn"
                                    onClick={applySuggestion}
                                    disabled={savingCheckout || autoCheckoutTime === suggestion.suggestedTime}
                                >
                                    {suggestion.suggestedTime}
                                </button>
                            </div>
                        )}
                        {suggestion && !suggestion.suggestedTime && (
                            <div className="muted" style={{ fontSize: 11 }}>
                                Not enough check-in history yet to suggest a time. We'll start learning once you check in.
                            </div>
                        )}
                    </div>

                    <div className="account-menu-actions">
                        <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => { setOpen(false); setHolidaysOpen(true); }}
                        >
                            My holidays
                        </button>
                        <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => { setOpen(false); onSignOut(); }}
                        >
                            Sign out
                        </button>
                    </div>
                </div>
            )}

            {holidaysOpen && (
                <HolidaysModal userId={user.id} onClose={() => setHolidaysOpen(false)} />
            )}
        </div>
    );
}
