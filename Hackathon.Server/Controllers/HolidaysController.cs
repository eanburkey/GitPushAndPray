using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/holidays")]
public class HolidaysController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int userId)
    {
        if (userId <= 0) return BadRequest("userId is required.");

        var today = DateOnly.FromDateTime(DateTime.Today);
        var holidays = await db.Holidays
            .Where(h => h.UserId == userId && h.Date >= today)
            .OrderBy(h => h.Date)
            .ToListAsync();

        return Ok(holidays.Select(h => new { h.Id, h.Date }));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromQuery] int userId, [FromBody] HolidayRequest body)
    {
        if (userId <= 0) return BadRequest("userId is required.");

        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound("User not found.");
        if (body.Date < DateOnly.FromDateTime(DateTime.Today))
            return BadRequest("Holidays can only be added for today or later.");

        var existing = await db.Holidays.FirstOrDefaultAsync(h => h.UserId == userId && h.Date == body.Date);
        if (existing is not null) return Conflict("Holiday already exists for that date.");

        db.Holidays.Add(new Holiday { UserId = userId, Date = body.Date });

        // Remove any auto-booked desk on that day — they're on leave, the desk should free up.
        var autoBooking = await db.Bookings
            .FirstOrDefaultAsync(b => b.UserId == userId && b.Date == body.Date && b.IsAutoBooked);
        if (autoBooking is not null) db.Bookings.Remove(autoBooking);

        await db.SaveChangesAsync();
        return Ok(new { Date = body.Date, FreedAutoBooking = autoBooking is not null });
    }

    /// <summary>
    /// Bulk-adds out-of-office days across a range. Inclusive on both ends. Skips
    /// dates that already have a holiday for the user, and releases any auto-booked
    /// desks that fall inside the range.
    /// </summary>
    [HttpPost("range")]
    public async Task<IActionResult> CreateRange([FromQuery] int userId, [FromBody] HolidayRangeRequest body)
    {
        if (userId <= 0) return BadRequest("userId is required.");

        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound("User not found.");

        if (body.End < body.Start) return BadRequest("End date must be on or after start date.");

        var today = DateOnly.FromDateTime(DateTime.Today);
        if (body.End < today) return BadRequest("Out-of-office range can only be in the future.");

        // Clamp start to today so callers can pass "this week" without us rejecting it.
        var start = body.Start < today ? today : body.Start;
        var end = body.End;

        var existing = await db.Holidays
            .Where(h => h.UserId == userId && h.Date >= start && h.Date <= end)
            .Select(h => h.Date)
            .ToListAsync();
        var existingSet = existing.ToHashSet();

        int added = 0;
        for (var d = start; d <= end; d = d.AddDays(1))
        {
            if (existingSet.Contains(d)) continue;
            db.Holidays.Add(new Holiday { UserId = userId, Date = d });
            added++;
        }

        var autoBookings = await db.Bookings
            .Where(b => b.UserId == userId && b.Date >= start && b.Date <= end && b.IsAutoBooked)
            .ToListAsync();
        if (autoBookings.Count > 0) db.Bookings.RemoveRange(autoBookings);

        await db.SaveChangesAsync();

        return Ok(new
        {
            Start = start,
            End = end,
            Added = added,
            AlreadyHad = existingSet.Count,
            FreedAutoBookings = autoBookings.Count,
        });
    }

    /// <summary>
    /// Cancels a holiday and tries to slot the user back into a desk near their team.
    /// If we can't find a desk adjacent to the team that day, we log a notification
    /// asking them to book manually (the workflow described for the Workday sync).
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Cancel(int id, [FromQuery] int userId)
    {
        var holiday = await db.Holidays.FindAsync(id);
        if (holiday is null) return NotFound();
        if (holiday.UserId != userId) return Forbid();

        var user = await db.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Id == userId);
        if (user is null) return NotFound("User not found.");

        db.Holidays.Remove(holiday);
        await db.SaveChangesAsync();

        var date = holiday.Date;
        bool isTeamDay = false;
        bool autoBooked = false;
        Desk? bookedDesk = null;
        string? notice = null;

        if (user.Team is not null && BookingWindow.IsBookable(date) && user.IsAutoBookingEnabled)
        {
            // Is this a mandatory team day?
            isTeamDay = IsTeamDay(user.Team, date);

            if (isTeamDay)
            {
                // Already have a booking? Nothing to do.
                var existingBooking = await db.Bookings.FirstOrDefaultAsync(b => b.UserId == userId && b.Date == date);
                if (existingBooking is null)
                {
                    bookedDesk = await TryBookNextToTeamAsync(user, date);
                    autoBooked = bookedDesk is not null;

                    if (!autoBooked)
                    {
                        notice = $"You're back on {date:ddd, MMM d} (a team day), but no desks were free next to {user.Team.Name}. Please book one manually.";
                        db.Notifications.Add(new Notification
                        {
                            UserId = user.Id,
                            Kind = "holiday",
                            Message = notice,
                        });
                        await db.SaveChangesAsync();
                    }
                }
            }
        }

        return Ok(new
        {
            Date = date,
            IsTeamDay = isTeamDay,
            AutoBooked = autoBooked,
            Desk = bookedDesk is null ? null : new
            {
                bookedDesk.Id,
                bookedDesk.Floor,
                bookedDesk.Number,
                bookedDesk.Region,
                AccessibilityType = bookedDesk.AccessibilityType?.ToString(),
            },
            Notice = notice,
        });
    }

    /// <summary>
    /// Cancels every holiday for the user inside an inclusive date range, and tries to
    /// slot them back onto a desk near their team for any team day that falls inside.
    /// Days where no desk is free near the team get a "please book manually" notification,
    /// mirroring the single-day cancel behaviour.
    /// </summary>
    [HttpDelete("range")]
    public async Task<IActionResult> CancelRange(
        [FromQuery] int userId,
        [FromQuery] DateOnly start,
        [FromQuery] DateOnly end)
    {
        if (userId <= 0) return BadRequest("userId is required.");
        if (end < start) return BadRequest("End date must be on or after start date.");

        var user = await db.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Id == userId);
        if (user is null) return NotFound("User not found.");

        var holidays = await db.Holidays
            .Where(h => h.UserId == userId && h.Date >= start && h.Date <= end)
            .ToListAsync();
        if (holidays.Count == 0)
            return Ok(new { Removed = 0, Rebooked = 0, ManualNeeded = 0 });

        db.Holidays.RemoveRange(holidays);
        await db.SaveChangesAsync();

        int rebooked = 0, manualNeeded = 0;

        if (user.Team is not null && user.IsAutoBookingEnabled)
        {
            foreach (var h in holidays)
            {
                var date = h.Date;
                if (!BookingWindow.IsBookable(date)) continue;
                if (!IsTeamDay(user.Team, date)) continue;

                var existing = await db.Bookings
                    .FirstOrDefaultAsync(b => b.UserId == userId && b.Date == date);
                if (existing is not null) continue;

                var desk = await TryBookNextToTeamAsync(user, date);
                if (desk is not null) { rebooked++; continue; }

                manualNeeded++;
                db.Notifications.Add(new Notification
                {
                    UserId = user.Id,
                    Kind = "holiday",
                    Message = $"You're back on {date:ddd, MMM d} (a team day), but no desks were free next to {user.Team.Name}. Please book one manually.",
                });
            }
            if (manualNeeded > 0) await db.SaveChangesAsync();
        }

        return Ok(new
        {
            Removed = holidays.Count,
            Rebooked = rebooked,
            ManualNeeded = manualNeeded,
        });
    }

    // Match → standard → non-matching a11y. Keeps non-matching accessibility desks free
    // for users who actually need them.
    private static int NeedRank(Desk d, List<AccessibilityType> needs)
    {
        if (d.AccessibilityType is { } t && needs.Contains(t)) return 0;
        if (d.AccessibilityType is null) return 1;
        return 2;
    }

    private static bool IsTeamDay(Team team, DateOnly date)
    {
        foreach (var idx in DayHelpers.ParseIndices(team.PreferredDays))
        {
            // Mon = 0 in DayHelpers, Monday = 1 in DayOfWeek; normalise both to Mon=0.
            var dayIdx = ((int)date.DayOfWeek - (int)DayOfWeek.Monday + 7) % 7;
            if (idx == dayIdx) return true;
        }
        return false;
    }

    private async Task<Desk?> TryBookNextToTeamAsync(User user, DateOnly date)
    {
        var team = user.Team!;
        var wingDesks = await db.Desks
            .Where(d => d.Floor == team.HomeFloor && d.Region == team.HomeWing)
            .OrderBy(d => d.RegionRow).ThenBy(d => d.RegionCol)
            .ToListAsync();
        var bookedIds = await db.Bookings
            .Where(b => b.Date == date)
            .Select(b => b.DeskId)
            .ToListAsync();
        var bookedSet = bookedIds.ToHashSet();

        var free = wingDesks.Where(d => !bookedSet.Contains(d.Id));
        var needs = user.AccessibilityNeeds;
        Desk? target = (needs.Count > 0
                ? free.OrderBy(d => NeedRank(d, needs))
                : free.OrderBy(d => d.AccessibilityType is null ? 0 : 1))
            .ThenBy(d => d.RegionRow).ThenBy(d => d.RegionCol)
            .FirstOrDefault();

        if (target is null) return null;

        db.Bookings.Add(new Booking
        {
            DeskId = target.Id,
            UserId = user.Id,
            Date = date,
            Kind = BookingKind.Mandatory,
            IsAutoBooked = true,
        });
        await db.SaveChangesAsync();
        return target;
    }
}
