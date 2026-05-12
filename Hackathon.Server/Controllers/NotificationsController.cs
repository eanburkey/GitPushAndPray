using Hackathon.Server.Data;
using Hackathon.Server.Hubs;
using Hackathon.Server.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/notifications")]
public class NotificationsController(AppDbContext db, IHubContext<NotificationsHub> hub) : ControllerBase
{
    // Push the freshly-saved notification to its recipient's hub group so any
    // open clients can react without waiting for the next poll. Mirrors the
    // payload shape of GET /api/notifications (camelCase via the hub's JSON
    // protocol config).
    private Task PushAsync(Notification n) => hub.Clients
        .Group(NotificationsHub.GroupFor(n.UserId))
        .SendAsync("notification", new
        {
            n.Id,
            n.UserId,
            n.Message,
            n.Kind,
            n.IsRead,
            n.CreatedAt,
            n.TradeRequesterId,
            n.TradeDeskId,
            n.TradeDate,
        });

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int userId)
    {
        if (userId <= 0) return BadRequest("userId is required.");

        var items = await db.Notifications
            .Where(n => n.UserId == userId)
            .OrderByDescending(n => n.CreatedAt)
            .Take(50)
            .ToListAsync();

        return Ok(items);
    }

    [HttpPost("{id:int}/read")]
    public async Task<IActionResult> MarkRead(int id, [FromQuery] int userId)
    {
        var n = await db.Notifications.FindAsync(id);
        if (n is null) return NotFound();
        if (n.UserId != userId) return Forbid();
        n.IsRead = true;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("swap-request")]
    public async Task<IActionResult> SwapRequest([FromBody] SwapRequestPayload payload)
    {
        if (payload.FromUserId <= 0 || payload.TargetUserId <= 0)
            return BadRequest("fromUserId and targetUserId are required.");
        if (payload.FromUserId == payload.TargetUserId)
            return BadRequest("You can't request a swap with yourself.");

        var requester = await db.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Id == payload.FromUserId);
        if (requester is null) return NotFound("Requester not found.");

        var target = await db.Users.FirstOrDefaultAsync(u => u.Id == payload.TargetUserId);
        if (target is null) return NotFound("Target user not found.");

        var desk = await db.Desks.FirstOrDefaultAsync(d => d.Id == payload.DeskId);
        if (desk is null) return NotFound("Desk not found.");

        // Look up the requester's own booking on that date so the responder can
        // see exactly what they'd get in return. If the requester has nothing
        // booked that day, the request is a one-way transfer — call that out
        // explicitly so the responder knows they'd lose their seat with no
        // replacement.
        var requesterBooking = await db.Bookings
            .Include(b => b.Desk)
            .FirstOrDefaultAsync(b => b.UserId == requester.Id && b.Date == payload.Date);

        var dateLabel = payload.Date.ToDateTime(TimeOnly.MinValue).ToString("ddd, MMM d");
        var teamSuffix = requester.Team is null ? "" : $" ({requester.Team.Name})";
        var theirDesk = $"Floor {desk.Floor} · Desk {desk.Number}";
        var message = requesterBooking?.Desk is { } myDesk
            ? $"{requester.Name}{teamSuffix} would like to swap their Floor {myDesk.Floor} · Desk {myDesk.Number} booking for your {theirDesk} on {dateLabel}."
            : $"{requester.Name}{teamSuffix} has no booking on {dateLabel} and would like to take your {theirDesk}.";

        // Dedupe: don't pile up multiple unread trade notifications for the same
        // (requester, target, desk, date). If the recipient hasn't acknowledged
        // the first one yet, re-sending isn't going to make it more visible — and
        // it would let one user spam another by clicking the button repeatedly.
        var alreadySent = await db.Notifications.AnyAsync(n =>
            n.UserId == target.Id
            && n.Kind == "trade"
            && !n.IsRead
            && n.TradeRequesterId == requester.Id
            && n.TradeDeskId == desk.Id
            && n.TradeDate == payload.Date);

        if (!alreadySent)
        {
            var notif = new Notification
            {
                UserId = target.Id,
                Message = message,
                Kind = "trade",
                TradeRequesterId = requester.Id,
                TradeDeskId = desk.Id,
                TradeDate = payload.Date,
            };
            db.Notifications.Add(notif);
            await db.SaveChangesAsync();
            await PushAsync(notif);
        }

        return Ok(new SwapRequestResult(!alreadySent, alreadySent));
    }

    [HttpPost("{id:int}/respond")]
    public async Task<IActionResult> RespondSwap(int id, [FromQuery] int userId, [FromBody] SwapResponsePayload payload)
    {
        if (userId <= 0) return BadRequest("userId is required.");

        var notif = await db.Notifications.FindAsync(id);
        if (notif is null) return NotFound("Notification not found.");
        if (notif.UserId != userId) return Forbid();
        if (notif.Kind != "trade") return BadRequest("This notification isn't a swap request.");
        if (notif.IsRead) return BadRequest("This swap request has already been handled.");
        if (notif.TradeRequesterId is null || notif.TradeDeskId is null || notif.TradeDate is null)
            return BadRequest("This swap request is missing context and can't be acted on.");

        var requester = await db.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Id == notif.TradeRequesterId.Value);
        if (requester is null) return BadRequest("The requester no longer exists.");

        var responder = await db.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Id == userId);
        if (responder is null) return BadRequest("Responder not found.");

        var deskId = notif.TradeDeskId.Value;
        var date = notif.TradeDate.Value;
        var dateLabel = date.ToDateTime(TimeOnly.MinValue).ToString("ddd, MMM d");

        if (!payload.Accept)
        {
            var deniedDesk = await db.Desks.FindAsync(deskId);
            notif.IsRead = true;
            var declined = new Notification
            {
                UserId = requester.Id,
                Kind = "trade-declined",
                Message = $"{responder.Name} declined your swap request for Floor {deniedDesk?.Floor} · Desk {deniedDesk?.Number} on {dateLabel}.",
            };
            db.Notifications.Add(declined);
            await db.SaveChangesAsync();
            await PushAsync(declined);
            return Ok(new SwapResponseResult(true, false, null));
        }

        // Accept path. The responder's booking for the desk on that date is what
        // gets transferred to the requester. If the requester also has a booking
        // somewhere on that date, we swap them; otherwise it's a one-way transfer
        // and the responder loses their seat for the day.
        var responderBooking = await db.Bookings
            .Include(b => b.Desk)
            .FirstOrDefaultAsync(b => b.DeskId == deskId && b.Date == date && b.UserId == responder.Id);
        if (responderBooking is null)
        {
            notif.IsRead = true;
            await db.SaveChangesAsync();
            return BadRequest("Your booking for that desk is no longer there — nothing to swap.");
        }

        var requesterBooking = await db.Bookings
            .Include(b => b.Desk)
            .FirstOrDefaultAsync(b => b.UserId == requester.Id && b.Date == date);

        var requestedDesk = responderBooking.Desk!;
        var gaveUpDesk = requesterBooking?.Desk;

        if (requesterBooking is not null)
        {
            // True swap. Both bookings exist on the same date — flip user IDs.
            responderBooking.UserId = requester.Id;
            requesterBooking.UserId = responder.Id;
        }
        else
        {
            // One-way transfer. Responder gives up their seat.
            responderBooking.UserId = requester.Id;
        }

        notif.IsRead = true;

        var acceptedMsg = gaveUpDesk is null
            ? $"{responder.Name} accepted your swap — you now have Floor {requestedDesk.Floor} · Desk {requestedDesk.Number} on {dateLabel}."
            : $"{responder.Name} accepted your swap — you now have Floor {requestedDesk.Floor} · Desk {requestedDesk.Number} on {dateLabel} (they took Floor {gaveUpDesk.Floor} · Desk {gaveUpDesk.Number}).";

        var accepted = new Notification
        {
            UserId = requester.Id,
            Kind = "trade-accepted",
            Message = acceptedMsg,
            TradeDeskId = requestedDesk.Id,
            TradeDate = date,
        };
        db.Notifications.Add(accepted);

        await db.SaveChangesAsync();
        await PushAsync(accepted);

        return Ok(new SwapResponseResult(true, true, gaveUpDesk is not null));
    }

    [HttpPost("broadcast-to-floor")]
    public async Task<IActionResult> BroadcastToFloor([FromBody] FloorBroadcastPayload payload)
    {
        if (payload.CallerId <= 0) return BadRequest("callerId is required.");
        if (payload.Floor <= 0) return BadRequest("floor is required.");
        var message = payload.Message?.Trim();
        if (string.IsNullOrEmpty(message)) return BadRequest("message is required.");
        if (message.Length > 500) return BadRequest("message is too long (max 500 characters).");

        var caller = await db.Users.FindAsync(payload.CallerId);
        if (caller is null) return NotFound("Caller not found.");
        if (caller.Role != UserRole.Admin && caller.Role != UserRole.TeamManager)
            return Forbid();

        // "Everyone on the floor" = members of any team whose home is that floor.
        // The sender is excluded so they don't ping themselves.
        var recipientIds = await db.Users
            .Where(u => u.Id != caller.Id && u.Team != null && u.Team.HomeFloor == payload.Floor)
            .Select(u => u.Id)
            .ToListAsync();

        if (recipientIds.Count == 0)
            return Ok(new FloorBroadcastResult(0));

        var notifications = recipientIds
            .Select(uid => new Notification
            {
                UserId = uid,
                Message = message,
                Kind = "announcement",
            })
            .ToList();

        db.Notifications.AddRange(notifications);
        await db.SaveChangesAsync();

        foreach (var n in notifications)
            await PushAsync(n);

        return Ok(new FloorBroadcastResult(notifications.Count));
    }
}

public record SwapRequestResult(bool Sent, bool AlreadySent);

public record SwapRequestPayload(int FromUserId, int TargetUserId, int DeskId, DateOnly Date);

public record SwapResponsePayload(bool Accept);

public record SwapResponseResult(bool Ok, bool Accepted, bool? Swapped);

public record FloorBroadcastPayload(int CallerId, int Floor, string Message);

public record FloorBroadcastResult(int Sent);
