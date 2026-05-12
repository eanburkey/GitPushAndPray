using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/trades")]
public class TradesController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? status)
    {
        var query = db.Trades
            .Include(t => t.Requester).ThenInclude(u => u!.Team)
            .Include(t => t.OfferedBooking)!.ThenInclude(b => b!.Desk)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<TradeStatus>(status, true, out var parsed))
        {
            query = query.Where(t => t.Status == parsed);
        }

        var trades = await query.OrderByDescending(t => t.CreatedAt).ToListAsync();
        return Ok(trades.Select(Project));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromQuery] int userId, [FromBody] TradeCreateRequest request)
    {
        if (userId <= 0) return BadRequest("userId is required.");
        if (!BookingWindow.IsBookable(request.Date)) return BadRequest(BookingWindow.RejectionReason);

        if (request.OfferedBookingId is int bid)
        {
            var booking = await db.Bookings.FindAsync(bid);
            if (booking is null) return NotFound("Offered booking not found.");
            if (booking.UserId != userId) return Forbid();
        }

        var trade = new TradeRequest
        {
            RequesterId = userId,
            Date = request.Date,
            OfferedBookingId = request.OfferedBookingId,
            DesiredFloor = request.DesiredFloor,
            DesiredZone = request.DesiredZone,
            Note = request.Note,
            Status = TradeStatus.Open,
        };
        db.Trades.Add(trade);
        await db.SaveChangesAsync();
        return Ok(await HydrateAsync(trade.Id));
    }

    [HttpPost("{id:int}/accept")]
    public async Task<IActionResult> Accept(int id, [FromQuery] int userId, [FromBody] TradeAcceptRequest request)
    {
        var trade = await db.Trades.FindAsync(id);
        if (trade is null) return NotFound();
        if (trade.Status != TradeStatus.Open) return BadRequest("Trade is no longer open.");
        if (trade.RequesterId == userId) return BadRequest("You can't accept your own trade.");

        if (trade.OfferedBookingId is int offeredId)
        {
            var offered = await db.Bookings.FindAsync(offeredId);
            if (offered is null) return BadRequest("Offered booking no longer exists.");
            offered.UserId = userId;
        }

        if (request.CounterBookingId is int counterId)
        {
            var counter = await db.Bookings.FindAsync(counterId);
            if (counter is null) return BadRequest("Counter booking not found.");
            if (counter.UserId != userId) return Forbid();
            counter.UserId = trade.RequesterId;
        }

        trade.Status = TradeStatus.Accepted;
        trade.AcceptedByUserId = userId;
        await db.SaveChangesAsync();

        return Ok(await HydrateAsync(trade.Id));
    }

    [HttpPost("{id:int}/cancel")]
    public async Task<IActionResult> Cancel(int id, [FromQuery] int userId)
    {
        var trade = await db.Trades.FindAsync(id);
        if (trade is null) return NotFound();
        if (trade.RequesterId != userId) return Forbid();
        if (trade.Status != TradeStatus.Open) return BadRequest("Already resolved.");
        trade.Status = TradeStatus.Cancelled;
        await db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<object> HydrateAsync(int id)
    {
        var trade = await db.Trades
            .Include(t => t.Requester).ThenInclude(u => u!.Team)
            .Include(t => t.OfferedBooking)!.ThenInclude(b => b!.Desk)
            .FirstAsync(t => t.Id == id);
        return Project(trade);
    }

    private static object Project(TradeRequest t) => new
    {
        t.Id,
        Requester = t.Requester is null ? null : AuthController.Project(t.Requester),
        t.Date,
        t.OfferedBookingId,
        OfferedDesk = t.OfferedBooking?.Desk,
        OfferedDate = t.OfferedBooking?.Date,
        t.DesiredFloor,
        t.DesiredZone,
        t.Note,
        Status = t.Status.ToString(),
        t.CreatedAt,
    };
}
