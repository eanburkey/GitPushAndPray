using Hackathon.Server.Models;
using Hackathon.Server.Services;
using Microsoft.AspNetCore.Mvc;

namespace Hackathon.Server.Controllers;

[ApiController]
[Route("api/autobook")]
public class AutoBookController(AutoBookerService booker) : ControllerBase
{
    [HttpPost("run")]
    public async Task<IActionResult> Run([FromBody] AutoBookRunRequest request)
    {
        var weekStart = AutoBookerService.StartOfWeek(request.WeekStart);
        var maxWeekStart = AutoBookerService.StartOfWeek(BookingWindow.LatestBookable);
        if (weekStart > maxWeekStart)
        {
            return BadRequest($"Auto-booking is limited to the next 2 weeks. Latest allowed week starts {maxWeekStart:yyyy-MM-dd}.");
        }
        var result = await booker.RunForWeekAsync(weekStart);
        return Ok(result);
    }

    [HttpGet("next-week-start")]
    public IActionResult NextWeekStart()
    {
        var monday = AutoBookerService.StartOfWeek(BookingWindow.Today);
        var nextMonday = monday.AddDays(7);
        return Ok(new
        {
            thisWeek = monday,
            nextWeek = nextMonday,
            maxBookableDate = BookingWindow.LatestBookable,
        });
    }
}
