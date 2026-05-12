using Hackathon.Server.Data;
using Hackathon.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace Hackathon.Server.Services;

public static class DbSeeder
{
    private const int MinTeamSize = 45;
    private const int MaxTeamSize = 75;
    private const int ExpectedTeamCount = 36; // 9 floors x 4 sub-teams

    /// <summary>Returns true if the DB was freshly seeded.</summary>
    public static bool EnsureSeeded(AppDbContext db)
    {
        // EnsureCreated only creates schema when the DB doesn't already exist; it never
        // migrates. If a previous run left the DB without the new columns/tables, wipe
        // so the new schema can be created. Demo DB is disposable.
        if (!HasNewSchemaColumns(db))
        {
            db.Database.EnsureDeleted();
        }
        db.Database.EnsureCreated();

        // If the existing seed doesn't match the current schema (e.g. older run with
        // only 8 teams), drop everything and re-seed.
        var existingTeams = db.Teams.Count();
        if (existingTeams > 0 && existingTeams != ExpectedTeamCount)
        {
            db.Database.EnsureDeleted();
            db.Database.EnsureCreated();
        }
        else if (existingTeams == ExpectedTeamCount)
        {
            // Drop & re-seed if the seeded team sizes don't match the current
            // MinTeamSize/MaxTeamSize bounds (e.g. old smaller-team data).
            var teamSizes = db.Users.GroupBy(u => u.TeamId).Select(g => g.Count()).ToList();
            var maxTeamSize = teamSizes.Max();
            var minTeamSize = teamSizes.Min();
            if (maxTeamSize > MaxTeamSize || minTeamSize < MinTeamSize)
            {
                db.Database.EnsureDeleted();
                db.Database.EnsureCreated();
            }
            else
            {
                return false;
            }
        }

        db.ChangeTracker.AutoDetectChangesEnabled = false;
        try
        {
            var teams = BuildTeams();
            db.Teams.AddRange(teams);
            db.SaveChanges();

            var users = BuildUsers(teams);
            db.Users.AddRange(users);
            db.SaveChanges();

            AssignManagersAndAdmin(db, teams, users);
            db.SaveChanges();

            var desks = BuildDesks();
            db.Desks.AddRange(desks);
            db.SaveChanges();

            var holidays = BuildHolidays(users);
            db.Holidays.AddRange(holidays);
            db.SaveChanges();

            var arrivals = BuildArrivals(users);
            db.Arrivals.AddRange(arrivals);
            db.SaveChanges();
        }
        finally
        {
            db.ChangeTracker.AutoDetectChangesEnabled = true;
        }
        return true;
    }

    // ───────── Teams ─────────
    private static readonly (string Dept, string[] SubTeams)[] Departments =
    {
        ("Engineering", new[] { "Backend", "Frontend", "Platform", "Infrastructure" }),
        ("Product", new[] { "Growth", "Analytics", "Strategy", "Research" }),
        ("Design", new[] { "UX", "Visual", "Brand", "Motion" }),
        ("Sales", new[] { "SMB", "Enterprise", "Channels", "Operations" }),
        ("Marketing", new[] { "Content", "Performance", "Brand", "Events" }),
        ("Customer Success", new[] { "Onboarding", "Renewals", "L1 Support", "L2 Support" }),
        ("Finance", new[] { "Accounting", "Treasury", "FP&A", "Procurement" }),
        ("People", new[] { "Talent", "HR Business", "Learning", "Comp & Ben" }),
        ("Operations", new[] { "Facilities", "IT", "Security", "Legal" }),
    };

    private static readonly string[] Wings = { "N", "S", "E", "W" };

    private static readonly string[] DayPairs =
    {
        "Mon,Wed", "Tue,Thu", "Mon,Thu", "Tue,Wed",
        "Wed,Fri", "Mon,Tue", "Thu,Fri", "Wed,Thu",
    };

    private static List<Team> BuildTeams()
    {
        var teams = new List<Team>();
        int idx = 0;
        for (int floor = 1; floor <= 9; floor++)
        {
            var (dept, subs) = Departments[floor - 1];
            for (int w = 0; w < 4; w++)
            {
                teams.Add(new Team
                {
                    Name = $"{dept} — {subs[w]}",
                    Color = HslToHex(idx * (360.0 / 36), 0.62, 0.50),
                    HomeFloor = floor,
                    HomeWing = Wings[w],
                    PreferredDays = DayPairs[idx % DayPairs.Length],
                });
                idx++;
            }
        }
        return teams;
    }

    // ───────── Users ─────────
    private static readonly string[] FirstNames =
    {
        "Alice","Bob","Carol","Dave","Erin","Frank","Grace","Henry","Ivy","Jack",
        "Kara","Liam","Mia","Noah","Olivia","Pete","Quinn","Rosa","Sam","Tara",
        "Uma","Vik","Wren","Xavi","Yara","Zack","Aria","Beau","Cleo","Dario",
        "Elena","Felix","Greta","Hugo","Inez","Jude","Kira","Leo","Maya","Nico",
        "Opal","Paolo","Reza","Sofia","Theo","Una","Vera","Will","Xena","Yuri",
        "Zoe","Amir","Belle","Cyrus","Dora","Enzo","Fia","Gus","Halle","Ian",
        "Jules","Kai","Lana","Milo","Nia","Owen","Pia","Reed","Sage","Tom",
        "Viv","Wade","Yael","Zen","Ada","Bart","Dane","Esme","Finn","Glen",
    };

    private static readonly string[] LastNames =
    {
        "Anderson","Brown","Chen","Davies","Evans","Fischer","Gomez","Hill","Ito","Jones",
        "Khan","Lopez","Murphy","Novak","Owusu","Park","Quincy","Rossi","Smith","Tanaka",
        "Uribe","Vega","Wood","Xu","Young","Zhang","Adams","Bishop","Clarke","Diaz",
        "Edwards","Foster","Garcia","Hassan","Iqbal","Johnson","King","Lee","Morgan","Nguyen",
    };

    private static readonly AccessibilityType[] AccessibilityTypes =
    {
        AccessibilityType.StandingDesk,
        AccessibilityType.TreadmillDesk,
        AccessibilityType.LargeMonitor,
        AccessibilityType.DualMonitor,
    };

    private static List<User> BuildUsers(List<Team> teams)
    {
        var users = new List<User>();
        var emailSeen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var rng = new Random(7);

        foreach (var team in teams)
        {
            // Random.Next(min, max) is upper-exclusive, so add one to include MaxTeamSize.
            var teamSize = rng.Next(MinTeamSize, MaxTeamSize + 1);
            for (int i = 0; i < teamSize; i++)
            {
                var first = FirstNames[rng.Next(FirstNames.Length)];
                var last = LastNames[rng.Next(LastNames.Length)];
                var key = $"{first}.{last}".ToLowerInvariant();
                emailSeen.TryGetValue(key, out var count);
                emailSeen[key] = count + 1;
                var email = count == 0 ? $"{key}@company.com" : $"{key}{count + 1}@company.com";

                // ~10% of users have at least one accessibility need; of those, ~30%
                // have two needs to exercise the multi-need path.
                var needs = new List<AccessibilityType>();
                if (rng.Next(10) == 0)
                {
                    needs.Add(AccessibilityTypes[rng.Next(AccessibilityTypes.Length)]);
                    if (rng.Next(10) < 3)
                    {
                        var second = AccessibilityTypes[rng.Next(AccessibilityTypes.Length)];
                        if (!needs.Contains(second)) needs.Add(second);
                    }
                }

                users.Add(new User
                {
                    Email = email,
                    Name = $"{first} {last}",
                    TeamId = team.Id,
                    AccessibilityNeeds = needs,
                });
            }
        }
        return users;
    }

    // ───────── Desks ─────────
    // ~10% of desks are accessibility desks, evenly spread across all floors *and*
    // across every region of each floor. We pick positions deterministically within
    // each region so the layout is identical every run.
    private static List<Desk> BuildDesks()
    {
        var desks = new List<Desk>();
        for (int floor = 1; floor <= 9; floor++)
        {
            int number = 1;
            // Rotate the starting accessibility type per (floor, region) so the
            // 4 types are spread out, not clumped on one floor.
            int rotation = (floor - 1) * 7;

            foreach (var region in FloorLayout.All)
            {
                var slots = PickAccessibilitySlots(region.Count);
                int seatIndex = 0;
                int slotCursor = 0;

                for (int r = 0; r < region.Rows; r++)
                {
                    for (int c = 0; c < region.Cols; c++)
                    {
                        AccessibilityType? type = null;
                        if (slotCursor < slots.Count && slots[slotCursor] == seatIndex)
                        {
                            type = AccessibilityTypes[(rotation + slotCursor) % AccessibilityTypes.Length];
                            slotCursor++;
                        }

                        desks.Add(new Desk
                        {
                            Floor = floor,
                            Number = number++,
                            Region = region.Code,
                            RegionRow = r,
                            RegionCol = c,
                            AccessibilityType = type,
                        });
                        seatIndex++;
                    }
                }
                rotation += slots.Count; // continue the rotation across regions
            }
        }
        return desks;
    }

    // Picks evenly-spaced seat indices in [0, count) so we get ~10% accessibility
    // desks spread across the region. Always at least one if the region has >= 5 desks.
    private static List<int> PickAccessibilitySlots(int count)
    {
        if (count <= 0) return new List<int>();
        int target = Math.Max(1, (int)Math.Round(count * 0.10));
        if (count < 5) target = 0; // very small regions stay all-standard
        if (target == 0) return new List<int>();

        var result = new List<int>(target);
        double step = (double)count / target;
        for (int i = 0; i < target; i++)
        {
            // Centre each slot in its even-sized bucket so distribution is uniform.
            int idx = (int)Math.Floor(step * i + step / 2.0);
            if (idx >= count) idx = count - 1;
            if (result.Count == 0 || idx > result[^1]) result.Add(idx);
        }
        return result;
    }

    // ───────── Holidays ─────────
    // Stand-in for the Workday integration: seed plausible holiday days in the
    // upcoming 28 days so the demo shows the auto-booker skipping people on leave.
    private static List<Holiday> BuildHolidays(List<User> users)
    {
        var rng = new Random(101);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var holidays = new List<Holiday>();

        foreach (var user in users)
        {
            // ~25% of people have at least one holiday in the next 4 weeks.
            if (rng.Next(4) != 0) continue;

            // 1-3 holiday days, all weekdays within the next 28 days.
            int count = rng.Next(1, 4);
            var picked = new HashSet<DateOnly>();
            int attempts = 0;
            while (picked.Count < count && attempts++ < 20)
            {
                var offset = rng.Next(1, 29);
                var date = today.AddDays(offset);
                if (date.DayOfWeek == DayOfWeek.Saturday || date.DayOfWeek == DayOfWeek.Sunday) continue;
                if (!picked.Add(date)) continue;
                holidays.Add(new Holiday { UserId = user.Id, Date = date });
            }
        }
        return holidays;
    }

    // ───────── Arrivals ─────────
    // Stand-in for the badge-swipe feed: seed plausible past-week arrival times so
    // the auto-checkout suggestion has data to learn from on day one of the demo.
    // Each user gets a personal baseline (early-bird, on-time, or late) and we
    // emit one record per weekday over the last ~4 weeks with small variance.
    // Side-effect: every user's AutoCheckoutTime is set to their personalised
    // default (latest seeded arrival + 15min, rounded up to 5min, capped at the
    // global max) so the demo opens with realistic, varied cutoffs.
    private static List<ArrivalRecord> BuildArrivals(List<User> users)
    {
        var rng = new Random(202);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var arrivals = new List<ArrivalRecord>();
        var maxAllowedMin = 10 * 60 + 30; // mirrors AutoCheckout.MaxTime; kept local to avoid pulling in Services here.

        foreach (var user in users)
        {
            // Baseline arrival between 07:45 and 10:00. Slight skew toward the
            // middle so most suggestions land in the 9:00–10:00 range.
            int baselineMinutes = 7 * 60 + 45 + rng.Next(0, 135); // 07:45 .. 10:00
            int variance = rng.Next(5, 16); // +/- 5..15 min per day
            int latest = baselineMinutes;

            for (int dayOffset = -28; dayOffset <= -1; dayOffset++)
            {
                var date = today.AddDays(dayOffset);
                if (date.DayOfWeek == DayOfWeek.Saturday || date.DayOfWeek == DayOfWeek.Sunday) continue;
                // ~70% chance the user came in on any given weekday — leaves enough
                // history without forcing daily attendance.
                if (rng.Next(10) >= 7) continue;

                int jitter = rng.Next(-variance, variance + 1);
                int minutes = Math.Clamp(baselineMinutes + jitter, 6 * 60, 11 * 60 + 30);
                arrivals.Add(new ArrivalRecord
                {
                    UserId = user.Id,
                    Date = date,
                    ArrivedAt = new TimeOnly(minutes / 60, minutes % 60),
                });
                if (minutes > latest) latest = minutes;
            }

            // Suggestion algorithm in miniature: latest seen + 15min, rounded to
            // 5min, capped. Kept in sync with AutoCheckoutService.SuggestForUserAsync.
            int proposed = (int)Math.Ceiling((latest + 15) / 5.0) * 5;
            if (proposed > maxAllowedMin) proposed = maxAllowedMin;
            user.AutoCheckoutTime = new TimeOnly(proposed / 60, proposed % 60);
        }
        return arrivals;
    }

    // ───────── Roles ─────────
    private static void AssignManagersAndAdmin(AppDbContext db, List<Team> teams, List<User> users)
    {
        // First user (by Id) per team becomes that team's manager.
        var byTeam = users.GroupBy(u => u.TeamId).ToDictionary(g => g.Key, g => g.OrderBy(u => u.Id).First());
        foreach (var team in teams)
        {
            if (byTeam.TryGetValue(team.Id, out var manager))
            {
                manager.Role = UserRole.TeamManager;
                team.ManagerUserId = manager.Id;
            }
        }

        // Promote the very first user of the very first team to Admin (overrides their
        // TeamManager role — admins are a strict superset for our purposes).
        var first = users.OrderBy(u => u.Id).FirstOrDefault();
        if (first is not null) first.Role = UserRole.Admin;
    }

    private static bool HasNewSchemaColumns(AppDbContext db)
    {
        try
        {
            var conn = db.Database.GetDbConnection();
            var wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) conn.Open();
            try
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='Users'";
                var hasUsersTable = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                if (!hasUsersTable) return true; // nothing to migrate; EnsureCreated will create fresh schema

                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Users') WHERE name = 'Role'";
                var hasRole = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Teams') WHERE name = 'RequestedDays'";
                var hasRequested = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Users') WHERE name = 'AccessibilityNeeds'";
                var hasA11yNeeds = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Desks') WHERE name = 'AccessibilityType'";
                var hasDeskA11y = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='Holidays'";
                var hasHolidays = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='VirtualTeams'";
                var hasVirtualTeams = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Desks') WHERE name = 'IsBookable'";
                var hasDeskIsBookable = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Notifications') WHERE name = 'TradeRequesterId'";
                var hasTradeContext = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Users') WHERE name = 'IsAutoBookingEnabled'";
                var hasAutoBookingFlag = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Users') WHERE name = 'AutoCheckoutTime'";
                var hasAutoCheckout = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='Arrivals'";
                var hasArrivals = Convert.ToInt32(cmd.ExecuteScalar() ?? 0) > 0;
                return hasRole && hasRequested && hasA11yNeeds && hasDeskA11y && hasHolidays && hasVirtualTeams && hasDeskIsBookable && hasTradeContext && hasAutoBookingFlag && hasAutoCheckout && hasArrivals;
            }
            finally
            {
                if (!wasOpen) conn.Close();
            }
        }
        catch
        {
            // If we can't probe the DB at all, fall through and let EnsureCreated try.
            return true;
        }
    }

    // ───────── Helpers ─────────
    private static string HslToHex(double h, double s, double l)
    {
        h = ((h % 360) + 360) % 360;
        double c = (1 - Math.Abs(2 * l - 1)) * s;
        double x = c * (1 - Math.Abs(((h / 60) % 2) - 1));
        double m = l - c / 2;
        var (r, g, b) = h switch
        {
            < 60 => (c, x, 0.0),
            < 120 => (x, c, 0.0),
            < 180 => (0.0, c, x),
            < 240 => (0.0, x, c),
            < 300 => (x, 0.0, c),
            _ => (c, 0.0, x),
        };
        int ri = (int)Math.Round((r + m) * 255);
        int gi = (int)Math.Round((g + m) * 255);
        int bi = (int)Math.Round((b + m) * 255);
        return $"#{ri:x2}{gi:x2}{bi:x2}";
    }
}
