import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { HubConnectionBuilder, HubConnectionState, LogLevel } from "@microsoft/signalr";
import type { HubConnection } from "@microsoft/signalr";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Notification } from "./types";

interface NotificationsContextValue {
    notifications: Notification[];
    unread: Notification[];
    loading: boolean;
    refresh: () => Promise<void>;
    markRead: (id: number) => Promise<void>;
    respondSwap: (id: number, accept: boolean) =>
        Promise<{ ok: boolean; accepted: boolean; swapped: boolean | null }>;
    // Counter that bumps whenever something happens that may have moved this user's
    // bookings around (a swap was accepted, an auto-booker displaced them, …).
    // Pages that show booking state subscribe to this and re-fetch on change.
    bookingsChangedAt: number;
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

// SignalR is the primary delivery path. Polling stays as a fallback in case the
// hub is down, the client lost connectivity between reconnect attempts, or a
// proxy strips WebSockets — so it runs less frequently than before.
const POLL_INTERVAL_MS = 120_000;

// Notification kinds that mean "your bookings may have changed" — used to decide
// whether a freshly-polled notification should trigger a refresh on pages that
// show booking state.
const BOOKING_INVALIDATING_KINDS = new Set(["trade-accepted", "displaced"]);

export function NotificationsProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(false);
    const [bookingsChangedAt, setBookingsChangedAt] = useState(0);
    const userIdRef = useRef<number | null>(null);
    // Tracks notification IDs we've already seen so we can spot newly-arrived
    // booking-changing notifications across polls. Null = haven't done the
    // baseline load yet, so the first list shouldn't fire invalidations for
    // notifications that were already there before the session started.
    const seenIdsRef = useRef<Set<number> | null>(null);

    const refresh = useCallback(async () => {
        const uid = userIdRef.current;
        if (!uid) return;
        const list = await api.notifications(uid);
        // The user could have switched accounts mid-flight; guard against
        // writing stale data into state.
        if (userIdRef.current !== uid) return;

        const previouslySeen = seenIdsRef.current;
        if (previouslySeen === null) {
            seenIdsRef.current = new Set(list.map(n => n.id));
        } else {
            let invalidated = false;
            for (const n of list) {
                if (!previouslySeen.has(n.id) && BOOKING_INVALIDATING_KINDS.has(n.kind)) {
                    invalidated = true;
                    break;
                }
            }
            seenIdsRef.current = new Set(list.map(n => n.id));
            if (invalidated) setBookingsChangedAt(t => t + 1);
        }
        setNotifications(list);
    }, []);

    const markRead = useCallback(async (id: number) => {
        const uid = userIdRef.current;
        if (!uid) return;
        // Optimistic update so the badge drops immediately even before the round-trip.
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        try {
            await api.markRead(uid, id);
        } catch {
            await refresh();
        }
    }, [refresh]);

    // Apply a single pushed notification to local state. Used by the SignalR
    // hub listener; bypasses the full /api/notifications round-trip.
    const handlePushed = useCallback((incoming: Notification) => {
        if (!incoming || typeof incoming.id !== "number") return;
        // The user could have logged out between the server-side push and this
        // callback running — drop pushes that aren't for the active user.
        if (userIdRef.current !== incoming.userId) return;

        setNotifications(prev => {
            // If a poll already brought this notification in, don't duplicate.
            if (prev.some(p => p.id === incoming.id)) return prev;
            return [incoming, ...prev];
        });

        const seen = seenIdsRef.current;
        if (seen !== null && !seen.has(incoming.id)) {
            seen.add(incoming.id);
            if (BOOKING_INVALIDATING_KINDS.has(incoming.kind)) {
                setBookingsChangedAt(t => t + 1);
            }
        }
    }, []);

    const respondSwap = useCallback(async (id: number, accept: boolean) => {
        const uid = userIdRef.current;
        if (!uid) throw new Error("Not signed in.");
        // Optimistically mark the trade notification read so the banner disappears
        // and the badge drops. If the server rejects, we'll roll forward by
        // refreshing from the source of truth.
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        try {
            const result = await api.respondSwap(uid, id, accept);
            if (accept) {
                // The responder's own bookings just changed — invalidate so their
                // open dashboard/floor map refresh immediately. The requester finds
                // out via the trade-accepted notification on their next poll.
                setBookingsChangedAt(t => t + 1);
            }
            refresh().catch(() => {});
            return result;
        } catch (e) {
            await refresh();
            throw e;
        }
    }, [refresh]);

    useEffect(() => {
        userIdRef.current = user?.id ?? null;
        // Reset the dedupe set whenever the user changes so the new user's first
        // poll establishes its own baseline (we don't want to fire invalidations
        // for notifications that arrived in a previous session).
        seenIdsRef.current = null;
        if (!user) {
            setNotifications([]);
            return;
        }
        let cancelled = false;
        setLoading(true);
        (async () => {
            try { await refresh(); } finally { if (!cancelled) setLoading(false); }
        })();

        // Open the SignalR hub connection. The server pushes to a "user-{id}"
        // group based on the userId query param. Auto-reconnect handles transient
        // drops; on each (re)connect we re-fetch to close any gap.
        const conn: HubConnection = new HubConnectionBuilder()
            .withUrl(`/hubs/notifications?userId=${user.id}`)
            .withAutomaticReconnect()
            .configureLogging(LogLevel.Warning)
            .build();
        conn.on("notification", handlePushed);
        conn.onreconnected(() => { refresh().catch(() => {}); });
        conn.start().catch(err => {
            // Hub failure isn't fatal — polling will keep notifications flowing.
            // eslint-disable-next-line no-console
            console.warn("SignalR connection failed; falling back to polling.", err);
        });

        const id = window.setInterval(() => { refresh().catch(() => {}); }, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(id);
            if (conn.state !== HubConnectionState.Disconnected) {
                conn.stop().catch(() => {});
            }
        };
    }, [user, refresh, handlePushed]);

    const unread = useMemo(() => notifications.filter(n => !n.isRead), [notifications]);

    const value = useMemo(
        () => ({ notifications, unread, loading, refresh, markRead, respondSwap, bookingsChangedAt }),
        [notifications, unread, loading, refresh, markRead, respondSwap, bookingsChangedAt],
    );

    return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
    const ctx = useContext(NotificationsContext);
    if (!ctx) throw new Error("useNotifications must be used inside NotificationsProvider");
    return ctx;
}
