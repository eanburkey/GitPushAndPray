using Hackathon.Server.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Hackathon.Server.Data;

internal static class AccessibilityNeedsSerializer
{
    public static string Serialize(List<AccessibilityType> needs) =>
        needs is null ? "" : string.Join(',', needs.Distinct().Select(t => t.ToString()));

    public static List<AccessibilityType> Deserialize(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return new List<AccessibilityType>();
        var result = new List<AccessibilityType>();
        foreach (var part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (Enum.TryParse<AccessibilityType>(part, ignoreCase: true, out var t) && !result.Contains(t))
                result.Add(t);
        }
        return result;
    }
}

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Team> Teams => Set<Team>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Desk> Desks => Set<Desk>();
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<TradeRequest> Trades => Set<TradeRequest>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<ArrivalRecord> Arrivals => Set<ArrivalRecord>();
    public DbSet<VirtualTeam> VirtualTeams => Set<VirtualTeam>();
    public DbSet<VirtualTeamMembership> VirtualTeamMemberships => Set<VirtualTeamMembership>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        mb.Entity<User>().HasIndex(u => u.Email).IsUnique();
        mb.Entity<User>().Property(u => u.Role).HasConversion<string>();

        var needsConverter = new ValueConverter<List<AccessibilityType>, string>(
            v => AccessibilityNeedsSerializer.Serialize(v),
            v => AccessibilityNeedsSerializer.Deserialize(v));
        var needsComparer = new ValueComparer<List<AccessibilityType>>(
            (a, b) => (a ?? new()).OrderBy(t => t).SequenceEqual((b ?? new()).OrderBy(t => t)),
            v => v.OrderBy(t => t).Aggregate(0, (hash, t) => HashCode.Combine(hash, t)),
            v => v.ToList());
        mb.Entity<User>()
            .Property(u => u.AccessibilityNeeds)
            .HasConversion(needsConverter, needsComparer);
        mb.Entity<Desk>().HasIndex(d => new { d.Floor, d.Number }).IsUnique();
        mb.Entity<Desk>().Property(d => d.AccessibilityType).HasConversion<string>();
        mb.Entity<Booking>().HasIndex(b => new { b.DeskId, b.Date }).IsUnique();
        mb.Entity<Booking>().Property(b => b.Kind).HasConversion<string>();
        mb.Entity<TradeRequest>().Property(t => t.Status).HasConversion<string>();
        mb.Entity<Holiday>().HasIndex(h => new { h.UserId, h.Date }).IsUnique();
        mb.Entity<ArrivalRecord>().HasIndex(a => new { a.UserId, a.Date }).IsUnique();

        // Team.Manager is a User but not part of Team.Members navigation; keep it as a
        // simple optional FK without a back-reference to avoid clashing with TeamId.
        mb.Entity<Team>()
            .HasOne(t => t.Manager)
            .WithMany()
            .HasForeignKey(t => t.ManagerUserId)
            .OnDelete(DeleteBehavior.SetNull);

        mb.Entity<VirtualTeam>()
            .HasOne(v => v.CreatedBy)
            .WithMany()
            .HasForeignKey(v => v.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<VirtualTeamMembership>()
            .HasIndex(m => new { m.VirtualTeamId, m.UserId }).IsUnique();
        mb.Entity<VirtualTeamMembership>()
            .HasOne(m => m.VirtualTeam)
            .WithMany(v => v.Memberships)
            .HasForeignKey(m => m.VirtualTeamId)
            .OnDelete(DeleteBehavior.Cascade);
        mb.Entity<VirtualTeamMembership>()
            .HasOne(m => m.User)
            .WithMany()
            .HasForeignKey(m => m.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
