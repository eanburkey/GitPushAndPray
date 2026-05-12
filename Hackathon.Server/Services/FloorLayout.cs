namespace Hackathon.Server.Services;

// Describes how the 200 desks per floor are laid out into regions.
// The frontend renders each region in a fixed slot of a 3x3 building grid,
// with the central core showing non-bookable amenities.
public static class FloorLayout
{
    public record Region(string Code, string Label, int Rows, int Cols)
    {
        public int Count => Rows * Cols;
    }

    // Perimeter wings (the 4 main workstation strips)
    public static readonly Region North = new("N", "North Workstations", 4, 9);  // 36
    public static readonly Region South = new("S", "South Workstations", 4, 9);  // 36
    public static readonly Region East = new("E", "East Workstations", 9, 4);    // 36
    public static readonly Region West = new("W", "West Workstations", 9, 4);    // 36
    // 4 corner zones
    public static readonly Region NW = new("NW", "Lounge Area", 2, 5);           // 10
    public static readonly Region NE = new("NE", "Collaborative Zone", 2, 5);    // 10
    public static readonly Region SW = new("SW", "Casual Seating", 2, 5);        // 10
    public static readonly Region SE = new("SE", "Huddle Area", 2, 5);           // 10
    // Inner top: two clusters in the upper middle of the image
    public static readonly Region Inner = new("INNER", "Inner Workstations", 2, 8); // 16

    public static readonly Region[] All =
    {
        North, South, East, West, NW, NE, SW, SE, Inner,
    };

    public static int DesksPerFloor => All.Sum(r => r.Count); // 200
}
