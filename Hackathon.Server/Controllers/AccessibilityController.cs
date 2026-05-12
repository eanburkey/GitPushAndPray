using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/accessibility")]
public class AccessibilityController(AppDbContext db) : ControllerBase
{
    [HttpPut("accessibility/{id:int}/accessibility-needs")]
    public async Task<IActionResult> SetAccessibilityNeeds(int id, [FromQuery] int callerId, [FromBody] UpdateAccessibilityNeedsRequest body)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();
        if (caller.Role != UserRole.Admin && caller.Role != UserRole.TeamManager) return Forbid();

        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound();

        var parsed = new List<AccessibilityType>();
        foreach (var raw in body.Needs ?? Array.Empty<string>())
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            if (!Enum.TryParse<AccessibilityType>(raw, ignoreCase: true, out var t))
                return BadRequest($"Unknown accessibility need '{raw}'.");
            if (!parsed.Contains(t)) parsed.Add(t);
        }

        user.AccessibilityNeeds = parsed;
        await db.SaveChangesAsync();
        return Ok(new
        {
            user.Id,
            AccessibilityNeeds = user.AccessibilityNeeds.Select(t => t.ToString()).ToArray(),
        });
    }
}
