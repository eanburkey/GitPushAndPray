using Hackathon.Server.Data;
using Hackathon.Server.Hubs;
using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});
builder.Services.AddSignalR().AddJsonProtocol(o =>
{
    o.PayloadSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});
builder.Services.AddOpenApi();

var dbPath = Path.Combine(builder.Environment.ContentRootPath, "intelliDesk.db");
builder.Services.AddDbContext<AppDbContext>(opt => opt.UseSqlite($"Data Source={dbPath}"));
builder.Services.AddScoped<AutoBookerService>();
builder.Services.AddScoped<AutoCheckoutService>();
builder.Services.AddHostedService<AutoCheckoutHostedService>();

var app = builder.Build();

// Seed on startup, then run the auto-booker for the current and next weeks
// so the demo opens with a populated floor. The auto-booker is gated on the
// week being empty so a re-seed (or any other path that leaves bookings intact)
// doesn't double-book or repeat the expensive startup pass.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    DbSeeder.EnsureSeeded(db);

    var booker = scope.ServiceProvider.GetRequiredService<AutoBookerService>();
    var today = DateOnly.FromDateTime(DateTime.Today);
    var thisWeek = AutoBookerService.StartOfWeek(today);
    var nextWeek = thisWeek.AddDays(7);

    var expectedFloorsWithTeams = await db.Teams.Select(t => t.HomeFloor).Distinct().CountAsync();

    async Task PopulateWeekIfEmpty(DateOnly weekStart)
    {
        var weekEnd = weekStart.AddDays(6);

        // A complete auto-book covers every floor that has a team (every team books on
        // at least one weekday). If we see bookings but not on every team-floor, a
        // previous run crashed partway through — wipe the bad partial state so we
        // can re-run cleanly instead of being stuck looking healthy-but-empty.
        var floorsBookedThisWeek = await db.Bookings
            .Where(b => b.Date >= weekStart && b.Date <= weekEnd)
            .Join(db.Desks, b => b.DeskId, d => d.Id, (_, d) => d.Floor)
            .Distinct()
            .CountAsync();

        // Additional liveness check: if today falls in this week and is a weekday,
        // today must have bookings. An earlier auto-checkout sweep run could have
        // wiped today's seeded bookings before today's arrivals were also seeded,
        // leaving the rest of the week populated but today empty — that state used
        // to look "healthy" to the gate below.
        var todayIsInThisWeek = today >= weekStart && today <= weekEnd
            && today.DayOfWeek != DayOfWeek.Saturday && today.DayOfWeek != DayOfWeek.Sunday;
        var todayHasBookings = !todayIsInThisWeek
            || await db.Bookings.AnyAsync(b => b.Date == today);

        if (floorsBookedThisWeek > 0 && floorsBookedThisWeek == expectedFloorsWithTeams && todayHasBookings)
        {
            return; // already fully populated
        }

        if (floorsBookedThisWeek > 0)
        {
            // Partial seed detected — clean it out so the auto-booker has a fresh slate.
            // Notifications for displaced manual bookings are kept (they're harmless and
            // there are no manual bookings to displace on a fresh DB anyway).
            var stale = await db.Bookings
                .Where(b => b.Date >= weekStart && b.Date <= weekEnd)
                .ToListAsync();
            db.Bookings.RemoveRange(stale);
            await db.SaveChangesAsync();
            app.Logger.LogWarning("Detected partially-seeded week {Week} ({Floors}/{Expected} floors). Wiped {Count} bookings and re-running.",
                weekStart, floorsBookedThisWeek, expectedFloorsWithTeams, stale.Count);
        }

        // Wrap the per-team SaveChanges calls in one transaction so a crash mid-week
        // rolls back atomically. The auto-booker's intra-week SaveChanges are still
        // visible to its own subsequent queries because they share this connection;
        // they just don't commit to disk until we commit the outer transaction.
        await using var tx = await db.Database.BeginTransactionAsync();
        try
        {
            await booker.RunForWeekAsync(weekStart);
            await booker.AddIndividualChoiceBookingsAsync(weekStart);
            await tx.CommitAsync();
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    await PopulateWeekIfEmpty(thisWeek);
    await PopulateWeekIfEmpty(nextWeek);

    // Demo seasoning: simulate "most people have already badged in by now" so the
    // auto-checkout sweep (which kicks in seconds after startup) doesn't wipe the
    // seeded floor map before anyone can see it. ~95% of users with a booking
    // today get a today-arrival; the rest stay as realistic no-shows so the
    // feature still has something to release for the demo.
    if (today.DayOfWeek != DayOfWeek.Saturday && today.DayOfWeek != DayOfWeek.Sunday)
    {
        var hasTodayArrivals = await db.Arrivals.AnyAsync(a => a.Date == today);
        if (!hasTodayArrivals)
        {
            var bookedToday = await db.Bookings
                .Where(b => b.Date == today)
                .Select(b => b.UserId)
                .Distinct()
                .ToListAsync();
            if (bookedToday.Count > 0)
            {
                var rng = new Random(today.DayNumber);
                var nowMinutes = DateTime.Now.Hour * 60 + DateTime.Now.Minute;
                var seeded = new List<ArrivalRecord>();
                foreach (var uid in bookedToday)
                {
                    if (rng.Next(20) == 0) continue; // ~5% no-shows
                    // Arrival between 08:00 and 10:15, but never in the future
                    // — a "future" arrival would look wrong on the user profile.
                    int target = 8 * 60 + rng.Next(0, 136);
                    int minutes = Math.Min(target, Math.Max(8 * 60, nowMinutes - 5));
                    seeded.Add(new ArrivalRecord
                    {
                        UserId = uid,
                        Date = today,
                        ArrivedAt = new TimeOnly(minutes / 60, minutes % 60),
                    });
                }
                db.Arrivals.AddRange(seeded);
                await db.SaveChangesAsync();
                app.Logger.LogInformation("Seeded {Count} arrivals for {Date} to preserve demo bookings against the auto-checkout sweep.", seeded.Count, today);
            }
        }
    }
}

app.UseDefaultFiles();
app.MapStaticAssets();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference(o => o
        .WithTitle("IntelliDesk API")
        .WithTheme(ScalarTheme.BluePlanet));
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();
app.MapHub<NotificationsHub>("/hubs/notifications");
app.MapFallbackToFile("/index.html");

app.Run();
