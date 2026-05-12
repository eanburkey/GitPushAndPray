using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/virtual-teams")]
public class VirtualTeamsController(AppDbContext db, AutoBookerService booker) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int callerId)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();
        if (caller.Role == UserRole.Member) return Forbid();

        var query = db.VirtualTeams
            .Include(v => v.Memberships).ThenInclude(m => m.User).ThenInclude(u => u!.Team)
            .Include(v => v.CreatedBy)
            .AsQueryable();

        // Managers see only their own creations; admins see everything.
        if (caller.Role == UserRole.TeamManager)
            query = query.Where(v => v.CreatedByUserId == caller.Id);

        var list = await query.OrderByDescending(v => v.EndDate).ToListAsync();
        return Ok(list.Select(Project));
    }

    /// <summary>Virtual teams that are active on the given date — visible to anyone so the floor map can highlight them.</summary>
    [HttpGet("active")]
    public async Task<IActionResult> Active([FromQuery] DateOnly? date)
    {
        var target = date ?? DateOnly.FromDateTime(DateTime.Today);
        var list = await db.VirtualTeams
            .Include(v => v.Memberships)
            .Where(v => v.StartDate <= target && v.EndDate >= target)
            .OrderBy(v => v.Name)
            .ToListAsync();
        return Ok(list.Select(v => new
        {
            v.Id,
            v.Name,
            v.Color,
            v.HomeFloor,
            v.HomeWing,
            v.PreferredDays,
            StartDate = v.StartDate.ToString("yyyy-MM-dd"),
            EndDate = v.EndDate.ToString("yyyy-MM-dd"),
            MemberCount = v.Memberships.Count,
        }));
    }

    /// <summary>Desks booked on a given date by members of the virtual team.</summary>
    [HttpGet("{id:int}/desks")]
    public async Task<IActionResult> Desks(int id, [FromQuery] DateOnly? date)
    {
        var target = date ?? DateOnly.FromDateTime(DateTime.Today);
        var memberIds = await db.VirtualTeamMemberships
            .Where(m => m.VirtualTeamId == id)
            .Select(m => m.UserId)
            .ToListAsync();
        if (memberIds.Count == 0) return Ok(Array.Empty<object>());

        var bookings = await db.Bookings
            .Include(b => b.User)
            .Include(b => b.Desk)
            .Where(b => b.Date == target && memberIds.Contains(b.UserId))
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

    /// <summary>Candidate users a manager can add. Returns everyone so cross-team groupings are possible.</summary>
    [HttpGet("candidates")]
    public async Task<IActionResult> Candidates([FromQuery] int callerId)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();
        if (caller.Role == UserRole.Member) return Forbid();

        var users = await db.Users
            .Include(u => u.Team)
            .OrderBy(u => u.Team!.Name).ThenBy(u => u.Name)
            .ToListAsync();
        return Ok(users.Select(u => new
        {
            u.Id,
            u.Name,
            u.Email,
            u.TeamId,
            TeamName = u.Team?.Name,
            TeamColor = u.Team?.Color,
            HomeFloor = u.Team?.HomeFloor,
            HomeWing = u.Team?.HomeWing,
        }));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromQuery] int callerId, [FromBody] CreateVirtualTeamRequest body)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();
        if (caller.Role == UserRole.Member) return Forbid();

        if (string.IsNullOrWhiteSpace(body.Name)) return BadRequest("Name is required.");
        var days = DayHelpers.NormalizeTwoWeekdays(body.PreferredDays);
        if (days is null) return BadRequest("Days must be exactly two distinct weekdays from Mon-Fri.");
        if (body.EndDate < body.StartDate) return BadRequest("End date must be on or after start date.");
        var memberIds = (body.MemberIds ?? Array.Empty<int>()).Distinct().ToArray();
        if (memberIds.Length == 0) return BadRequest("Pick at least one member.");

        var members = await db.Users
            .Include(u => u.Team)
            .Where(u => memberIds.Contains(u.Id))
            .ToListAsync();
        if (members.Count != memberIds.Length) return BadRequest("One or more members not found.");

        // Reject any member who's already in another virtual team whose window overlaps ours.
        var overlap = await db.VirtualTeamMemberships
            .Include(m => m.VirtualTeam)
            .Include(m => m.User)
            .Where(m => memberIds.Contains(m.UserId)
                && m.VirtualTeam!.StartDate <= body.EndDate
                && m.VirtualTeam.EndDate >= body.StartDate)
            .ToListAsync();
        if (overlap.Count > 0)
        {
            var names = string.Join(", ", overlap.Select(m => m.User!.Name).Distinct());
            return BadRequest($"Already in an overlapping virtual team: {names}");
        }

        var (floor, wing) = PickHomeLocation(members);

        var vt = new VirtualTeam
        {
            Name = body.Name.Trim(),
            Color = "#7c3aed",
            CreatedByUserId = caller.Id,
            StartDate = body.StartDate,
            EndDate = body.EndDate,
            PreferredDays = days,
            HomeFloor = floor,
            HomeWing = wing,
            Memberships = memberIds.Select(id => new VirtualTeamMembership { UserId = id }).ToList(),
        };
        db.VirtualTeams.Add(vt);
        await db.SaveChangesAsync();

        await RebookAffectedWeeks(vt.StartDate, vt.EndDate);

        var loaded = await db.VirtualTeams
            .Include(v => v.Memberships).ThenInclude(m => m.User).ThenInclude(u => u!.Team)
            .Include(v => v.CreatedBy)
            .FirstAsync(v => v.Id == vt.Id);
        return Ok(Project(loaded));
    }

    [HttpPut("{id:int}/end-date")]
    public async Task<IActionResult> ExtendEndDate(int id, [FromQuery] int callerId, [FromBody] ExtendVirtualTeamRequest body)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();

        var vt = await db.VirtualTeams.FindAsync(id);
        if (vt is null) return NotFound();
        if (caller.Role != UserRole.Admin && vt.CreatedByUserId != caller.Id) return Forbid();
        if (body.EndDate < vt.StartDate) return BadRequest("End date must be on or after start date.");

        var oldEnd = vt.EndDate;
        vt.EndDate = body.EndDate;
        await db.SaveChangesAsync();

        // Re-run the booker over the newly-covered range (or the freed range if shortened).
        var from = oldEnd < body.EndDate ? oldEnd.AddDays(1) : body.EndDate.AddDays(1);
        var to = oldEnd < body.EndDate ? body.EndDate : oldEnd;
        await RebookAffectedWeeks(from, to);

        return Ok(new { vt.Id, StartDate = vt.StartDate.ToString("yyyy-MM-dd"), EndDate = vt.EndDate.ToString("yyyy-MM-dd") });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Disband(int id, [FromQuery] int callerId)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();

        var vt = await db.VirtualTeams.FindAsync(id);
        if (vt is null) return NotFound();
        if (caller.Role != UserRole.Admin && vt.CreatedByUserId != caller.Id) return Forbid();

        db.VirtualTeams.Remove(vt);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // ───────── Helpers ─────────
    private async Task RebookAffectedWeeks(DateOnly from, DateOnly to)
    {
        if (to < from) return;
        var weekStart = AutoBookerService.StartOfWeek(from);
        var lastWeekStart = AutoBookerService.StartOfWeek(to);
        while (weekStart <= lastWeekStart)
        {
            await booker.RunForWeekAsync(weekStart);
            weekStart = weekStart.AddDays(7);
        }
    }

    // Picks the home (floor, wing) that the largest share of members already calls home.
    // This keeps the virtual team near most of its members and lets the auto-booker fall
    // back gracefully if the wing fills up.
    private static (int floor, string wing) PickHomeLocation(List<User> members)
    {
        var byLocation = members
            .Where(u => u.Team is not null)
            .GroupBy(u => (u.Team!.HomeFloor, u.Team.HomeWing))
            .OrderByDescending(g => g.Count())
            .ThenBy(g => g.Key.HomeFloor)
            .FirstOrDefault();
        if (byLocation is null) return (1, "N");
        return (byLocation.Key.HomeFloor, byLocation.Key.HomeWing);
    }

    private static object Project(VirtualTeam v) => new
    {
        v.Id,
        v.Name,
        v.Color,
        v.HomeFloor,
        v.HomeWing,
        v.PreferredDays,
        StartDate = v.StartDate.ToString("yyyy-MM-dd"),
        EndDate = v.EndDate.ToString("yyyy-MM-dd"),
        v.CreatedByUserId,
        CreatedByName = v.CreatedBy?.Name,
        Members = v.Memberships.Select(m => new
        {
            UserId = m.UserId,
            Name = m.User?.Name,
            Email = m.User?.Email,
            TeamId = m.User?.TeamId,
            TeamName = m.User?.Team?.Name,
            TeamColor = m.User?.Team?.Color,
        }).ToList(),
    };
}
