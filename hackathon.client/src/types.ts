export type Role = "Member" | "TeamManager" | "Admin";

export type AccessibilityType = "StandingDesk" | "TreadmillDesk" | "LargeMonitor" | "DualMonitor";

export interface User {
    id: number;
    email: string;
    name: string;
    initials: string;
    teamId: number;
    teamName: string | null;
    teamColor: string | null;
    role: Role;
    accessibilityNeeds: AccessibilityType[];
    isAutoBookingEnabled: boolean;
    autoCheckoutTime: string;
}

export interface AutoCheckoutSuggestion {
    suggestedTime: string | null;
    sampleSize: number;
    typicalArrivalTime: string | null;
    maxAllowed: string;
}

export interface CheckInStatus {
    checkedIn: boolean;
    arrivedAt: string | null;
}

export interface AdminUser {
    id: number;
    email: string;
    name: string;
    teamId: number;
    teamName: string | null;
    teamColor: string | null;
    role: Role;
    accessibilityNeeds: AccessibilityType[];
}

export interface Team {
    id: number;
    name: string;
    color: string;
    homeFloor: number;
    homeWing: string;
    preferredDays: string;
    requestedDays: string | null;
    managerUserId: number | null;
    memberCount: number;
}

export interface DayPlannerDay {
    code: "Mon" | "Tue" | "Wed" | "Thu" | "Fri";
    assignedHeadcount: number;
    requestedHeadcount: number;
    suggestedHeadcount: number;
}

export interface DayPlannerTeam {
    id: number;
    name: string;
    color: string;
    homeFloor: number;
    homeWing: string;
    memberCount: number;
    managerUserId: number | null;
    managerName: string | null;
    managerEmail: string | null;
    preferredDays: string;
    requestedDays: string | null;
    suggestedDays: string;
}

export interface DayPlanner {
    totalPeople: number;
    targetPerDay: number;
    days: DayPlannerDay[];
    teams: DayPlannerTeam[];
}

export interface Desk {
    id: number;
    floor: number;
    number: number;
    region: string;
    accessibilityType?: AccessibilityType | null;
}

export interface BookedBy {
    userId: number;
    name: string;
    initials: string;
    email: string;
    teamName: string;
    teamColor: string;
    kind: "Mandatory" | "Manual";
    isAutoBooked: boolean;
}

export interface FloorDesk {
    id: number;
    floor: number;
    number: number;
    region: string;
    regionRow: number;
    regionCol: number;
    accessibilityType: AccessibilityType | null;
    isBookable: boolean;
    booked: boolean;
    bookedBy: BookedBy | null;
}

export interface Holiday {
    id: number;
    date: string;
}

export interface CancelHolidayResult {
    date: string;
    isTeamDay: boolean;
    autoBooked: boolean;
    desk: {
        id: number;
        floor: number;
        number: number;
        region: string;
        accessibilityType: AccessibilityType | null;
    } | null;
    notice: string | null;
}

export interface FloorLayoutRegion {
    code: string;
    label: string;
    rows: number;
    cols: number;
}

export interface FloorSummary {
    floor: number;
    deskCount: number;
}

export interface Booking {
    id: number;
    date: string;
    kind: "Mandatory" | "Manual";
    isAutoBooked: boolean;
    desk: Desk;
}

export interface Notification {
    id: number;
    userId: number;
    message: string;
    kind: string;
    isRead: boolean;
    createdAt: string;
    tradeRequesterId: number | null;
    tradeDeskId: number | null;
    tradeDate: string | null;
}

export interface AutoBookResult {
    bookingsCreated: number;
    displaced: number;
    alreadyHad: number;
    skippedOnHoliday: number;
    weekStart: string;
}

export interface TeamDesk {
    deskId: number;
    floor: number;
    number: number;
    region: string;
    userId: number;
    userName: string;
}

export interface VirtualTeamMember {
    userId: number;
    name: string;
    email: string;
    teamId: number;
    teamName: string | null;
    teamColor: string | null;
}

export interface VirtualTeam {
    id: number;
    name: string;
    color: string;
    homeFloor: number;
    homeWing: string;
    preferredDays: string;
    startDate: string; // yyyy-MM-dd
    endDate: string;   // yyyy-MM-dd
    createdByUserId: number;
    createdByName: string | null;
    members: VirtualTeamMember[];
}

export interface VirtualTeamCandidate {
    id: number;
    name: string;
    email: string;
    teamId: number;
    teamName: string | null;
    teamColor: string | null;
    homeFloor: number | null;
    homeWing: string | null;
}

export interface ActiveVirtualTeam {
    id: number;
    name: string;
    color: string;
    homeFloor: number;
    homeWing: string;
    preferredDays: string;
    startDate: string;
    endDate: string;
    memberCount: number;
}
