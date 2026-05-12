using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(AppDbContext db) : ControllerBase
{
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email)) return BadRequest("Email is required.");

        var email = request.Email.Trim().ToLowerInvariant();
        var user = await db.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Email == email);

        if (user is null)
        {
            // Demo: auto-create a "Guest" user on a fresh team so login always works.
            var guestTeam = await db.Teams.FirstOrDefaultAsync(t => t.Name == "Guest");
            if (guestTeam is null)
            {
                guestTeam = new Team
                {
                    Name = "Guest", Color = "#6b7280",
                    HomeFloor = 1, HomeWing = "N", PreferredDays = "Mon,Wed",
                };
                db.Teams.Add(guestTeam);
                await db.SaveChangesAsync();
            }
            user = new User
            {
                Email = email,
                Name = email.Split('@')[0].Replace('.', ' '),
                TeamId = guestTeam.Id,
                AutoCheckoutTime = AutoCheckout.DefaultTime,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            user.Team = guestTeam;
        }

        return Ok(new { user = Project(user) });
    }

    [HttpGet("users")]
    public async Task<IActionResult> AllUsers()
    {
        var users = await db.Users.Include(u => u.Team).OrderBy(u => u.Team!.Name).ThenBy(u => u.Name).ToListAsync();
        return Ok(users.Select(Project));
    }

    public static object Project(User u) => new
    {
        u.Id,
        u.Email,
        u.Name,
        Initials = u.Initials,
        u.TeamId,
        TeamName = u.Team?.Name,
        TeamColor = u.Team?.Color,
        Role = u.Role.ToString(),
        AccessibilityNeeds = u.AccessibilityNeeds.Select(t => t.ToString()).ToArray(),
        u.IsAutoBookingEnabled,
        AutoCheckoutTime = AutoCheckout.Format(AutoCheckout.Effective(u.AutoCheckoutTime)),
    };
}
