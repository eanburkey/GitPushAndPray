using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Services;

// Latest allowed auto-checkout time. Users can't set anything past this; the
// suggestion algorithm also clamps to it. Kept in one place so the UI cap and
// the server cap stay aligned.
public static class AutoCheckout
{
    public static readonly TimeOnly MaxTime = new(10, 30);
    public const string MaxTimeLabel = "10:30";
    // Fallback when a user has no value stored yet. Matching the max means
    // a never-touched account still releases its desk by mid-morning.
    public static readonly TimeOnly DefaultTime = MaxTime;

    public static bool TryParse(string? raw, out TimeOnly time)
    {
        time = default;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        return TimeOnly.TryParse(raw.Trim(), out time);
    }

    public static string Format(TimeOnly t) => t.ToString("HH:mm");

    public static TimeOnly Effective(TimeOnly? stored) => stored ?? DefaultTime;
}

public record CheckoutSuggestion(string? SuggestedTime, int SampleSize, string? TypicalArrivalTime);

public class AutoCheckoutService(AppDbContext db, ILogger<AutoCheckoutService> log)
{
    // Looks at the user's last ~20 arrival records and proposes a sensible
    // auto-checkout time: the latest of their typical arrivals plus a 15-minute
    // buffer, rounded up to the next 5-minute mark, capped at the global max.
    // Returns nulls when there isn't enough history to make a confident call.
    public async Task<CheckoutSuggestion> SuggestForUserAsync(int userId)
    {
        var recent = await db.Arrivals
            .Where(a => a.UserId == userId)
            .OrderByDescending(a => a.Date)
            .Take(20)
            .Select(a => a.ArrivedAt)
            .ToListAsync();

        if (recent.Count < 3)
        {
            return new CheckoutSuggestion(null, recent.Count, null);
        }

        // Mean for the "typical" display value; max for the proposed cutoff so
        // we don't accidentally check out users who occasionally arrive on the
        // late side of their normal range.
        var meanMinutes = (int)Math.Round(recent.Average(t => t.Hour * 60 + t.Minute));
        var maxMinutes = recent.Max(t => t.Hour * 60 + t.Minute);

        int proposed = maxMinutes + 15;
        // Round up to the next 5-minute mark.
        proposed = (int)Math.Ceiling(proposed / 5.0) * 5;

        var maxAllowed = AutoCheckout.MaxTime.Hour * 60 + AutoCheckout.MaxTime.Minute;
        if (proposed > maxAllowed) proposed = maxAllowed;

        var suggested = new TimeOnly(proposed / 60, proposed % 60);
        var typical = new TimeOnly(meanMinutes / 60, meanMinutes % 60);
        return new CheckoutSuggestion(AutoCheckout.Format(suggested), recent.Count, AutoCheckout.Format(typical));
    }

    // Records (or upserts) the user's arrival for the given date. Returns the
    // stored arrival time so the client can show "checked in at HH:mm".
    public async Task<TimeOnly> RecordArrivalAsync(int userId, DateOnly date)
    {
        var existing = await db.Arrivals.FirstOrDefaultAsync(a => a.UserId == userId && a.Date == date);
        var now = TimeOnly.FromDateTime(DateTime.Now);
        if (existing is not null)
        {
            // First-of-day wins: don't overwrite an earlier arrival time when the
            // user opens the app again later on the same day.
            return existing.ArrivedAt;
        }
        db.Arrivals.Add(new ArrivalRecord
        {
            UserId = userId,
            Date = date,
            ArrivedAt = now,
        });
        await db.SaveChangesAsync();
        return now;
    }

    // Cancels today's bookings for any user with an auto-checkout time who has
    // passed that time without recording an arrival. Returns the number of
    // bookings released so the caller can log/report.
    public async Task<int> RunSweepAsync(DateTime? nowOverride = null)
    {
        var now = nowOverride ?? DateTime.Now;
        var today = DateOnly.FromDateTime(now);
        var nowTime = TimeOnly.FromDateTime(now);

        var arrivedUserIds = await db.Arrivals
            .Where(a => a.Date == today)
            .Select(a => a.UserId)
            .ToListAsync();
        var arrivedSet = arrivedUserIds.ToHashSet();

        var candidates = await db.Bookings
            .Include(b => b.Desk)
            .Include(b => b.User)
            .Where(b => b.Date == today)
            .ToListAsync();

        int released = 0;
        foreach (var booking in candidates)
        {
            var user = booking.User;
            if (user is null) continue;
            if (arrivedSet.Contains(user.Id)) continue;

            var cutoff = AutoCheckout.Effective(user.AutoCheckoutTime);
            if (nowTime < cutoff) continue;

            db.Bookings.Remove(booking);
            db.Notifications.Add(new Notification
            {
                UserId = user.Id,
                Kind = "auto-checkout",
                Message = booking.Desk is null
                    ? $"Your desk for today was auto-released at {AutoCheckout.Format(cutoff)} because you hadn't checked in."
                    : $"Your desk for today (Floor {booking.Desk.Floor}, Desk {booking.Desk.Number}) was auto-released at {AutoCheckout.Format(cutoff)} because you hadn't checked in.",
            });
            released++;
        }

        if (released > 0)
        {
            await db.SaveChangesAsync();
            log.LogInformation("Auto-checkout sweep at {Now}: released {Count} bookings.", now, released);
        }
        return released;
    }
}

// Polls every minute and releases any bookings whose owner has passed their
// auto-checkout time without checking in. One-minute granularity is plenty —
// the cutoff is user-set and the demo doesn't need sub-minute precision.
public class AutoCheckoutHostedService(IServiceProvider services, ILogger<AutoCheckoutHostedService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = services.CreateScope();
                var svc = scope.ServiceProvider.GetRequiredService<AutoCheckoutService>();
                await svc.RunSweepAsync();
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Auto-checkout sweep failed");
            }
            try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); }
            catch (TaskCanceledException) { return; }
        }
    }
}
