using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/users")]
public class UsersController(AppDbContext db, AutoCheckoutService checkout) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] int callerId)
    {
        var caller = await db.Users.FindAsync(callerId);
        if (caller is null) return Unauthorized();
        if (caller.Role != UserRole.Admin && caller.Role != UserRole.TeamManager) return Forbid();

        var users = await db.Users
            .Include(u => u.Team)
            .OrderBy(u => u.Team!.Name)
            .ThenBy(u => u.Name)
            .ToListAsync();

        return Ok(users.Select(u => new
        {
            u.Id,
            u.Email,
            u.Name,
            u.TeamId,
            TeamName = u.Team?.Name,
            TeamColor = u.Team?.Color,
            Role = u.Role.ToString(),
            AccessibilityNeeds = u.AccessibilityNeeds.Select(t => t.ToString()).ToArray(),
            u.IsAutoBookingEnabled,
        }));
    }

    public record AutoBookingPrefRequest(bool Enabled);

    [HttpPut("{userId:int}/auto-booking")]
    public async Task<IActionResult> SetAutoBooking(int userId, [FromBody] AutoBookingPrefRequest body)
    {
        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound("User not found.");

        user.IsAutoBookingEnabled = body.Enabled;
        await db.SaveChangesAsync();

        return Ok(new { user.Id, user.IsAutoBookingEnabled });
    }

    [HttpPut("{userId:int}/auto-checkout-time")]
    public async Task<IActionResult> SetAutoCheckoutTime(int userId, [FromBody] AutoCheckoutTimeRequest body)
    {
        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound("User not found.");

        if (!AutoCheckout.TryParse(body.Time, out var parsed))
            return BadRequest("Time must be in HH:mm format.");
        if (parsed > AutoCheckout.MaxTime)
            return BadRequest($"Auto-checkout time can't be later than {AutoCheckout.MaxTimeLabel}.");

        user.AutoCheckoutTime = parsed;
        await db.SaveChangesAsync();
        return Ok(new
        {
            user.Id,
            AutoCheckoutTime = AutoCheckout.Format(parsed),
        });
    }

    [HttpGet("{userId:int}/auto-checkout-suggestion")]
    public async Task<IActionResult> GetAutoCheckoutSuggestion(int userId)
    {
        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound("User not found.");
        var suggestion = await checkout.SuggestForUserAsync(userId);
        return Ok(new
        {
            suggestion.SuggestedTime,
            suggestion.SampleSize,
            suggestion.TypicalArrivalTime,
            MaxAllowed = AutoCheckout.MaxTimeLabel,
        });
    }
}
