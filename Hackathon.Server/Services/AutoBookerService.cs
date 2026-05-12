using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Services;

public record AutoBookResult(int BookingsCreated, int Displaced, int AlreadyHad, int SkippedOnHoliday, DateOnly WeekStart);

public class AutoBookerService(AppDbContext db, ILogger<AutoBookerService> log)
{
    private static DayOfWeek ParseDay(string s) => s.Trim().ToLowerInvariant() switch
    {
        "mon" or "monday"    => DayOfWeek.Monday,
        "tue" or "tuesday"   => DayOfWeek.Tuesday,
        "wed" or "wednesday" => DayOfWeek.Wednesday,
        "thu" or "thursday"  => DayOfWeek.Thursday,
        "fri" or "friday"    => DayOfWeek.Friday,
        _ => DayOfWeek.Monday,
    };

    public static DateOnly StartOfWeek(DateOnly date)
    {
        // Monday-based week
        int diff = ((int)date.DayOfWeek - (int)DayOfWeek.Monday + 7) % 7;
        return date.AddDays(-diff);
    }

    public async Task<AutoBookResult> RunForWeekAsync(DateOnly weekStart)
    {
        weekStart = StartOfWeek(weekStart);
        int created = 0, displaced = 0, alreadyHad = 0, skipped = 0;

        // Pre-load all holidays for the week to avoid N+1 queries.
        var weekEnd = weekStart.AddDays(6);
        var weekHolidays = await db.Holidays
            .Where(h => h.Date >= weekStart && h.Date <= weekEnd)
            .ToListAsync();
        var onHoliday = weekHolidays
            .GroupBy(h => h.Date)
            .ToDictionary(g => g.Key, g => g.Select(h => h.UserId).ToHashSet());

        // Active virtual teams overlapping this week. We process them first so their
        // members are seated together at the VT's home wing, and so normal-team
        // processing can skip these users for every day in the VT window (override).
        var activeVts = await db.VirtualTeams
            .Include(v => v.Memberships).ThenInclude(m => m.User)
            .Where(v => v.StartDate <= weekEnd && v.EndDate >= weekStart)
            .ToListAsync();

        // date -> set of user IDs whose auto-booking is owned by a virtual team that day.
        var vtMembersByDate = new Dictionary<DateOnly, HashSet<int>>();
        foreach (var vt in activeVts)
        {
            var from = vt.StartDate > weekStart ? vt.StartDate : weekStart;
            var to = vt.EndDate < weekEnd ? vt.EndDate : weekEnd;
            for (var d = from; d <= to; d = d.AddDays(1))
            {
                if (!vtMembersByDate.TryGetValue(d, out var set))
                    set = vtMembersByDate[d] = new HashSet<int>();
                foreach (var m in vt.Memberships) set.Add(m.UserId);
            }
        }

        foreach (var vt in activeVts)
        {
            var vtDays = vt.PreferredDays
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(ParseDay)
                .Select(d => weekStart.AddDays(((int)d - (int)DayOfWeek.Monday + 7) % 7))
                .Where(d => d >= vt.StartDate && d <= vt.EndDate)
                .ToList();

            foreach (var date in vtDays)
            {
                var holidaysToday = onHoliday.GetValueOrDefault(date, new HashSet<int>());
                var wingDesks = await db.Desks
                    .Where(d => d.Floor == vt.HomeFloor && d.Region == vt.HomeWing)
                    .OrderBy(d => d.RegionRow).ThenBy(d => d.RegionCol)
                    .ToListAsync();
                var wingIds = wingDesks.Select(d => d.Id).ToHashSet();
                var bookingsThatDay = await db.Bookings.Where(b => b.Date == date).ToListAsync();
                var bookedDeskIds = bookingsThatDay.Select(b => b.DeskId).ToHashSet();

                foreach (var membership in vt.Memberships)
                {
                    var user = membership.User!;
                    if (!user.IsAutoBookingEnabled) { skipped++; continue; }
                    if (holidaysToday.Contains(user.Id)) { skipped++; continue; }

                    var existing = bookingsThatDay.FirstOrDefault(b => b.UserId == user.Id);
                    if (existing is not null)
                    {
                        if (existing.Kind != BookingKind.Mandatory)
                        {
                            existing.Kind = BookingKind.Mandatory;
                            existing.IsAutoBooked = false;
                        }
                        alreadyHad++;
                        continue;
                    }

                    var target = PickDeskFor(user, wingDesks, bookedDeskIds);
                    if (target is null)
                    {
                        var victim = bookingsThatDay.FirstOrDefault(b =>
                            wingIds.Contains(b.DeskId) && b.Kind == BookingKind.Manual);
                        if (victim is not null)
                        {
                            var victimDesk = wingDesks.First(d => d.Id == victim.DeskId);
                            db.Bookings.Remove(victim);
                            db.Notifications.Add(new Notification
                            {
                                UserId = victim.UserId,
                                Kind = "displaced",
                                Message = $"Your booking for {date:ddd, MMM d} on Floor {victimDesk.Floor} Desk {victimDesk.Number} was reassigned " +
                                          $"to make room for the {vt.Name} virtual team. Please book another desk if you still need one.",
                            });
                            bookingsThatDay.Remove(victim);
                            bookedDeskIds.Remove(victim.DeskId);
                            target = victimDesk;
                            displaced++;
                        }
                    }

                    if (target is null)
                        target = await FindFallbackDeskAsync(user, vt.HomeFloor, vt.HomeWing, bookedDeskIds);
                    if (target is null)
                    {
                        log.LogWarning("Auto-booker (virtual) could not find any free desk for {User} on {Date}", user.Name, date);
                        continue;
                    }

                    var newBooking = new Booking
                    {
                        DeskId = target.Id,
                        UserId = user.Id,
                        Date = date,
                        Kind = BookingKind.Mandatory,
                        IsAutoBooked = true,
                    };
                    db.Bookings.Add(newBooking);
                    bookingsThatDay.Add(newBooking);
                    bookedDeskIds.Add(target.Id);
                    created++;
                }
            }

            await db.SaveChangesAsync();
        }

        var teams = await db.Teams.Include(t => t.Members).ToListAsync();
        foreach (var team in teams)
        {
            // Save after each team so later teams see this team's spillover when
            // querying free desks. Avoids unique-constraint violations on (Desk, Date).
            var days = team.PreferredDays
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(ParseDay)
                .Select(d => weekStart.AddDays(((int)d - (int)DayOfWeek.Monday + 7) % 7))
                .ToList();

            foreach (var date in days)
            {
                var holidaysToday = onHoliday.GetValueOrDefault(date, new HashSet<int>());
                var vtOwned = vtMembersByDate.GetValueOrDefault(date, new HashSet<int>());

                // Desks in team's home floor + wing (cached per day).
                var wingDesks = await db.Desks
                    .Where(d => d.Floor == team.HomeFloor && d.Region == team.HomeWing)
                    .OrderBy(d => d.RegionRow).ThenBy(d => d.RegionCol)
                    .ToListAsync();
                var wingIds = wingDesks.Select(d => d.Id).ToHashSet();

                var bookingsThatDay = await db.Bookings
                    .Where(b => b.Date == date)
                    .ToListAsync();
                var bookedDeskIds = bookingsThatDay.Select(b => b.DeskId).ToHashSet();

                foreach (var user in team.Members)
                {
                    // User permanently opted out of auto-booking.
                    if (!user.IsAutoBookingEnabled)
                    {
                        skipped++;
                        continue;
                    }

                    // Virtual team override: while a user is in an active VT, their normal
                    // team's auto-booking days don't apply to them — the VT owns those days.
                    if (vtOwned.Contains(user.Id))
                    {
                        skipped++;
                        continue;
                    }

                    // Real-world rule: a user on approved leave is never auto-booked.
                    if (holidaysToday.Contains(user.Id))
                    {
                        // If they somehow have a booking on this day (e.g. holiday added
                        // after a manual booking), leave it alone — they can cancel manually.
                        skipped++;
                        continue;
                    }

                    var existing = bookingsThatDay.FirstOrDefault(b => b.UserId == user.Id);
                    if (existing is not null)
                    {
                        // Mark it as mandatory if it isn't already.
                        if (existing.Kind != BookingKind.Mandatory)
                        {
                            existing.Kind = BookingKind.Mandatory;
                            existing.IsAutoBooked = false;
                        }
                        alreadyHad++;
                        continue;
                    }

                    var target = PickDeskFor(user, wingDesks, bookedDeskIds);

                    // 2. Displace a Manual non-mandatory booking sitting in our wing
                    if (target is null)
                    {
                        var victim = bookingsThatDay.FirstOrDefault(b =>
                            wingIds.Contains(b.DeskId) && b.Kind == BookingKind.Manual);
                        if (victim is not null)
                        {
                            var victimDesk = wingDesks.First(d => d.Id == victim.DeskId);
                            db.Bookings.Remove(victim);
                            db.Notifications.Add(new Notification
                            {
                                UserId = victim.UserId,
                                Kind = "displaced",
                                Message = $"Your booking for {date:ddd, MMM d} on Floor {victimDesk.Floor} Desk {victimDesk.Number} was reassigned " +
                                          $"to make room for {team.Name}'s mandatory team day. Please book another desk if you still need one.",
                            });
                            bookingsThatDay.Remove(victim);
                            bookedDeskIds.Remove(victim.DeskId);
                            target = victimDesk;
                            displaced++;
                        }
                    }

                    // 3. Fallback: anywhere on the home floor, then anywhere at all.
                    //    Even at fallback we still prefer the user's accessibility type if needed.
                    if (target is null)
                    {
                        target = await FindFallbackDeskAsync(user, team.HomeFloor, team.HomeWing, bookedDeskIds);
                    }
                    if (target is null)
                    {
                        log.LogWarning("Auto-booker could not find any free desk for {User} on {Date}", user.Name, date);
                        continue;
                    }

                    var newBooking = new Booking
                    {
                        DeskId = target.Id,
                        UserId = user.Id,
                        Date = date,
                        Kind = BookingKind.Mandatory,
                        IsAutoBooked = true,
                    };
                    db.Bookings.Add(newBooking);
                    bookingsThatDay.Add(newBooking);
                    bookedDeskIds.Add(target.Id);
                    created++;
                }
            }

            await db.SaveChangesAsync();
        }

        log.LogInformation("AutoBooker for week {Week}: created={Created} displaced={Displaced} alreadyHad={Existing} skippedHoliday={Skipped}",
            weekStart, created, displaced, alreadyHad, skipped);
        return new AutoBookResult(created, displaced, alreadyHad, skipped, weekStart);
    }

    /// <summary>
    /// Models real-world voluntary attendance: ~90% of users only come in on their
    /// team's 2 mandatory days (already booked by <see cref="RunForWeekAsync"/>).
    /// The other ~<paramref name="extraUserFraction"/> come in 1-3 additional days by
    /// individual choice, seated on any free desk in the building — so they appear
    /// scattered and largely alone on non-team days.
    /// </summary>
    public async Task<int> AddIndividualChoiceBookingsAsync(DateOnly weekStart, double extraUserFraction = 0.10)
    {
        weekStart = StartOfWeek(weekStart);
        var weekEnd = weekStart.AddDays(4);
        int created = 0;

        var allUsers = await db.Users.Include(u => u.Team).ToListAsync();
        var allDesks = await db.Desks.ToListAsync();

        var weekBookings = await db.Bookings
            .Where(b => b.Date >= weekStart && b.Date <= weekEnd)
            .Select(b => new { b.DeskId, b.UserId, b.Date })
            .ToListAsync();
        var bookedDeskByDate = new Dictionary<DateOnly, HashSet<int>>();
        var bookedUserByDate = new Dictionary<DateOnly, HashSet<int>>();
        foreach (var b in weekBookings)
        {
            if (!bookedDeskByDate.TryGetValue(b.Date, out var dset)) bookedDeskByDate[b.Date] = dset = new();
            if (!bookedUserByDate.TryGetValue(b.Date, out var uset)) bookedUserByDate[b.Date] = uset = new();
            dset.Add(b.DeskId);
            uset.Add(b.UserId);
        }

        var holidayByUser = (await db.Holidays
            .Where(h => h.Date >= weekStart && h.Date <= weekEnd)
            .Select(h => new { h.UserId, h.Date })
            .ToListAsync())
            .GroupBy(h => h.UserId)
            .ToDictionary(g => g.Key, g => g.Select(h => h.Date).ToHashSet());

        var rng = new Random(weekStart.DayNumber);
        // Users who've opted out of auto-booking are never included in the extras pool.
        var eligible = allUsers.Where(u => u.IsAutoBookingEnabled).ToList();
        int extraCount = (int)Math.Round(eligible.Count * extraUserFraction);
        var extras = eligible.OrderBy(_ => rng.Next()).Take(extraCount).ToList();

        foreach (var user in extras)
        {
            var teamDays = user.Team is null
                ? new HashSet<DateOnly>()
                : user.Team.PreferredDays
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(ParseDay)
                    .Select(d => weekStart.AddDays(((int)d - (int)DayOfWeek.Monday + 7) % 7))
                    .ToHashSet();
            var userHolidays = holidayByUser.GetValueOrDefault(user.Id, new HashSet<DateOnly>());

            var candidateDays = new List<DateOnly>();
            for (var d = weekStart; d <= weekEnd; d = d.AddDays(1))
            {
                if (teamDays.Contains(d)) continue;
                if (userHolidays.Contains(d)) continue;
                if (!BookingWindow.IsBookable(d)) continue;
                candidateDays.Add(d);
            }
            if (candidateDays.Count == 0) continue;

            int maxExtra = Math.Min(candidateDays.Count, 3);
            int extraDays = rng.Next(1, maxExtra + 1);
            var chosenDays = candidateDays.OrderBy(_ => rng.Next()).Take(extraDays).ToList();

            foreach (var date in chosenDays)
            {
                if (!bookedDeskByDate.TryGetValue(date, out var bookedDesks)) bookedDeskByDate[date] = bookedDesks = new();
                if (!bookedUserByDate.TryGetValue(date, out var bookedUsers)) bookedUserByDate[date] = bookedUsers = new();
                if (bookedUsers.Contains(user.Id)) continue;

                var freeDesks = allDesks.Where(d => !bookedDesks.Contains(d.Id)).ToList();
                if (freeDesks.Count == 0) continue;

                Desk? pick = null;
                if (user.AccessibilityNeeds.Count > 0)
                {
                    var needSet = user.AccessibilityNeeds.ToHashSet();
                    pick = freeDesks
                        .Where(d => d.AccessibilityType is { } t && needSet.Contains(t))
                        .OrderBy(_ => rng.Next()).FirstOrDefault();
                }
                // Prefer standard desks so accessibility desks stay open for those who need them.
                pick ??= freeDesks
                    .Where(d => d.AccessibilityType is null)
                    .OrderBy(_ => rng.Next()).FirstOrDefault()
                    ?? freeDesks[rng.Next(freeDesks.Count)];

                db.Bookings.Add(new Booking
                {
                    DeskId = pick.Id,
                    UserId = user.Id,
                    Date = date,
                    Kind = BookingKind.Manual,
                    IsAutoBooked = false,
                });
                bookedDesks.Add(pick.Id);
                bookedUsers.Add(user.Id);
                created++;
            }
        }

        await db.SaveChangesAsync();
        log.LogInformation("Individual-choice extras for week {Week}: {Created} bookings across {Extras} users (~{Pct:F0}% of population).",
            weekStart, created, extras.Count, extraUserFraction * 100);
        return created;
    }

    /// <summary>
    /// Picks a free desk in the team wing for <paramref name="user"/>, preferring desks
    /// that match one of their accessibility needs. Users without any need explicitly
    /// prefer the standard desks so they don't crowd out colleagues who need them.
    /// </summary>
    private static Desk? PickDeskFor(User user, List<Desk> wingDesks, HashSet<int> bookedDeskIds)
    {
        var free = wingDesks.Where(d => !bookedDeskIds.Contains(d.Id));
        return OrderByPreference(free, user)
            .ThenBy(d => d.RegionRow).ThenBy(d => d.RegionCol)
            .FirstOrDefault();
    }

    // Sort key: matching a11y → standard → non-matching a11y. We deprioritise non-
    // matching a11y desks below standard so they stay available for users who actually
    // need them (e.g. don't sit a no-need user on a treadmill desk).
    private static IOrderedEnumerable<Desk> OrderByPreference(IEnumerable<Desk> desks, User user)
    {
        var needs = user.AccessibilityNeeds;
        if (needs.Count > 0)
        {
            var needSet = needs.ToHashSet();
            return desks.OrderBy(d =>
                d.AccessibilityType is { } t && needSet.Contains(t) ? 0
                : d.AccessibilityType is null ? 1
                : 2);
        }
        // No need: standard desks first, accessibility desks last.
        return desks.OrderBy(d => d.AccessibilityType is null ? 0 : 1);
    }

    /// <summary>
    /// Looks anywhere on the team's home floor (preferring the wing) and then the
    /// whole building. Honors the user's accessibility preference at every step.
    /// </summary>
    private async Task<Desk?> FindFallbackDeskAsync(User user, int homeFloor, string homeWing, HashSet<int> bookedDeskIds)
    {
        var floorCandidates = await db.Desks
            .Where(d => d.Floor == homeFloor && !bookedDeskIds.Contains(d.Id))
            .ToListAsync();
        var floorPick = OrderForUser(floorCandidates, user, homeWing).FirstOrDefault();
        if (floorPick is not null) return floorPick;

        var anyCandidates = await db.Desks
            .Where(d => !bookedDeskIds.Contains(d.Id))
            .ToListAsync();
        return OrderForUser(anyCandidates, user, homeWing).FirstOrDefault();
    }

    private static IEnumerable<Desk> OrderForUser(IEnumerable<Desk> desks, User user, string homeWing)
    {
        return OrderByPreference(desks, user)
            .ThenBy(d => d.Region == homeWing ? 0 : 1)
            .ThenBy(d => d.Floor).ThenBy(d => d.Number);
    }
}
