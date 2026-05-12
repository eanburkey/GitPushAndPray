import { useEffect } from "react";
import type { FloorDesk } from "../types";
import type { Role } from "../types";
import { ACCESSIBILITY_COLOR, ACCESSIBILITY_GLYPHS, ACCESSIBILITY_LABELS } from "./AccessibilityIcon";

interface Props {
    desk: FloorDesk;
    date: string;
    onClose: () => void;
    onBook: () => void;
    busy: boolean;
    bookingDisabled: boolean;
    bookingDisabledReason?: string;
    message: string | null;
    currentUserId?: number;
    currentUserRole?: Role;
    onRequestSwap: () => void;
    swapBusy: boolean;
    swapMessage: string | null;
    onToggleBookable?: (isBookable: boolean) => void;
    toggleBookableBusy?: boolean;
}

export default function DeskDetailModal({
    desk,
    date,
    onClose,
    onBook,
    busy,
    bookingDisabled,
    bookingDisabledReason,
    message,
    currentUserId,
    currentUserRole,
    onRequestSwap,
    swapBusy,
    swapMessage,
    onToggleBookable,
    toggleBookableBusy,
}: Props) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    const stop = (e: React.MouseEvent) => e.stopPropagation();

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div
                className="modal-card"
                onClick={stop}
                role="dialog"
                aria-modal="true"
                aria-labelledby="desk-modal-title"
            >
                <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
                {desk.booked && desk.bookedBy
                    ? <BookedView
                        desk={desk}
                        date={date}
                        currentUserId={currentUserId}
                        currentUserRole={currentUserRole}
                        onRequestSwap={onRequestSwap}
                        swapBusy={swapBusy}
                        swapMessage={swapMessage}
                        onToggleBookable={onToggleBookable}
                        toggleBookableBusy={toggleBookableBusy}
                    />
                    : <AvailableView
                        desk={desk}
                        date={date}
                        onBook={onBook}
                        busy={busy}
                        bookingDisabled={bookingDisabled}
                        bookingDisabledReason={bookingDisabledReason}
                        message={message}
                        currentUserRole={currentUserRole}
                        onToggleBookable={onToggleBookable}
                        toggleBookableBusy={toggleBookableBusy}
                    />}
            </div>
        </div>
    );
}

interface BookedViewProps {
    desk: FloorDesk;
    date: string;
    currentUserId?: number;
    currentUserRole?: Role;
    onRequestSwap: () => void;
    swapBusy: boolean;
    swapMessage: string | null;
    onToggleBookable?: (isBookable: boolean) => void;
    toggleBookableBusy?: boolean;
}

function BookedView({ desk, date, currentUserId, currentUserRole, onRequestSwap, swapBusy, swapMessage, onToggleBookable, toggleBookableBusy }: BookedViewProps) {
    const b = desk.bookedBy!;
    const isMine = currentUserId !== undefined && b.userId === currentUserId;
    const isManager = currentUserRole === "Admin";
    return (
        <>
            <header className="user-card-head">
                <div className="avatar large" style={{ background: b.teamColor }}>{b.initials}</div>
                <div>
                    <h2 id="desk-modal-title" style={{ margin: 0 }}>{b.name}</h2>
                    <div className="team-pill" style={{ color: b.teamColor, borderColor: b.teamColor }}>
                        {b.teamName}
                    </div>
                </div>
            </header>
            <div className="kv"><span>Email</span><strong>{b.email}</strong></div>
            <div className="kv"><span>Desk</span><strong>Floor {desk.floor} · Desk {desk.number}</strong></div>
            <div className="kv"><span>Date</span><strong>{date}</strong></div>
            <div className="kv"><span>Booking type</span>
                <strong className={`tag tag-${b.kind.toLowerCase()}`}>
                    {b.isAutoBooked ? "Auto-booked · " : ""}{b.kind}
                </strong>
            </div>
            {desk.accessibilityType && <AccessibilityRow type={desk.accessibilityType} />}
            {isMine ? (
                <div className="hint">This is your booking.</div>
            ) : (
                <>
                    <button
                        className="primary-btn full"
                        disabled={swapBusy}
                        onClick={onRequestSwap}
                    >
                        {swapBusy ? "Sending request…" : "Request swap"}
                    </button>
                    {swapMessage && <div className="hint">{swapMessage}</div>}
                </>
            )}
            {isManager && onToggleBookable && (
                <BookableToggle desk={desk} onToggle={onToggleBookable} busy={toggleBookableBusy ?? false} />
            )}
        </>
    );
}

interface AvailableViewProps {
    desk: FloorDesk;
    date: string;
    onBook: () => void;
    busy: boolean;
    bookingDisabled: boolean;
    bookingDisabledReason?: string;
    message: string | null;
    currentUserRole?: Role;
    onToggleBookable?: (isBookable: boolean) => void;
    toggleBookableBusy?: boolean;
}

function AvailableView({
    desk,
    date,
    onBook,
    busy,
    bookingDisabled,
    bookingDisabledReason,
    message,
    currentUserRole,
    onToggleBookable,
    toggleBookableBusy,
}: AvailableViewProps) {
    const isManager = currentUserRole === "Admin";
    return (
        <>
            <h2 id="desk-modal-title" style={{ marginTop: 0 }}>Desk {desk.number}</h2>
            <div className="kv"><span>Floor</span><strong>{desk.floor}</strong></div>
            <div className="kv"><span>Region</span><strong>{regionLabel(desk.region)}</strong></div>
            <div className="kv"><span>Date</span><strong>{date}</strong></div>
            <div className="kv">
                <span>Status</span>
                <strong className={`tag tag-${desk.isBookable ? "available" : "not-bookable"}`}>
                    {desk.isBookable ? "Available" : "Not bookable"}
                </strong>
            </div>
            {desk.accessibilityType && <AccessibilityRow type={desk.accessibilityType} />}
            {desk.isBookable && (
                <button
                    className="primary-btn full"
                    disabled={busy || bookingDisabled}
                    onClick={onBook}
                >
                    {busy ? "Booking…" : "Book this desk"}
                </button>
            )}
            {bookingDisabled && bookingDisabledReason && (
                <div className="hint">{bookingDisabledReason}</div>
            )}
            {message && <div className="hint">{message}</div>}
            {isManager && onToggleBookable && (
                <BookableToggle desk={desk} onToggle={onToggleBookable} busy={toggleBookableBusy ?? false} />
            )}
        </>
    );
}

function BookableToggle({ desk, onToggle, busy }: { desk: FloorDesk; onToggle: (v: boolean) => void; busy: boolean }) {
    return (
        <div className="bookable-toggle">
            <span>Manager controls</span>
            <button
                className={`ghost-btn ${desk.isBookable ? "danger" : "success"}`}
                disabled={busy}
                onClick={() => onToggle(!desk.isBookable)}
            >
                {busy ? "Saving…" : desk.isBookable ? "Mark as not bookable" : "Mark as bookable"}
            </button>
        </div>
    );
}

function AccessibilityRow({ type }: { type: NonNullable<FloorDesk["accessibilityType"]> }) {
    return (
        <div className="kv">
            <span>Accessibility</span>
            <strong style={{ display: "inline-flex", alignItems: "center", gap: 6, color: ACCESSIBILITY_COLOR }}>
                <span aria-hidden>{ACCESSIBILITY_GLYPHS[type]}</span>
                {ACCESSIBILITY_LABELS[type]}
            </strong>
        </div>
    );
}

function regionLabel(code: string): string {
    switch (code) {
        case "N": return "North Workstations";
        case "S": return "South Workstations";
        case "E": return "East Workstations";
        case "W": return "West Workstations";
        case "NW": return "Lounge Area";
        case "NE": return "Collaborative Zone";
        case "SW": return "Casual Seating";
        case "SE": return "Huddle Area";
        case "INNER": return "Inner Workstations";
        default: return code;
    }
}
