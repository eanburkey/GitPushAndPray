using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Hackathon.Server.Models;

public enum UserRole { Member, TeamManager, Admin }

// Both desks and users use the same vocabulary: a user with need X is best
// served by a desk that provides X.
public enum AccessibilityType
{
    StandingDesk,
    TreadmillDesk,
    LargeMonitor,
    DualMonitor,
}

public class Team
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#4f46e5";
    public int HomeFloor { get; set; }
    public string HomeWing { get; set; } = "N"; // N|E|S|W

    // Admin-approved days the auto-booker uses every week.
    public string PreferredDays { get; set; } = "Mon,Wed"; // comma-separated DayOfWeek short names

    // Manager's pending request awaiting admin approval. Null when there's nothing in flight.
    public string? RequestedDays { get; set; }

    // The team manager (if any). Members list is unchanged.
    public int? ManagerUserId { get; set; }
    public User? Manager { get; set; }

    public List<User> Members { get; set; } = new();
}

public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public int TeamId { get; set; }
    public Team? Team { get; set; }
    public UserRole Role { get; set; } = UserRole.Member;

    // Sourced from Workday in production; for the demo it's seeded and admin-editable.
    // Stored as a comma-separated list of enum names via a value converter; a user may
    // have zero or more requirements.
    public List<AccessibilityType> AccessibilityNeeds { get; set; } = new();

    // Permanent opt-out from the auto-booker. Out-of-office days handle short absences;
    // this lets a user disable auto-booking indefinitely (e.g. remote-only worker).
    public bool IsAutoBookingEnabled { get; set; } = true;

    // If today's booking has no recorded arrival by this time, the desk is auto-released
    // so a colleague can claim it. Always set: users can adjust the time but can't disable
    // the feature — leaving empty desks idle for the day defeats the purpose. Capped at
    // 10:30 to keep early-morning attendance windows reasonable. Nullable column only so
    // EF doesn't trip over rows created before this feature existed (Guest auto-login);
    // those get backfilled to the default on first access.
    public TimeOnly? AutoCheckoutTime { get; set; }

    [NotMapped]
    public string Initials =>
        string.Concat(Name.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Take(2)
            .Select(p => char.ToUpperInvariant(p[0])));
}

public class Desk
{
    public int Id { get; set; }
    public int Floor { get; set; }
    public int Number { get; set; }
    public string Region { get; set; } = "N"; // N|E|S|W|NW|NE|SW|SE|INNER
    public int RegionRow { get; set; }
    public int RegionCol { get; set; }

    // Non-null means this is an accessibility desk of the given type.
    public AccessibilityType? AccessibilityType { get; set; }

    // When false, the desk cannot be booked (manager-controlled).
    public bool IsBookable { get; set; } = true;
}

public enum BookingKind { Mandatory, Manual }

public class Booking
{
    public int Id { get; set; }
    public int DeskId { get; set; }
    public Desk? Desk { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public DateOnly Date { get; set; }
    public BookingKind Kind { get; set; } = BookingKind.Manual;
    public bool IsAutoBooked { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum TradeStatus { Open, Accepted, Cancelled }

public class TradeRequest
{
    public int Id { get; set; }
    public int RequesterId { get; set; }
    public User? Requester { get; set; }
    public DateOnly Date { get; set; }
    public int? OfferedBookingId { get; set; }
    public Booking? OfferedBooking { get; set; }
    public string? DesiredFloor { get; set; }
    public string? DesiredZone { get; set; }
    public string? Note { get; set; }
    public TradeStatus Status { get; set; } = TradeStatus.Open;
    public int? AcceptedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Notification
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public string Message { get; set; } = "";
    public string Kind { get; set; } = "info"; // info|displaced|trade|trade-accepted|trade-declined|holiday
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Trade-request context. Populated only when Kind == "trade"; lets the
    // responder act on the swap without needing the message to be parseable.
    public int? TradeRequesterId { get; set; }
    public int? TradeDeskId { get; set; }
    public DateOnly? TradeDate { get; set; }
}

// Records when a user "arrived" at the office on a given day. In production this
// would come from badge swipes; here the client posts an arrival when the user
// checks in on their booking. We keep one row per user per day, mirroring badge
// behaviour, and use the history to suggest a sensible auto-checkout time.
public class ArrivalRecord
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public DateOnly Date { get; set; }
    public TimeOnly ArrivedAt { get; set; }
}

// Mirrors a Workday-sourced approved holiday day. One row per user per day.
public class Holiday
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public DateOnly Date { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// Manager-created cross-team grouping. While active (StartDate..EndDate inclusive),
// member auto-bookings happen here instead of via their normal team. HomeFloor/Wing
// are picked at creation time from the members' home-team mix.
public class VirtualTeam
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#7c3aed";
    public int CreatedByUserId { get; set; }
    public User? CreatedBy { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public string PreferredDays { get; set; } = ""; // comma-separated, exactly two
    public int HomeFloor { get; set; }
    public string HomeWing { get; set; } = "N";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<VirtualTeamMembership> Memberships { get; set; } = new();
}

public class VirtualTeamMembership
{
    public int Id { get; set; }
    public int VirtualTeamId { get; set; }
    public VirtualTeam? VirtualTeam { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
}

// ───────── DTOs ─────────
public record LoginRequest(string Email);
public record BookingRequest(int DeskId, DateOnly Date);
public record TradeCreateRequest(DateOnly Date, int? OfferedBookingId, string? DesiredFloor, string? DesiredZone, string? Note);
public record TradeAcceptRequest(int? CounterBookingId);
public record AutoBookRunRequest(DateOnly WeekStart);
public record UpdateDaysRequest(string Days);
public record HolidayRequest(DateOnly Date);
public record HolidayRangeRequest(DateOnly Start, DateOnly End);
public record UpdateAccessibilityNeedsRequest(string[]? Needs); // null/empty clears all
public record CreateVirtualTeamRequest(string Name, string PreferredDays, DateOnly StartDate, DateOnly EndDate, int[] MemberIds);
public record ExtendVirtualTeamRequest(DateOnly EndDate);
// Must be a non-empty "HH:mm" string and <= 10:30. Auto-checkout can't be disabled.
public record AutoCheckoutTimeRequest(string Time);
public record ArrivalRequest(DateOnly Date);
