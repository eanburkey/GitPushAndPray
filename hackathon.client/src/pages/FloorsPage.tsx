import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useNotifications } from "../notifications";
import DateBar from "../components/DateBar";
import FloorPlan from "../components/FloorPlan";
import DeskDetailModal from "../components/DeskDetailModal";
import TeamsSidebar from "../components/TeamsSidebar";
import UserSearch from "../components/UserSearch";
import FloorAnnouncementModal from "../components/FloorAnnouncementModal";
import type { SidebarSelection } from "../components/TeamsSidebar";
import type { ActiveVirtualTeam, Booking, FloorDesk, FloorSummary, Team, TeamDesk, User } from "../types";

const FAV_TEAMS_KEY = (userId: number) => `intelliDesk.favTeams.${userId}`;

function loadFavourites(userId: number): number[] {
    try {
        const raw = localStorage.getItem(FAV_TEAMS_KEY(userId));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((n: unknown) => typeof n === "number") : [];
    } catch {
        return [];
    }
}

function saveFavourites(userId: number, ids: number[]) {
    try {
        localStorage.setItem(FAV_TEAMS_KEY(userId), JSON.stringify(ids));
    } catch {
        // ignore
    }
}

export default function FloorsPage() {
    const { user } = useAuth();
    const { refresh: refreshNotifications, bookingsChangedAt } = useNotifications();
    const today = new Date().toISOString().slice(0, 10);
    // See DashboardPage — ref so the auto-reload effect only fires on changes,
    // not on initial mount when the tick may already be non-zero.
    const lastInvalidationRef = useRef(bookingsChangedAt);
    const [date, setDate] = useState(today);
    const [floors, setFloors] = useState<FloorSummary[]>([]);
    const [selectedFloor, setSelectedFloor] = useState<number>(3);
    const [desks, setDesks] = useState<FloorDesk[]>([]);
    const [selected, setSelected] = useState<FloorDesk | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const [swapBusy, setSwapBusy] = useState(false);
    const [swapMessage, setSwapMessage] = useState<string | null>(null);
    const [toggleBookableBusy, setToggleBookableBusy] = useState(false);

    const [teamsOpen, setTeamsOpen] = useState(false);
    const [teams, setTeams] = useState<Team[]>([]);
    const [virtualTeams, setVirtualTeams] = useState<ActiveVirtualTeam[]>([]);
    const [favouriteIds, setFavouriteIds] = useState<number[]>([]);
    const [highlight, setHighlight] = useState<SidebarSelection | null>(null);
    const [teamDesks, setTeamDesks] = useState<TeamDesk[]>([]);
    const [inOfficeTeamIds, setInOfficeTeamIds] = useState<Set<number>>(new Set());

    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [userSearchResult, setUserSearchResult] = useState<
        { user: User; booking: Booking | null } | null
    >(null);

    const [announceFloor, setAnnounceFloor] = useState<number | null>(null);
    const canAnnounce = user?.role === "Admin" || user?.role === "TeamManager";

    const highlightedTeam = highlight?.kind === "team" ? highlight.team : null;
    const highlightedVirtual = highlight?.kind === "virtual" ? highlight.team : null;
    const highlightName = highlight?.team.name ?? null;
    const teamHighlightColor = highlight?.team.color ?? undefined;

    useEffect(() => {
        api.listFloors().then(setFloors);
        api.listTeams().then(setTeams);
        api.allUsers().then(setAllUsers).catch(() => setAllUsers([]));
    }, []);

    useEffect(() => {
        if (user) setFavouriteIds(loadFavourites(user.id));
    }, [user]);

    const loadDesks = async () => {
        const data = await api.floorDesks(selectedFloor, date);
        setDesks(data);
        setSelected(prev => prev ? data.find(d => d.id === prev.id) ?? null : null);
    };

    useEffect(() => {
        loadDesks();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFloor, date]);

    // Auto-refresh the floor map when a swap accept (or other booking-changing
    // event) lands. Picks up changes for both the responder (who triggered it) and
    // the requester (who notices it via polling).
    useEffect(() => {
        if (bookingsChangedAt !== lastInvalidationRef.current) {
            lastInvalidationRef.current = bookingsChangedAt;
            loadDesks();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookingsChangedAt]);

    useEffect(() => {
        api.teamsWithBookings(date).then(ids => setInOfficeTeamIds(new Set(ids)));
        api.activeVirtualTeams(date).then(setVirtualTeams).catch(() => setVirtualTeams([]));
    }, [date]);

    // Reload the highlighted team's desks when the date changes.
    useEffect(() => {
        if (!highlight) {
            setTeamDesks([]);
            return;
        }
        const fetcher = highlight.kind === "team"
            ? api.teamDesks(highlight.team.id, date)
            : api.virtualTeamDesks(highlight.team.id, date);
        fetcher.then(setTeamDesks);
    }, [highlight, date]);

    const stats = useMemo(() => {
        const total = desks.length;
        const booked = desks.filter(d => d.booked).length;
        return { total, booked, free: total - booked };
    }, [desks]);

    const book = async () => {
        if (!user || !selected) return;
        setBusy(true);
        setMessage(null);
        try {
            const r = await api.bookDesk(user.id, selected.id, date);
            setMessage(r.warning ?? `Booked Desk ${selected.number} on Floor ${selected.floor}.`);
            await loadDesks();
        } catch (e) {
            setMessage((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const requestSwap = async () => {
        if (!user || !selected || !selected.bookedBy) return;
        setSwapBusy(true);
        setSwapMessage(null);
        try {
            const result = await api.requestSwap(user.id, selected.bookedBy.userId, selected.id, date);
            if (result.alreadySent) {
                setSwapMessage(`You've already sent ${selected.bookedBy.name} a swap request for this desk.`);
            } else {
                setSwapMessage(`Notification sent to ${selected.bookedBy.name}.`);
            }
            // Keep the requester's own notifications fresh — harmless here, and
            // important if we later add a 'request acknowledged' kind on this side.
            refreshNotifications().catch(() => {});
        } catch (e) {
            setSwapMessage((e as Error).message);
        } finally {
            setSwapBusy(false);
        }
    };

    // Clear the swap message whenever the user selects a different desk.
    useEffect(() => {
        setSwapMessage(null);
    }, [selected?.id]);

    const toggleFavourite = (teamId: number) => {
        if (!user) return;
        const next = favouriteIds.includes(teamId)
            ? favouriteIds.filter(id => id !== teamId)
            : [...favouriteIds, teamId];
        setFavouriteIds(next);
        saveFavourites(user.id, next);
    };

    const selectFromSidebar = async (selection: SidebarSelection) => {
        setHighlight(selection);
        setUserSearchResult(null);
        const desks = selection.kind === "team"
            ? await api.teamDesks(selection.team.id, date)
            : await api.virtualTeamDesks(selection.team.id, date);
        setTeamDesks(desks);
        // Jump to the floor where the team has the most desks on this date.
        if (desks.length > 0) {
            const counts = new Map<number, number>();
            for (const d of desks) counts.set(d.floor, (counts.get(d.floor) ?? 0) + 1);
            const topFloor = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
            if (topFloor !== selectedFloor) setSelectedFloor(topFloor);
        } else if (selection.team.homeFloor && selection.team.homeFloor !== selectedFloor) {
            setSelectedFloor(selection.team.homeFloor);
        }
    };

    const clearHighlight = () => {
        setHighlight(null);
        setTeamDesks([]);
    };

    const locateUser = async (target: User) => {
        // Find-a-person and team-highlight are alternate lenses; only one should be active.
        setHighlight(null);
        setTeamDesks([]);
        try {
            const bookings = await api.myBookings(target.id);
            const found = bookings.find(b => b.date === date) ?? null;
            setUserSearchResult({ user: target, booking: found });
            if (found && found.desk.floor !== selectedFloor) {
                setSelectedFloor(found.desk.floor);
            }
        } catch {
            setUserSearchResult({ user: target, booking: null });
        }
    };

    const clearUserSearch = () => setUserSearchResult(null);

    // The result is pinned to a specific date — drop it when the date changes so
    // it can't claim a desk that no longer reflects the displayed day.
    const handleDateChange = (next: string) => {
        setDate(next);
        setUserSearchResult(null);
    };

    const toggleBookable = async (isBookable: boolean) => {
        if (!user || !selected) return;
        setToggleBookableBusy(true);
        try {
            await api.setDeskBookable(user.id, selected.id, isBookable);
            await loadDesks();
        } catch (e) {
            setMessage((e as Error).message);
        } finally {
            setToggleBookableBusy(false);
        }
    };

    const highlightedDeskIds = useMemo(() => {
        const set = new Set(teamDesks.filter(d => d.floor === selectedFloor).map(d => d.deskId));
        const searchedDesk = userSearchResult?.booking?.desk;
        if (searchedDesk && searchedDesk.floor === selectedFloor) set.add(searchedDesk.id);
        return set;
    }, [teamDesks, selectedFloor, userSearchResult]);

    const userHighlightColor =
        userSearchResult?.booking
            ? (userSearchResult.user.teamColor ?? "#a855f7")
            : undefined;
    const highlightColor = userHighlightColor ?? teamHighlightColor;

    return (
        <div className="page">
            <div className="page-head">
                <div>
                    <h1>Floor map</h1>
                    <p className="muted">
                        {stats.free} of {stats.total} desks available on Floor {selectedFloor}
                    </p>
                </div>
                <div className="page-head-actions">
                    <UserSearch users={allUsers} onSelect={locateUser} />
                    <DateBar value={date} onChange={handleDateChange} />
                </div>
            </div>

            <div className="floor-tabs">
                {floors.map(f => (
                    <div key={f.floor} className="floor-tab-wrap">
                        <button
                            className={`floor-tab ${selectedFloor === f.floor ? "active" : ""}`}
                            onClick={() => setSelectedFloor(f.floor)}
                        >
                            <span className="floor-num">{f.floor}</span>
                            <span className="floor-lbl">Floor</span>
                        </button>
                        {canAnnounce && (
                            <button
                                type="button"
                                className="floor-tab-bell"
                                aria-label={`Send an announcement to everyone on Floor ${f.floor}`}
                                title={`Announce to Floor ${f.floor}`}
                                onClick={e => { e.stopPropagation(); setAnnounceFloor(f.floor); }}
                            >
                                <BellIcon />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            <div className={`map-wrap ${teamsOpen ? "with-sidebar" : ""}`}>
                <div className="map-area">
                    <div className="map-toolbar">
                        <div className="map-legend">
                            <span><i className="dot avail" /> Available</span>
                            <span><i className="dot booked" /> Booked (click for details)</span>
                            <span><i className="dot mine" /> Your booking</span>
                            <span><i className="dot sel" /> Selected</span>
                            <span><i className="dot a11y" /> Accessibility desk</span>
                            <span><i className="dot not-bookable" /> Not bookable</span>
                        </div>
                        <div className="map-toolbar-actions">
                            {highlight && (
                                <button className="ghost-btn" onClick={clearHighlight}>
                                    Clear highlight
                                </button>
                            )}
                            <button
                                className={`ghost-btn ${teamsOpen ? "active" : ""}`}
                                onClick={() => setTeamsOpen(o => !o)}
                            >
                                {teamsOpen ? "Hide teams" : "Show teams"}
                            </button>
                        </div>
                    </div>
                    {userSearchResult && (
                        <div className={`user-search-banner ${userSearchResult.booking ? "" : "is-absent"}`}>
                            {userSearchResult.booking ? (
                                <>
                                    <strong style={{ color: userHighlightColor }}>{userSearchResult.user.name}</strong>
                                    {" is at Desk "}
                                    <strong>{userSearchResult.booking.desk.number}</strong>
                                    {" on Floor "}
                                    <strong>{userSearchResult.booking.desk.floor}</strong>
                                    {userSearchResult.user.teamName ? ` (${userSearchResult.user.teamName})` : ""}
                                    {"."}
                                </>
                            ) : (
                                <>
                                    <strong>{userSearchResult.user.name}</strong>
                                    {" is not in the office on "}
                                    <strong>{date}</strong>
                                    {"."}
                                </>
                            )}
                            <button
                                className="user-search-banner-clear"
                                onClick={clearUserSearch}
                                aria-label="Clear person search"
                            >
                                ×
                            </button>
                        </div>
                    )}
                    {highlight && (
                        <div className="team-highlight-banner">
                            Highlighting <strong style={{ color: highlightColor }}>{highlightName}</strong>
                            {highlight.kind === "virtual" && (
                                <span
                                    style={{
                                        marginLeft: 6, fontSize: 10, padding: "1px 6px",
                                        borderRadius: 999, background: highlight.team.color, color: "#fff",
                                        verticalAlign: "middle", fontWeight: 600, letterSpacing: 0.3,
                                    }}
                                >VIRTUAL</span>
                            )}
                            {teamDesks.length === 0
                                ? ` — no members of this team are booked anywhere in the office on ${date}.`
                                : highlightedDeskIds.size > 0
                                    ? ` — ${highlightedDeskIds.size} desk${highlightedDeskIds.size === 1 ? "" : "s"} on this floor (${teamDesks.length} across the building).`
                                    : ` — no desks on this floor today, but ${teamDesks.length} member${teamDesks.length === 1 ? " is" : "s are"} booked elsewhere in the building.`}
                        </div>
                    )}
                    <FloorPlan
                        desks={desks}
                        selectedDeskId={selected?.id ?? null}
                        onSelect={setSelected}
                        currentUserId={user?.id}
                        isAdmin={user?.role === "Admin"}
                        highlightedDeskIds={highlightedDeskIds}
                        highlightColor={highlightColor}
                    />
                </div>

                <TeamsSidebar
                    open={teamsOpen}
                    teams={teams}
                    virtualTeams={virtualTeams}
                    myTeamId={user?.teamId ?? null}
                    favouriteIds={favouriteIds}
                    selectedTeamId={highlightedTeam?.id ?? null}
                    selectedVirtualTeamId={highlightedVirtual?.id ?? null}
                    inOfficeTeamIds={inOfficeTeamIds}
                    onToggleFavourite={toggleFavourite}
                    onSelect={selectFromSidebar}
                    onClose={() => setTeamsOpen(false)}
                />
            </div>

            {announceFloor !== null && user && (
                <FloorAnnouncementModal
                    floor={announceFloor}
                    callerId={user.id}
                    onClose={() => setAnnounceFloor(null)}
                />
            )}

            {selected && (
                <DeskDetailModal
                    desk={selected}
                    date={date}
                    onClose={() => setSelected(null)}
                    onBook={book}
                    busy={busy}
                    bookingDisabled={selected.booked || !selected.isBookable}
                    bookingDisabledReason={!selected.isBookable ? "This desk is not available for booking." : undefined}
                    message={message}
                    currentUserId={user?.id}
                    currentUserRole={user?.role}
                    onRequestSwap={requestSwap}
                    swapBusy={swapBusy}
                    swapMessage={swapMessage}
                    onToggleBookable={toggleBookable}
                    toggleBookableBusy={toggleBookableBusy}
                />
            )}
        </div>
    );
}

function BellIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
            <path
                fill="currentColor"
                d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-1.7 1.7A1 1 0 0 0 4 19.4h16a1 1 0 0 0 .7-1.7Z"
            />
        </svg>
    );
}
