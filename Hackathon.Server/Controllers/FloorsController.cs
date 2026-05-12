using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/floors")]
public class FloorsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> ListFloors()
    {
        var floorsRaw = await db.Desks
            .GroupBy(d => d.Floor)
            .Select(g => new { Floor = g.Key, DeskCount = g.Count() })
            .OrderBy(f => f.Floor)
            .ToListAsync();
        return Ok(floorsRaw);
    }

    [HttpGet("layout")]
    public IActionResult Layout()
    {
        // Static description of the floor plan so the frontend can render the building.
        return Ok(FloorLayout.All.Select(r => new
        {
            r.Code,
            r.Label,
            r.Rows,
            r.Cols,
        }));
    }

    [HttpGet("{floor:int}/desks")]
    public async Task<IActionResult> GetFloorDesks(int floor, [FromQuery] DateOnly? date)
    {
        var target = date ?? DateOnly.FromDateTime(DateTime.Today);

        var desks = await db.Desks
            .Where(d => d.Floor == floor)
            .OrderBy(d => d.Number)
            .ToListAsync();

        var deskIds = desks.Select(d => d.Id).ToHashSet();
        var bookings = await db.Bookings
            .Include(b => b.User).ThenInclude(u => u!.Team)
            .Where(b => b.Date == target && deskIds.Contains(b.DeskId))
            .ToListAsync();
        var byDesk = bookings.ToDictionary(b => b.DeskId);

        var result = desks.Select(d =>
        {
            byDesk.TryGetValue(d.Id, out var booking);
            return new
            {
                d.Id,
                d.Floor,
                d.Number,
                d.Region,
                d.RegionRow,
                d.RegionCol,
                AccessibilityType = d.AccessibilityType?.ToString(),
                d.IsBookable,
                Booked = booking is not null,
                BookedBy = booking is null ? null : new
                {
                    booking.UserId,
                    Name = booking.User!.Name,
                    Initials = booking.User.Initials,
                    Email = booking.User.Email,
                    TeamName = booking.User.Team!.Name,
                    TeamColor = booking.User.Team.Color,
                    Kind = booking.Kind.ToString(),
                    booking.IsAutoBooked,
                },
            };
        });

        return Ok(result);
    }

    [HttpPatch("desks/{deskId:int}/bookable")]
    public async Task<IActionResult> SetDeskBookable(int deskId, [FromQuery] int callerId, [FromBody] SetBookableRequest body)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();
        if (caller.Role != UserRole.Admin) return Forbid();

        var desk = await db.Desks.FindAsync(deskId);
        if (desk is null) return NotFound();

        desk.IsBookable = body.IsBookable;
        await db.SaveChangesAsync();
        return Ok(new { desk.Id, desk.IsBookable });
    }
}

public record SetBookableRequest(bool IsBookable);
