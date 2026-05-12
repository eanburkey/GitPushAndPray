using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/bookings")]
public class BookingsController(AppDbContext db, AutoCheckoutService checkout) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> MyBookings([FromQuery] int userId)
    {
        if (userId <= 0) return BadRequest("userId is required.");

        var bookings = await db.Bookings
            .Include(b => b.Desk)
            .Where(b => b.UserId == userId)
            .OrderBy(b => b.Date)
            .ToListAsync();

        return Ok(bookings.Select(Project));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromQuery] int userId, [FromBody] BookingRequest request)
    {
        if (userId <= 0) return BadRequest("userId is required.");
        if (!BookingWindow.IsBookable(request.Date)) return BadRequest(BookingWindow.RejectionReason);

        var desk = await db.Desks.FindAsync(request.DeskId);
        if (desk is null) return NotFound("Desk not found.");
        if (!desk.IsBookable) return BadRequest("This desk is not available for booking.");

        var exists = await db.Bookings.AnyAsync(b => b.DeskId == desk.Id && b.Date == request.Date);
        if (exists) return Conflict("Desk already booked for that date.");

        // Manual bookings always start as Manual; the auto-booker upgrades them to Mandatory
        // when they fall on the team's day. We surface a warning when the user is already at
        // 2 bookings this week so they know the 3rd+ may be displaced.
        var weekStart = AutoBookerService.StartOfWeek(request.Date);
        var weekEnd = weekStart.AddDays(4);
        var countThisWeek = await db.Bookings.CountAsync(b =>
            b.UserId == userId && b.Date >= weekStart && b.Date <= weekEnd);

        var booking = new Booking
        {
            DeskId = desk.Id,
            UserId = userId,
            Date = request.Date,
            Kind = BookingKind.Manual,
            IsAutoBooked = false,
        };
        db.Bookings.Add(booking);
        await db.SaveChangesAsync();
        await db.Entry(booking).Reference(b => b.Desk).LoadAsync();

        return Ok(new
        {
            Booking = Project(booking),
            IsOverMandatory = countThisWeek >= 2,
            Warning = countThisWeek >= 2
                ? "This is your 3rd+ day in office this week. It's optional, so it may be displaced by team auto-bookings."
                : null,
        });
    }

    [HttpPost("check-in")]
    public async Task<IActionResult> CheckIn([FromQuery] int userId)
    {
        if (userId <= 0) return BadRequest("userId is required.");
        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound("User not found.");

        var today = DateOnly.FromDateTime(DateTime.Today);
        var hasBooking = await db.Bookings.AnyAsync(b => b.UserId == userId && b.Date == today);
        if (!hasBooking) return BadRequest("You don't have a desk booked for today.");

        var arrivedAt = await checkout.RecordArrivalAsync(userId, today);
        return Ok(new
        {
            Date = today,
            ArrivedAt = arrivedAt.ToString("HH:mm"),
        });
    }

    [HttpGet("check-in-status")]
    public async Task<IActionResult> CheckInStatus([FromQuery] int userId)
    {
        if (userId <= 0) return BadRequest("userId is required.");
        var today = DateOnly.FromDateTime(DateTime.Today);
        var arrival = await db.Arrivals.FirstOrDefaultAsync(a => a.UserId == userId && a.Date == today);
        return Ok(new
        {
            CheckedIn = arrival is not null,
            ArrivedAt = arrival is null ? null : arrival.ArrivedAt.ToString("HH:mm"),
        });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Cancel(int id, [FromQuery] int userId)
    {
        var booking = await db.Bookings.FindAsync(id);
        if (booking is null) return NotFound();
        if (booking.UserId != userId) return Forbid();
        db.Bookings.Remove(booking);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static object Project(Booking b) => new
    {
        b.Id,
        b.Date,
        Kind = b.Kind.ToString(),
        b.IsAutoBooked,
        Desk = b.Desk is null ? null : new
        {
            b.Desk.Id,
            b.Desk.Floor,
            b.Desk.Number,
            b.Desk.Region,
            AccessibilityType = b.Desk.AccessibilityType?.ToString(),
        },
    };
}
