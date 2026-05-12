using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/admin")]
public class AdminController(AppDbContext db) : ControllerBase
{
    [HttpGet("day-planner")]
    public async Task<IActionResult> DayPlanner([FromQuery] int callerId)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();
        if (caller.Role != UserRole.Admin) return Forbid();

        var teams = await db.Teams
            .Include(t => t.Members)
            .Include(t => t.Manager)
            .OrderByDescending(t => t.Members.Count)
            .ThenBy(t => t.Name)
            .ToListAsync();

        var suggestions = ComputeSuggestions(teams);

        int totalPersonDays = teams.Sum(t => t.Members.Count) * 2;
        double targetPerDay = totalPersonDays / 5.0;

        var assignedLoad = new int[5];
        var suggestedLoad = new int[5];
        var requestedLoad = new int[5];

        foreach (var team in teams)
        {
            foreach (var d in DayHelpers.ParseIndices(team.PreferredDays)) assignedLoad[d] += team.Members.Count;
            foreach (var d in DayHelpers.ParseIndices(team.RequestedDays)) requestedLoad[d] += team.Members.Count;
        }
        foreach (var (teamId, suggestedDays) in suggestions)
        {
            var team = teams.First(t => t.Id == teamId);
            foreach (var d in suggestedDays) suggestedLoad[d] += team.Members.Count;
        }

        var days = DayHelpers.Weekdays.Select((code, i) => new
        {
            Code = code,
            AssignedHeadcount = assignedLoad[i],
            RequestedHeadcount = requestedLoad[i],
            SuggestedHeadcount = suggestedLoad[i],
        }).ToList();

        var teamRows = teams.OrderBy(t => t.Name).Select(t => new
        {
            t.Id,
            t.Name,
            t.Color,
            t.HomeFloor,
            t.HomeWing,
            MemberCount = t.Members.Count,
            ManagerUserId = t.ManagerUserId,
            ManagerName = t.Manager?.Name,
            ManagerEmail = t.Manager?.Email,
            t.PreferredDays,
            t.RequestedDays,
            SuggestedDays = string.Join(",", suggestions[t.Id].Select(i => DayHelpers.Weekdays[i])),
        }).ToList();

        return Ok(new
        {
            TotalPeople = teams.Sum(t => t.Members.Count),
            TargetPerDay = Math.Round(targetPerDay, 1),
            Days = days,
            Teams = teamRows,
        });
    }

    [HttpPut("teams/{id:int}/assigned-days")]
    public async Task<IActionResult> SetAssignedDays(int id, [FromQuery] int callerId, [FromBody] UpdateDaysRequest body)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();
        if (caller.Role != UserRole.Admin) return Forbid();

        var team = await db.Teams.FindAsync(id);
        if (team is null) return NotFound();

        var normalized = DayHelpers.NormalizeTwoWeekdays(body.Days);
        if (normalized is null) return BadRequest("Days must be exactly two distinct weekdays from Mon-Fri.");

        team.PreferredDays = normalized;
        // If the manager's request matches what we just approved, clear it — it's no longer "pending".
        if (team.RequestedDays == normalized) team.RequestedDays = null;

        await db.SaveChangesAsync();
        return Ok(new { team.Id, team.PreferredDays, team.RequestedDays });
    }

    /// <summary>Apply the auto-balanced suggestion to every team in one go.</summary>
    [HttpPost("apply-suggestion")]
    public async Task<IActionResult> ApplySuggestion([FromQuery] int callerId)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();
        if (caller.Role != UserRole.Admin) return Forbid();

        var teams = await db.Teams.Include(t => t.Members).ToListAsync();
        var suggestions = ComputeSuggestions(
            teams.OrderByDescending(t => t.Members.Count).ThenBy(t => t.Name).ToList());

        foreach (var team in teams)
        {
            var assigned = string.Join(",", suggestions[team.Id].Select(i => DayHelpers.Weekdays[i]));
            team.PreferredDays = assigned;
            if (team.RequestedDays == assigned) team.RequestedDays = null;
        }
        await db.SaveChangesAsync();
        return Ok(new { Updated = teams.Count });
    }

    /// <summary>
    /// Greedy balancer: walk teams largest-first; honor manager requests when both days
    /// fit under target + slack; otherwise pick the two lowest-load days.
    /// </summary>
    private static Dictionary<int, List<int>> ComputeSuggestions(List<Team> teamsLargestFirst)
    {
        int totalPersonDays = teamsLargestFirst.Sum(t => t.Members.Count) * 2;
        double target = totalPersonDays / 5.0;
        double slack = target * 0.25; // 25% over target is the cap for honoring requests

        var load = new int[5];
        var result = new Dictionary<int, List<int>>();

        foreach (var team in teamsLargestFirst)
        {
            var size = team.Members.Count;
            var requested = DayHelpers.ParseIndices(team.RequestedDays);
            var assign = new List<int>();

            if (requested.Count == 2 && requested.All(d => load[d] + size <= target + slack))
            {
                assign.AddRange(requested);
            }
            else
            {
                // Partially honor requests: take each requested day that still fits.
                foreach (var d in requested)
                {
                    if (assign.Count == 2) break;
                    if (load[d] + size <= target + slack) assign.Add(d);
                }
                // Fill remaining slots with the lowest-load days.
                foreach (var d in Enumerable.Range(0, 5).OrderBy(d => load[d]))
                {
                    if (assign.Count == 2) break;
                    if (!assign.Contains(d)) assign.Add(d);
                }
            }

            assign.Sort();
            foreach (var d in assign) load[d] += size;
            result[team.Id] = assign;
        }

        return result;
    }
}
