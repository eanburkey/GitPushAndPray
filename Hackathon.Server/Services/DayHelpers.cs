namespace Hackathon.Server.Services;

public static class DayHelpers
{
    public static readonly string[] Weekdays = { "Mon", "Tue", "Wed", "Thu", "Fri" };

    /// <summary>
    /// Validates a comma-separated days string and returns a normalized
    /// "Mon,Tue"-style representation with exactly two distinct weekdays
    /// in Mon-Fri order. Returns null on invalid input.
    /// </summary>
    public static string? NormalizeTwoWeekdays(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var indices = new SortedSet<int>();
        foreach (var p in parts)
        {
            var idx = IndexOf(p);
            if (idx < 0) return null;
            indices.Add(idx);
        }
        if (indices.Count != 2) return null;
        return string.Join(",", indices.Select(i => Weekdays[i]));
    }

    public static List<int> ParseIndices(string? raw)
    {
        var result = new List<int>();
        if (string.IsNullOrWhiteSpace(raw)) return result;
        foreach (var p in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var idx = IndexOf(p);
            if (idx >= 0 && !result.Contains(idx)) result.Add(idx);
        }
        return result;
    }

    private static int IndexOf(string s) => s.Trim().ToLowerInvariant() switch
    {
        "mon" or "monday" => 0,
        "tue" or "tuesday" => 1,
        "wed" or "wednesday" => 2,
        "thu" or "thursday" => 3,
        "fri" or "friday" => 4,
        _ => -1,
    };
}
