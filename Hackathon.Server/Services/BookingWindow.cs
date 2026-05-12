namespace Hackathon.Server.Services;

public static class BookingWindow
{
    public const int MaxDaysAhead = 14;

    public static DateOnly Today => DateOnly.FromDateTime(DateTime.Today);
    public static DateOnly LatestBookable => Today.AddDays(MaxDaysAhead);

    public static bool IsBookable(DateOnly date) => date >= Today && date <= LatestBookable;

    public static string RejectionReason =>
        $"Bookings must be between {Today:yyyy-MM-dd} and {LatestBookable:yyyy-MM-dd} (14 days ahead max).";
}
