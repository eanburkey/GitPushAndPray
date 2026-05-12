import type {
    AccessibilityType,
    ActiveVirtualTeam,
    AutoBookResult,
    AutoCheckoutSuggestion,
    Booking,
    CancelHolidayResult,
    CheckInStatus,
    DayPlanner,
    FloorDesk,
    FloorLayoutRegion,
    FloorSummary,
    Holiday,
    Notification,
    Team,
    TeamDesk,
    User,
    VirtualTeam,
    VirtualTeamCandidate,
} from "./types";

async function handle<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

export const api = {
    login: (email: string) =>
        fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
        }).then(handle<{ user: User }>),

    allUsers: () => fetch("/api/auth/users").then(handle<User[]>),

    listTeams: () => fetch("/api/teams").then(handle<Team[]>),

    teamDesks: (teamId: number, date: string) =>
        fetch(`/api/teams/${teamId}/desks?date=${date}`).then(handle<TeamDesk[]>),

    teamsWithBookings: (date: string) =>
        fetch(`/api/teams/with-bookings?date=${date}`).then(handle<number[]>),

    listFloors: () => fetch("/api/floors").then(handle<FloorSummary[]>),

    floorLayout: () => fetch("/api/floors/layout").then(handle<FloorLayoutRegion[]>),

    floorDesks: (floor: number, date: string) =>
        fetch(`/api/floors/${floor}/desks?date=${date}`).then(handle<FloorDesk[]>),

    myBookings: (userId: number) =>
        fetch(`/api/bookings?userId=${userId}`).then(handle<Booking[]>),

    bookDesk: (userId: number, deskId: number, date: string) =>
        fetch(`/api/bookings?userId=${userId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deskId, date }),
        }).then(handle<{ booking: Booking; isOverMandatory: boolean; warning: string | null }>),

    cancelBooking: (userId: number, bookingId: number) =>
        fetch(`/api/bookings/${bookingId}?userId=${userId}`, { method: "DELETE" }).then(handle<void>),

    runAutoBook: (weekStart: string) =>
        fetch("/api/autobook/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ weekStart }),
        }).then(handle<AutoBookResult>),

    weekStarts: () =>
        fetch("/api/autobook/next-week-start").then(handle<{ thisWeek: string; nextWeek: string }>),

    notifications: (userId: number) =>
        fetch(`/api/notifications?userId=${userId}`).then(handle<Notification[]>),

    markRead: (userId: number, id: number) =>
        fetch(`/api/notifications/${id}/read?userId=${userId}`, { method: "POST" }).then(handle<void>),

    requestSwap: (fromUserId: number, targetUserId: number, deskId: number, date: string) =>
        fetch("/api/notifications/swap-request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fromUserId, targetUserId, deskId, date }),
        }).then(handle<{ sent: boolean; alreadySent: boolean }>),

    respondSwap: (userId: number, notificationId: number, accept: boolean) =>
        fetch(`/api/notifications/${notificationId}/respond?userId=${userId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accept }),
        }).then(handle<{ ok: boolean; accepted: boolean; swapped: boolean | null }>),

    broadcastFloorAnnouncement: (callerId: number, floor: number, message: string) =>
        fetch("/api/notifications/broadcast-to-floor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callerId, floor, message }),
        }).then(handle<{ sent: number }>),

    requestTeamDays: (callerId: number, teamId: number, days: string) =>
        fetch(`/api/teams/${teamId}/requested-days?callerId=${callerId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ days }),
        }).then(handle<{ id: number; requestedDays: string; preferredDays: string }>),

    dayPlanner: (callerId: number) =>
        fetch(`/api/admin/day-planner?callerId=${callerId}`).then(handle<DayPlanner>),

    setAssignedDays: (callerId: number, teamId: number, days: string) =>
        fetch(`/api/admin/teams/${teamId}/assigned-days?callerId=${callerId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ days }),
        }).then(handle<{ id: number; preferredDays: string; requestedDays: string | null }>),

    applyAllSuggestions: (callerId: number) =>
        fetch(`/api/admin/apply-suggestion?callerId=${callerId}`, { method: "POST" })
            .then(handle<{ updated: number }>),

    holidays: (userId: number) =>
        fetch(`/api/holidays?userId=${userId}`).then(handle<Holiday[]>),

    addHoliday: (userId: number, date: string) =>
        fetch(`/api/holidays?userId=${userId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date }),
        }).then(handle<{ date: string; freedAutoBooking: boolean }>),

    addHolidayRange: (userId: number, start: string, end: string) =>
        fetch(`/api/holidays/range?userId=${userId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start, end }),
        }).then(handle<{ start: string; end: string; added: number; alreadyHad: number; freedAutoBookings: number }>),

    cancelHoliday: (userId: number, id: number) =>
        fetch(`/api/holidays/${id}?userId=${userId}`, { method: "DELETE" })
            .then(handle<CancelHolidayResult>),

    cancelHolidayRange: (userId: number, start: string, end: string) =>
        fetch(`/api/holidays/range?userId=${userId}&start=${start}&end=${end}`, { method: "DELETE" })
            .then(handle<{ removed: number; rebooked: number; manualNeeded: number }>),

    managerListUsers: (callerId: number) =>
        fetch(`/api/users?callerId=${callerId}`).then(handle<User[]>),

    setAccessibilityNeeds: (callerId: number, userId: number, needs: AccessibilityType[]) =>
        fetch(`/api/accessibility/${userId}/accessibility-needs?callerId=${callerId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ needs }),
        }).then(handle<{ id: number; accessibilityNeeds: AccessibilityType[] }>),

    listVirtualTeams: (callerId: number) =>
        fetch(`/api/virtual-teams?callerId=${callerId}`).then(handle<VirtualTeam[]>),

    activeVirtualTeams: (date: string) =>
        fetch(`/api/virtual-teams/active?date=${date}`).then(handle<ActiveVirtualTeam[]>),

    virtualTeamDesks: (id: number, date: string) =>
        fetch(`/api/virtual-teams/${id}/desks?date=${date}`).then(handle<TeamDesk[]>),

    virtualTeamCandidates: (callerId: number) =>
        fetch(`/api/virtual-teams/candidates?callerId=${callerId}`).then(handle<VirtualTeamCandidate[]>),

    createVirtualTeam: (callerId: number, body: {
        name: string;
        preferredDays: string;
        startDate: string;
        endDate: string;
        memberIds: number[];
    }) =>
        fetch(`/api/virtual-teams?callerId=${callerId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }).then(handle<VirtualTeam>),

    extendVirtualTeam: (callerId: number, id: number, endDate: string) =>
        fetch(`/api/virtual-teams/${id}/end-date?callerId=${callerId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endDate }),
        }).then(handle<{ id: number; startDate: string; endDate: string }>),

    disbandVirtualTeam: (callerId: number, id: number) =>
        fetch(`/api/virtual-teams/${id}?callerId=${callerId}`, { method: "DELETE" }).then(handle<void>),

    setDeskBookable: (callerId: number, deskId: number, isBookable: boolean) =>
        fetch(`/api/floors/desks/${deskId}/bookable?callerId=${callerId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isBookable }),
        }).then(handle<{ id: number; isBookable: boolean }>),

    setAutoBookingEnabled: (userId: number, enabled: boolean) =>
        fetch(`/api/users/${userId}/auto-booking`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled }),
        }).then(handle<{ id: number; isAutoBookingEnabled: boolean }>),

    setAutoCheckoutTime: (userId: number, time: string) =>
        fetch(`/api/users/${userId}/auto-checkout-time`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ time }),
        }).then(handle<{ id: number; autoCheckoutTime: string }>),

    autoCheckoutSuggestion: (userId: number) =>
        fetch(`/api/users/${userId}/auto-checkout-suggestion`).then(handle<AutoCheckoutSuggestion>),

    checkIn: (userId: number) =>
        fetch(`/api/bookings/check-in?userId=${userId}`, { method: "POST" })
            .then(handle<{ date: string; arrivedAt: string }>),

    checkInStatus: (userId: number) =>
        fetch(`/api/bookings/check-in-status?userId=${userId}`).then(handle<CheckInStatus>),
};
