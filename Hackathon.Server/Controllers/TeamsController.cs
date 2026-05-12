using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/teams")]
public class TeamsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var teams = await db.Teams.Include(t => t.Members).OrderBy(t => t.Name).ToListAsync();
        return Ok(teams.Select(t => new
        {
            t.Id,
            t.Name,
            t.Color,
            t.HomeFloor,
            t.HomeWing,
            t.PreferredDays,
            t.RequestedDays,
            t.ManagerUserId,
            MemberCount = t.Members.Count,
        }));
    }

    /// <summary>Manager submits a 2-day preference for one of the teams they manage.</summary>
    [HttpPut("{id:int}/requested-days")]
    public async Task<IActionResult> RequestDays(int id, [FromQuery] int callerId, [FromBody] UpdateDaysRequest body)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();

        var team = await db.Teams.FindAsync(id);
        if (team is null) return NotFound();

        var isAdmin = caller.Role == UserRole.Admin;
        var isManagerOfTeam = caller.Role == UserRole.TeamManager && team.ManagerUserId == caller.Id;
        if (!isAdmin && !isManagerOfTeam) return Forbid();

        var normalized = DayHelpers.NormalizeTwoWeekdays(body.Days);
        if (normalized is null) return BadRequest("Days must be exactly two distinct weekdays from Mon-Fri.");

        team.RequestedDays = normalized;
        await db.SaveChangesAsync();
        return Ok(new { team.Id, team.RequestedDays, team.PreferredDays });
    }

    [HttpGet("with-bookings")]
    public async Task<IActionResult> TeamsWithBookings([FromQuery] DateOnly? date)
    {
        var target = date ?? DateOnly.FromDateTime(DateTime.Today);
        var ids = await db.Bookings
            .Where(b => b.Date == target)
            .Select(b => b.User!.TeamId)
            .Distinct()
            .ToListAsync();
        return Ok(ids);
    }

    [HttpGet("{id:int}/desks")]
    public async Task<IActionResult> TeamDesks(int id, [FromQuery] DateOnly? date)
    {
        var target = date ?? DateOnly.FromDateTime(DateTime.Today);

        var bookings = await db.Bookings
            .Include(b => b.User)
            .Include(b => b.Desk)
            .Where(b => b.Date == target && b.User!.TeamId == id)
            .ToListAsync();

        return Ok(bookings.Select(b => new
        {
            DeskId = b.DeskId,
            Floor = b.Desk!.Floor,
            Number = b.Desk.Number,
            Region = b.Desk.Region,
            UserId = b.UserId,
            UserName = b.User!.Name,
        }));
    }
}
