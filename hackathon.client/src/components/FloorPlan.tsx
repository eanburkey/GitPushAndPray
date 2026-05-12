import { useMemo } from "react";
import type { FloorDesk } from "../types";
import { ACCESSIBILITY_COLOR, ACCESSIBILITY_GLYPHS, ACCESSIBILITY_LABELS } from "./AccessibilityIcon";

interface Props {
    desks: FloorDesk[];
    selectedDeskId: number | null;
    onSelect: (desk: FloorDesk) => void;
    currentUserId?: number;
    isAdmin?: boolean;
    highlightedDeskIds?: Set<number>;
    highlightColor?: string;
}

interface Rect { x: number; y: number; w: number; h: number; }
type Side = "N" | "S" | "E" | "W";
type Code = "NW" | "N" | "NE" | "W" | "E" | "SW" | "S" | "SE" | "INNER";

// ── Building geometry ─────────────────────────────────────────────────────────
// One coordinate space for the whole floor plan. All rooms, walls, doors, and
// fixtures are placed in absolute coords inside this viewBox.

const BLDG_W = 338;
const BLDG_H = 409;

const CELL_W = 16;
const CELL_H = 18;
const DESK_W = 11;
const DESK_H = 9;
const LABEL_H = 7;

interface RegionDef {
    rect: Rect;
    label: string;
    rows: number;
    cols: number;
    kind: "wing" | "corner" | "inner";
    door: { side: Side; pos: number; len: number };
}

const REGIONS: Record<Code, RegionDef> = {
    NW: { rect: { x: 8, y: 8, w: 80, h: 125 }, label: "Lounge Area", rows: 2, cols: 5, kind: "corner", door: { side: "S", pos: 48, len: 10 } },
    N: { rect: { x: 89, y: 8, w: 160, h: 80 }, label: "North Workstations", rows: 4, cols: 9, kind: "wing", door: { side: "S", pos: 169, len: 12 } },
    INNER: { rect: { x: 89, y: 89, w: 160, h: 44 }, label: "Inner Workstations", rows: 2, cols: 8, kind: "inner", door: { side: "S", pos: 169, len: 10 } },
    NE: { rect: { x: 250, y: 8, w: 80, h: 125 }, label: "Collaborative Zone", rows: 2, cols: 5, kind: "corner", door: { side: "S", pos: 290, len: 10 } },
    W: { rect: { x: 8, y: 134, w: 80, h: 178 }, label: "West Workstations", rows: 9, cols: 4, kind: "wing", door: { side: "E", pos: 223, len: 12 } },
    E: { rect: { x: 250, y: 134, w: 80, h: 178 }, label: "East Workstations", rows: 9, cols: 4, kind: "wing", door: { side: "W", pos: 223, len: 12 } },
    SW: { rect: { x: 8, y: 313, w: 80, h: 88 }, label: "Casual Seating", rows: 2, cols: 5, kind: "corner", door: { side: "N", pos: 48, len: 10 } },
    S: { rect: { x: 89, y: 313, w: 160, h: 88 }, label: "South Workstations", rows: 4, cols: 9, kind: "wing", door: { side: "N", pos: 169, len: 12 } },
    SE: { rect: { x: 250, y: 313, w: 80, h: 88 }, label: "Huddle Area", rows: 2, cols: 5, kind: "corner", door: { side: "N", pos: 290, len: 10 } },
};

const CORE_RECT: Rect = { x: 89, y: 134, w: 160, h: 178 };

// ── Interior partition walls ──────────────────────────────────────────────────
// Each partition is a single line at a fixed coord with optional gaps for doors.
// Door positions are taken straight from REGIONS so the openings line up.

type Partition =
    | { orient: "V"; pos: number; from: number; to: number; doors: Array<[number, number]> }
    | { orient: "H"; pos: number; from: number; to: number; doors: Array<[number, number]> };

function makePartitions(): Partition[] {
    const cutsForSide = (side: Side, pos: number): Array<[number, number]> =>
        (Object.values(REGIONS) as RegionDef[])
            .filter(r => r.door.side === side && doorOnPartition(r, side, pos))
            .map(r => [r.door.pos - r.door.len / 2, r.door.pos + r.door.len / 2] as [number, number]);

    return [
        // Vertical left-of-middle partition — W's east door punches through here.
        { orient: "V", pos: 88.5, from: 8, to: 401, doors: cutsForSide("E", 88.5) },
        // Vertical right-of-middle partition — E's west door.
        { orient: "V", pos: 249.5, from: 8, to: 401, doors: cutsForSide("W", 249.5) },
        // Between N and INNER.
        { orient: "H", pos: 88.5, from: 89, to: 249, doors: cutsForSide("S", 88.5) },
        // Between top row and middle row — NW, INNER and NE doors.
        { orient: "H", pos: 133.5, from: 8, to: 330, doors: cutsForSide("S", 133.5) },
        // Between middle row and bottom row — SW, S and SE doors.
        { orient: "H", pos: 312.5, from: 8, to: 330, doors: cutsForSide("N", 312.5) },
    ];
}

function doorOnPartition(r: RegionDef, side: Side, pos: number): boolean {
    const epsilon = 0.6;
    if (side === "N") return Math.abs(r.rect.y - pos) < epsilon;
    if (side === "S") return Math.abs(r.rect.y + r.rect.h - pos) < epsilon;
    if (side === "W") return Math.abs(r.rect.x - pos) < epsilon;
    return Math.abs(r.rect.x + r.rect.w - pos) < epsilon;
}

function segmentsFor(p: Partition): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    const sorted = [...p.doors].sort((a, b) => a[0] - b[0]);
    const out: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    let cursor = p.from;
    for (const [d1, d2] of sorted) {
        if (d1 > cursor) {
            out.push(p.orient === "V"
                ? { x1: p.pos, y1: cursor, x2: p.pos, y2: d1 }
                : { x1: cursor, y1: p.pos, x2: d1, y2: p.pos });
        }
        cursor = Math.max(cursor, d2);
    }
    if (cursor < p.to) {
        out.push(p.orient === "V"
            ? { x1: p.pos, y1: cursor, x2: p.pos, y2: p.to }
            : { x1: cursor, y1: p.pos, x2: p.to, y2: p.pos });
    }
    return out;
}

// ── Door swing geometry ──────────────────────────────────────────────────────
// For each region, place a door arc + leaf at the gap punched in its partition.
// The arc swings INTO the room (away from the corridor).

interface DoorGeom {
    arcD: string;
    leafX1: number; leafY1: number; leafX2: number; leafY2: number;
}

function doorGeomFor(r: RegionDef): DoorGeom {
    const { side, pos, len } = r.door;
    if (side === "S") {
        // Door sits on the south wall of the region; opens northward into the room.
        const hy = r.rect.y + r.rect.h;
        const hx = pos - len / 2;
        return {
            arcD: `M ${hx + len} ${hy} A ${len} ${len} 0 0 0 ${hx} ${hy - len}`,
            leafX1: hx, leafY1: hy, leafX2: hx, leafY2: hy - len,
        };
    }
    if (side === "N") {
        const hy = r.rect.y;
        const hx = pos + len / 2;
        return {
            arcD: `M ${hx - len} ${hy} A ${len} ${len} 0 0 0 ${hx} ${hy + len}`,
            leafX1: hx, leafY1: hy, leafX2: hx, leafY2: hy + len,
        };
    }
    if (side === "E") {
        const hx = r.rect.x + r.rect.w;
        const hy = pos - len / 2;
        return {
            arcD: `M ${hx} ${hy + len} A ${len} ${len} 0 0 0 ${hx - len} ${hy}`,
            leafX1: hx, leafY1: hy, leafX2: hx - len, leafY2: hy,
        };
    }
    // W
    const hx = r.rect.x;
    const hy = pos + len / 2;
    return {
        arcD: `M ${hx} ${hy - len} A ${len} ${len} 0 0 0 ${hx + len} ${hy}`,
        leafX1: hx, leafY1: hy, leafX2: hx + len, leafY2: hy,
    };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FloorPlan({
    desks,
    selectedDeskId,
    onSelect,
    currentUserId,
    isAdmin,
    highlightedDeskIds,
    highlightColor,
}: Props) {
    const byRegion = useMemo(() => {
        const m = new Map<string, FloorDesk[]>();
        for (const d of desks) {
            if (!m.has(d.region)) m.set(d.region, []);
            m.get(d.region)!.push(d);
        }
        for (const arr of m.values()) {
            arr.sort((a, b) => a.regionRow - b.regionRow || a.regionCol - b.regionCol);
        }
        return m;
    }, [desks]);

    const partitions = useMemo(() => makePartitions(), []);

    return (
        <div className="building">
            <svg
                viewBox={`0 0 ${BLDG_W} ${BLDG_H}`}
                preserveAspectRatio="xMidYMid meet"
                className="bldg-svg"
            >
                <BuildingShell />
                <Regions
                    byRegion={byRegion}
                    selectedDeskId={selectedDeskId}
                    onSelect={onSelect}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    highlightedDeskIds={highlightedDeskIds}
                    highlightColor={highlightColor}
                />
                <Core />
                <Partitions partitions={partitions} />
                <Doors />
            </svg>
        </div>
    );
}

// ── Building shell (outer wall + window panes) ────────────────────────────────

function BuildingShell() {
    // Wall body is a frame between the outer and inner perimeter. Drawn as a
    // filled donut path so the interior floor shows through the middle. Rooms
    // sit flush against the inner wall face (x=t, y=t) so partitions can meet
    // the exterior wall without leaving a dead corridor.
    const w = BLDG_W, h = BLDG_H;
    const t = 8; // wall thickness — matches the room origin (x=8, y=8)
    return (
        <g className="bldg-shell">
            {/* Floor base */}
            <rect x={t} y={t} width={w - 2 * t} height={h - 2 * t} className="floor-base" />
            {/* Faint floor grid */}
            <FloorGrid x={t} y={t} w={w - 2 * t} h={h - 2 * t} />
            {/* Wall body (filled donut between outer and inner perimeter) */}
            <path
                d={`M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z M ${t} ${t} L ${t} ${h - t} L ${w - t} ${h - t} L ${w - t} ${t} Z`}
                fillRule="evenodd"
                className="bldg-wall-body"
            />
            {/* Outer and inner wall lines */}
            <rect x={0.4} y={0.4} width={w - 0.8} height={h - 0.8} className="bldg-wall-line" />
            <rect x={t} y={t} width={w - 2 * t} height={h - 2 * t} className="bldg-wall-line" />
            {/* Windows along each exterior face */}
            <Windows />
        </g>
    );
}

function FloorGrid({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
    const step = 8;
    const verticals: number[] = [];
    const horizontals: number[] = [];
    for (let gx = x + step; gx < x + w; gx += step) verticals.push(gx);
    for (let gy = y + step; gy < y + h; gy += step) horizontals.push(gy);
    return (
        <g className="floor-grid">
            {verticals.map(gx => (
                <line key={`v${gx}`} x1={gx} y1={y} x2={gx} y2={y + h} />
            ))}
            {horizontals.map(gy => (
                <line key={`h${gy}`} x1={x} y1={gy} x2={x + w} y2={gy} />
            ))}
        </g>
    );
}

function Windows() {
    // Glass panes sit centered in the wall body (8 thick), 5 units of glass with
    // ~1.5 units of wall material on each side. Two thin mullions inside each
    // pane suggest the framing — a standard floor-plan window symbol.
    const wallT = 8;
    const winThickness = 5;
    const inset = (wallT - winThickness) / 2;
    const winLen = 38;
    const winLen2 = 30;
    return (
        <g className="bldg-windows">
            {/* Top */}
            {[60, 130, 210, 280].map(cx => (
                <Window key={`t${cx}`} x={cx - winLen / 2} y={inset} w={winLen} h={winThickness} orient="H" />
            ))}
            {/* Bottom */}
            {[60, 130, 210, 280].map(cx => (
                <Window key={`b${cx}`} x={cx - winLen / 2} y={BLDG_H - wallT + inset} w={winLen} h={winThickness} orient="H" />
            ))}
            {/* Left */}
            {[60, 150, 240, 340].map(cy => (
                <Window key={`l${cy}`} x={inset} y={cy - winLen2 / 2} w={winThickness} h={winLen2} orient="V" />
            ))}
            {/* Right */}
            {[60, 150, 240, 340].map(cy => (
                <Window key={`r${cy}`} x={BLDG_W - wallT + inset} y={cy - winLen2 / 2} w={winThickness} h={winLen2} orient="V" />
            ))}
        </g>
    );
}

function Window({ x, y, w, h, orient }: { x: number; y: number; w: number; h: number; orient: "H" | "V" }) {
    // The light band is the glass; two thin parallel lines suggest the framing.
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} className="bldg-window-pane" />
            {orient === "H" ? (
                <>
                    <line x1={x} y1={y + 1.4} x2={x + w} y2={y + 1.4} className="bldg-window-line" />
                    <line x1={x} y1={y + h - 1.4} x2={x + w} y2={y + h - 1.4} className="bldg-window-line" />
                </>
            ) : (
                <>
                    <line x1={x + 1.4} y1={y} x2={x + 1.4} y2={y + h} className="bldg-window-line" />
                    <line x1={x + w - 1.4} y1={y} x2={x + w - 1.4} y2={y + h} className="bldg-window-line" />
                </>
            )}
        </g>
    );
}

// ── Interior partition walls + door symbols ──────────────────────────────────

function Partitions({ partitions }: { partitions: Partition[] }) {
    return (
        <g className="partitions">
            {partitions.flatMap((p, pi) =>
                segmentsFor(p).map((s, si) => (
                    <line key={`p${pi}-${si}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className="partition" />
                ))
            )}
        </g>
    );
}

function Doors() {
    return (
        <g className="doors">
            {(Object.values(REGIONS) as RegionDef[]).map((r, i) => {
                const g = doorGeomFor(r);
                return (
                    <g key={i}>
                        <path d={g.arcD} className="door-arc" />
                        <line x1={g.leafX1} y1={g.leafY1} x2={g.leafX2} y2={g.leafY2} className="door-leaf" />
                    </g>
                );
            })}
            {/* Doors into the meeting / focus / lift rooms — see Core */}
        </g>
    );
}

// ── Regions ──────────────────────────────────────────────────────────────────

interface RegionsProps {
    byRegion: Map<string, FloorDesk[]>;
    selectedDeskId: number | null;
    onSelect: (desk: FloorDesk) => void;
    currentUserId?: number;
    isAdmin?: boolean;
    highlightedDeskIds?: Set<number>;
    highlightColor?: string;
}

function Regions({ byRegion, selectedDeskId, onSelect, currentUserId, isAdmin, highlightedDeskIds, highlightColor }: RegionsProps) {
    return (
        <g className="regions">
            {(Object.entries(REGIONS) as Array<[Code, RegionDef]>).map(([code, def]) => (
                <Region
                    key={code}
                    def={def}
                    desks={byRegion.get(code) ?? []}
                    selectedDeskId={selectedDeskId}
                    onSelect={onSelect}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    highlightedDeskIds={highlightedDeskIds}
                    highlightColor={highlightColor}
                />
            ))}
        </g>
    );
}

interface RegionProps {
    def: RegionDef;
    desks: FloorDesk[];
    selectedDeskId: number | null;
    onSelect: (desk: FloorDesk) => void;
    currentUserId?: number;
    isAdmin?: boolean;
    highlightedDeskIds?: Set<number>;
    highlightColor?: string;
}

function Region({ def, desks, selectedDeskId, onSelect, currentUserId, isAdmin, highlightedDeskIds, highlightColor }: RegionProps) {
    const { rect, label, rows, cols, kind } = def;
    const gridW = cols * CELL_W;
    const padLeft = Math.max(0, (rect.w - gridW) / 2);
    const desksOriginX = rect.x + padLeft;
    const desksOriginY = rect.y + LABEL_H;

    // Pod platforms: pairs of rows form back-to-back workstation clusters.
    const pods: Array<{ y: number; h: number }> = [];
    for (let r = 0; r < rows; r += 2) {
        pods.push({ y: desksOriginY + r * CELL_H, h: Math.min(2, rows - r) * CELL_H });
    }

    return (
        <g className={`region kind-${kind}`} data-region={def.label}>
            {/* Floor tint per kind */}
            <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} className="region-floor" />
            {/* Pod platforms */}
            {pods.map((p, i) => (
                <rect
                    key={`pod${i}`}
                    x={desksOriginX}
                    y={p.y}
                    width={gridW}
                    height={p.h}
                    rx={1.5}
                    className="pod-platform"
                />
            ))}
            {/* Pod dividers (privacy panel down the spine of back-to-back desks) */}
            {pods.slice(0, -1).map((p, i) => (
                <line
                    key={`div${i}`}
                    x1={desksOriginX}
                    y1={p.y + p.h}
                    x2={desksOriginX + gridW}
                    y2={p.y + p.h}
                    className="pod-divider"
                />
            ))}
            {/* Room label */}
            <text x={rect.x + 3} y={rect.y + LABEL_H - 1.5} className="region-name">{label.toUpperCase()}</text>

            {desks.map(d => (
                <Seat
                    key={d.id}
                    desk={d}
                    row={d.regionRow}
                    col={d.regionCol}
                    originX={desksOriginX}
                    originY={desksOriginY}
                    selected={selectedDeskId === d.id}
                    mine={currentUserId !== undefined && d.bookedBy?.userId === currentUserId}
                    highlighted={highlightedDeskIds?.has(d.id) ?? false}
                    highlightColor={highlightColor}
                    isAdmin={isAdmin}
                    onClick={() => onSelect(d)}
                />
            ))}

            {/* Lounge / corner-room furniture filler in the empty floor area below desks */}
            {kind === "corner" && <CornerFurniture rect={rect} desksHeight={LABEL_H + rows * CELL_H} />}
        </g>
    );
}

function CornerFurniture({ rect, desksHeight }: { rect: Rect; desksHeight: number }) {
    // Sits in the empty area beneath the desks of NW/NE/SW/SE.
    const slackTop = rect.y + desksHeight + 6;
    const slack = rect.y + rect.h - slackTop - 4;
    if (slack < 14) return null;
    const cx = rect.x + rect.w / 2;
    const cy = slackTop + slack / 2;
    return (
        <g className="lounge-furniture">
            {/* Coffee table */}
            <rect x={cx - 10} y={cy - 4} width={20} height={8} rx={1} className="cb-furniture" />
            {/* Sofa above */}
            <rect x={cx - 16} y={cy - 14} width={32} height={6} rx={1.5} className="cb-furniture" />
            {/* Chairs flanking */}
            <circle cx={cx - 18} cy={cy + 3} r={3} className="cb-furniture" />
            <circle cx={cx + 18} cy={cy + 3} r={3} className="cb-furniture" />
            {/* Plant */}
            <circle cx={rect.x + rect.w - 8} cy={rect.y + rect.h - 8} r={3} className="cb-plant" />
        </g>
    );
}

// ── Seat (one desk + chair) ──────────────────────────────────────────────────

interface SeatProps {
    desk: FloorDesk;
    row: number;
    col: number;
    originX: number;
    originY: number;
    selected: boolean;
    mine: boolean;
    highlighted: boolean;
    highlightColor?: string;
    isAdmin?: boolean;
    onClick: () => void;
}

function Seat({ desk, row, col, originX, originY, selected, mine, highlighted, highlightColor, isAdmin, onClick }: SeatProps) {
    const isUpper = row % 2 === 0;
    const cellX = originX + col * CELL_W + (CELL_W - DESK_W) / 2;
    const cellY = originY + row * CELL_H;
    const deskY = isUpper ? cellY + CELL_H - DESK_H - 1 : cellY + 1;
    const centerX = cellX + DESK_W / 2;
    const centerY = deskY + DESK_H / 2;
    const chairR = 1.9;
    const chairCy = isUpper ? deskY - chairR - 0.6 : deskY + DESK_H + chairR + 0.6;

    const booked = desk.booked && desk.bookedBy !== null;
    const fill = booked ? desk.bookedBy!.teamColor : "#ffffff";
    const a11yType = desk.accessibilityType ?? null;
    const a11yLabel = a11yType ? ` · ${ACCESSIBILITY_LABELS[a11yType]}` : "";
    const isNotBookable = desk.isBookable === false;
    const blockClick = isNotBookable && !isAdmin;
    const title = isNotBookable
        ? `Desk ${desk.number} — not available for booking`
        : booked
            ? `${desk.bookedBy!.name} (${desk.bookedBy!.teamName}) — Desk ${desk.number}${a11yLabel}`
            : `Desk ${desk.number} — available${a11yLabel}`;

    const groupClass = [
        "seat-group",
        isNotBookable ? "is-not-bookable" : booked ? "is-booked" : "is-free",
        isNotBookable && !isAdmin ? "no-click" : "",
        selected ? "is-selected" : "",
        mine ? "is-mine" : "",
        highlighted ? "is-team-highlight" : "",
        a11yType ? "is-a11y" : "",
    ].filter(Boolean).join(" ");

    return (
        <g className={groupClass} onClick={blockClick ? undefined : onClick} data-desk-id={desk.id}>
            <title>{title}</title>
            {highlighted && (
                <rect
                    x={cellX - 2}
                    y={deskY - 2.5}
                    width={DESK_W + 4}
                    height={DESK_H + 5}
                    rx={2.4}
                    ry={2.4}
                    className="team-highlight"
                    fill={highlightColor ?? "#fbbf24"}
                />
            )}
            <circle cx={centerX} cy={chairCy} r={chairR} className="seat-chair" />
            <rect
                x={cellX}
                y={deskY}
                width={DESK_W}
                height={DESK_H}
                rx={1.3}
                ry={1.3}
                fill={fill}
                stroke={a11yType ? ACCESSIBILITY_COLOR : undefined}
                strokeWidth={a11yType ? 0.9 : undefined}
                className="desk-rect"
            />
            <rect
                x={cellX + 1.5}
                y={isUpper ? deskY + DESK_H - 1.6 : deskY + 0.6}
                width={DESK_W - 3}
                height={1}
                className="desk-monitor"
                rx={0.3}
            />
            {booked && (
                <text x={centerX} y={centerY + 1.5} textAnchor="middle" className="desk-initials">
                    {desk.bookedBy!.initials}
                </text>
            )}
            {a11yType && (
                <g className="a11y-badge">
                    <circle cx={cellX + DESK_W - 1.2} cy={deskY + 1.2} r={2} fill={ACCESSIBILITY_COLOR} stroke="#fff" strokeWidth={0.4} />
                    <text x={cellX + DESK_W - 1.2} y={deskY + 2.5} textAnchor="middle" fill="#fff" className="a11y-glyph">
                        {ACCESSIBILITY_GLYPHS[a11yType]}
                    </text>
                </g>
            )}
            {mine && (
                <rect x={cellX - 1} y={deskY - 1} width={DESK_W + 2} height={DESK_H + 2} rx={2} ry={2} className="mine-ring" />
            )}
            {isNotBookable && (
                <g className="not-bookable-cross">
                    <line x1={cellX + 1} y1={deskY + 1} x2={cellX + DESK_W - 1} y2={deskY + DESK_H - 1} />
                    <line x1={cellX + DESK_W - 1} y1={deskY + 1} x2={cellX + 1} y2={deskY + DESK_H - 1} />
                </g>
            )}
        </g>
    );
}

// ── Core (lifts, stairs, restrooms, meeting & focus rooms, copy, kitchen) ────

function Core() {
    const c = CORE_RECT;
    // Sub-rows: stair (50) | meeting (60) | focus (50) | kitchen (15)
    const stairY = c.y;
    const meetingY = stairY + 50 + 1;     // 185
    const focusY = meetingY + 60 + 1;     // 246
    const kitchenY = focusY + 50 + 1;     // 297
    // Sub-cols within the standard 3-block rows.
    const colA = c.x;
    const colB1 = colA + 55 + 1;          // 145
    const colC1 = colB1 + 50 + 1;         // 196
    const colA_w = 55, colB1_w = 50, colC1_w = 55; // meeting | lifts | meeting

    // Stair / restroom / stair row sizing (slightly different proportions)
    const sCol1_w = 48, sCol2_w = 62, sCol3_w = 48;
    const sCol1 = c.x, sCol2 = sCol1 + sCol1_w + 1, sCol3 = sCol2 + sCol2_w + 1;

    const fCol1_w = 50, fCol2_w = 58, fCol3_w = 50;
    const fCol1 = c.x, fCol2 = fCol1 + fCol1_w + 1, fCol3 = fCol2 + fCol2_w + 1;

    return (
        <g className="core">
            {/* Core floor tint */}
            <rect x={c.x} y={c.y} width={c.w} height={c.h} className="core-floor" />

            {/* Sub-room floor tints */}
            <rect x={sCol1} y={stairY} width={sCol1_w} height={50} className="room-stair" />
            <rect x={sCol2} y={stairY} width={sCol2_w} height={50} className="room-rest" />
            <rect x={sCol3} y={stairY} width={sCol3_w} height={50} className="room-stair" />
            <rect x={colA} y={meetingY} width={colA_w} height={60} className="room-meeting" />
            <rect x={colB1} y={meetingY} width={colB1_w} height={60} className="room-lifts" />
            <rect x={colC1} y={meetingY} width={colC1_w} height={60} className="room-meeting" />
            <rect x={fCol1} y={focusY} width={fCol1_w} height={50} className="room-focus" />
            <rect x={fCol2} y={focusY} width={fCol2_w} height={50} className="room-copy" />
            <rect x={fCol3} y={focusY} width={fCol3_w} height={50} className="room-focus" />
            <rect x={c.x} y={kitchenY} width={c.w} height={15} className="room-kitchen" />

            {/* Internal core partitions */}
            {/* horizontal between rows */}
            <line x1={c.x} y1={stairY + 50 + 0.5} x2={c.x + c.w} y2={stairY + 50 + 0.5} className="partition" />
            <line x1={c.x} y1={meetingY + 60 + 0.5} x2={c.x + c.w} y2={meetingY + 60 + 0.5} className="partition" />
            <line x1={c.x} y1={focusY + 50 + 0.5} x2={c.x + c.w} y2={focusY + 50 + 0.5} className="partition" />
            {/* vertical inside stair row */}
            <line x1={sCol1 + sCol1_w + 0.5} y1={stairY} x2={sCol1 + sCol1_w + 0.5} y2={stairY + 50} className="partition" />
            <line x1={sCol2 + sCol2_w + 0.5} y1={stairY} x2={sCol2 + sCol2_w + 0.5} y2={stairY + 50} className="partition" />
            {/* vertical inside meeting row */}
            <line x1={colA + colA_w + 0.5} y1={meetingY} x2={colA + colA_w + 0.5} y2={meetingY + 60} className="partition" />
            <line x1={colB1 + colB1_w + 0.5} y1={meetingY} x2={colB1 + colB1_w + 0.5} y2={meetingY + 60} className="partition" />
            {/* vertical inside focus row */}
            <line x1={fCol1 + fCol1_w + 0.5} y1={focusY} x2={fCol1 + fCol1_w + 0.5} y2={focusY + 50} className="partition" />
            <line x1={fCol2 + fCol2_w + 0.5} y1={focusY} x2={fCol2 + fCol2_w + 0.5} y2={focusY + 50} className="partition" />

            {/* Symbols inside each sub-room */}
            <StairSym rect={{ x: sCol1, y: stairY, w: sCol1_w, h: 50 }} />
            <RestroomSym rect={{ x: sCol2, y: stairY, w: sCol2_w, h: 50 }} />
            <StairSym rect={{ x: sCol3, y: stairY, w: sCol3_w, h: 50 }} mirror />
            <MeetingSym rect={{ x: colA, y: meetingY, w: colA_w, h: 60 }} />
            <LiftSym rect={{ x: colB1, y: meetingY, w: colB1_w, h: 60 }} />
            <MeetingSym rect={{ x: colC1, y: meetingY, w: colC1_w, h: 60 }} mirror />
            <FocusSym rect={{ x: fCol1, y: focusY, w: fCol1_w, h: 50 }} />
            <CopySym rect={{ x: fCol2, y: focusY, w: fCol2_w, h: 50 }} />
            <FocusSym rect={{ x: fCol3, y: focusY, w: fCol3_w, h: 50 }} mirror />
            <KitchenSym rect={{ x: c.x, y: kitchenY, w: c.w, h: 15 }} />
        </g>
    );
}

function StairSym({ rect, mirror }: { rect: Rect; mirror?: boolean }) {
    const treads = [6, 11, 16, 21, 26, 31, 36, 41];
    const arrowX = mirror ? rect.x + rect.w * 0.35 : rect.x + rect.w * 0.65;
    return (
        <g className="sym-stair">
            {treads.map((dy, i) => (
                <line key={i} x1={rect.x + 4} y1={rect.y + dy} x2={rect.x + rect.w - 4} y2={rect.y + dy} className="cb-stroke-fine" />
            ))}
            <line x1={arrowX} y1={rect.y + 44} x2={arrowX} y2={rect.y + 8} className="cb-stroke" />
            <polyline
                points={`${arrowX - 3},${rect.y + 12} ${arrowX},${rect.y + 7} ${arrowX + 3},${rect.y + 12}`}
                className="cb-stroke"
                fill="none"
            />
            <text x={rect.x + rect.w / 2} y={rect.y + rect.h - 2} textAnchor="middle" className="room-label">STAIR</text>
        </g>
    );
}

function RestroomSym({ rect }: { rect: Rect }) {
    const midX = rect.x + rect.w / 2;
    return (
        <g className="sym-rest">
            <line x1={midX} y1={rect.y + 3} x2={midX} y2={rect.y + 35} className="cb-stroke-fine" />
            {/* M side */}
            <rect x={rect.x + 4} y={rect.y + 5} width={8} height={6} className="cb-fixture" />
            <rect x={rect.x + 14} y={rect.y + 5} width={8} height={6} className="cb-fixture" />
            <rect x={rect.x + 4} y={rect.y + 14} width={18} height={4} className="cb-fixture" />
            {/* W side */}
            <rect x={midX + 4} y={rect.y + 5} width={8} height={6} className="cb-fixture" />
            <rect x={midX + 14} y={rect.y + 5} width={8} height={6} className="cb-fixture" />
            <rect x={midX + 4} y={rect.y + 14} width={18} height={4} className="cb-fixture" />
            <text x={rect.x + rect.w * 0.25} y={rect.y + 28} textAnchor="middle" className="room-label">M</text>
            <text x={rect.x + rect.w * 0.75} y={rect.y + 28} textAnchor="middle" className="room-label">W</text>
            <text x={rect.x + rect.w / 2} y={rect.y + rect.h - 2} textAnchor="middle" className="room-label">WC</text>
        </g>
    );
}

function MeetingSym({ rect, mirror }: { rect: Rect; mirror?: boolean }) {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    return (
        <g className="sym-meeting">
            {/* Conference table */}
            <rect x={cx - 14} y={cy - 7} width={28} height={14} rx={2} className="cb-furniture" />
            {/* Chairs */}
            <circle cx={cx - 11} cy={cy - 12} r={2.2} className="cb-furniture" />
            <circle cx={cx} cy={cy - 12} r={2.2} className="cb-furniture" />
            <circle cx={cx + 11} cy={cy - 12} r={2.2} className="cb-furniture" />
            <circle cx={cx - 11} cy={cy + 12} r={2.2} className="cb-furniture" />
            <circle cx={cx} cy={cy + 12} r={2.2} className="cb-furniture" />
            <circle cx={cx + 11} cy={cy + 12} r={2.2} className="cb-furniture" />
            <circle cx={cx - 18} cy={cy} r={2.2} className="cb-furniture" />
            <circle cx={cx + 18} cy={cy} r={2.2} className="cb-furniture" />
            {/* Door arc at the corridor-facing corner (bottom-mirror or bottom) */}
            {mirror ? (
                <>
                    <path d={`M ${rect.x + 3} ${rect.y + rect.h} A 8 8 0 0 1 ${rect.x + 11} ${rect.y + rect.h - 8}`} className="door-arc" fill="none" />
                    <line x1={rect.x + 3} y1={rect.y + rect.h} x2={rect.x + 3} y2={rect.y + rect.h - 8} className="door-leaf" />
                </>
            ) : (
                <>
                    <path d={`M ${rect.x + rect.w - 3} ${rect.y + rect.h} A 8 8 0 0 0 ${rect.x + rect.w - 11} ${rect.y + rect.h - 8}`} className="door-arc" fill="none" />
                    <line x1={rect.x + rect.w - 3} y1={rect.y + rect.h} x2={rect.x + rect.w - 3} y2={rect.y + rect.h - 8} className="door-leaf" />
                </>
            )}
            <text x={cx} y={rect.y + 5} textAnchor="middle" className="room-label">MEETING</text>
        </g>
    );
}

function LiftSym({ rect }: { rect: Rect }) {
    // 4 lift cars in a 2x2 grid sharing a shaft with up/down chevrons.
    const cars = [
        { x: rect.x + 3,  y: rect.y + 6 },
        { x: rect.x + 26, y: rect.y + 6 },
        { x: rect.x + 3,  y: rect.y + 32 },
        { x: rect.x + 26, y: rect.y + 32 },
    ];
    return (
        <g className="sym-lift">
            <rect x={rect.x + 1.5} y={rect.y + 3} width={rect.w - 3} height={rect.h - 6} className="cb-lift-shaft" />
            {cars.map((c, i) => (
                <g key={i}>
                    <rect x={c.x} y={c.y} width={20} height={20} rx={0.8} className="cb-lift-car" />
                    <polyline points={`${c.x + 5},${c.y + 8} ${c.x + 10},${c.y + 4} ${c.x + 15},${c.y + 8}`} className="cb-lift-arrow" fill="none" />
                    <polyline points={`${c.x + 5},${c.y + 12} ${c.x + 10},${c.y + 16} ${c.x + 15},${c.y + 12}`} className="cb-lift-arrow" fill="none" />
                </g>
            ))}
        </g>
    );
}

function FocusSym({ rect, mirror }: { rect: Rect; mirror?: boolean }) {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2 + 1;
    return (
        <g className="sym-focus">
            <rect x={cx - 9} y={cy - 3} width={18} height={6} rx={1} className="cb-furniture" />
            <circle cx={cx} cy={cy + 9} r={3} className="cb-furniture" />
            {mirror ? (
                <>
                    <path d={`M ${rect.x + 3} ${rect.y + rect.h} A 7 7 0 0 1 ${rect.x + 10} ${rect.y + rect.h - 7}`} className="door-arc" fill="none" />
                    <line x1={rect.x + 3} y1={rect.y + rect.h} x2={rect.x + 3} y2={rect.y + rect.h - 7} className="door-leaf" />
                </>
            ) : (
                <>
                    <path d={`M ${rect.x + rect.w - 3} ${rect.y + rect.h} A 7 7 0 0 0 ${rect.x + rect.w - 10} ${rect.y + rect.h - 7}`} className="door-arc" fill="none" />
                    <line x1={rect.x + rect.w - 3} y1={rect.y + rect.h} x2={rect.x + rect.w - 3} y2={rect.y + rect.h - 7} className="door-leaf" />
                </>
            )}
            <text x={cx} y={rect.y + 5} textAnchor="middle" className="room-label">FOCUS</text>
        </g>
    );
}

function CopySym({ rect }: { rect: Rect }) {
    const cx = rect.x + rect.w / 2;
    return (
        <g className="sym-copy">
            {/* Printer */}
            <rect x={cx - 16} y={rect.y + 8} width={14} height={18} rx={1} className="cb-furniture-dark" />
            <rect x={cx - 14} y={rect.y + 12} width={10} height={3} className="cb-furniture-darker" />
            <rect x={cx - 14} y={rect.y + 18} width={10} height={1.5} className="cb-furniture-darker" />
            {/* Server rack */}
            <rect x={cx + 2} y={rect.y + 6} width={14} height={20} rx={0.6} className="cb-furniture-dark" />
            {[8, 12, 16, 20].map((dy, i) => (
                <rect key={i} x={cx + 4} y={rect.y + dy} width={10} height={2} className="cb-furniture-darker" />
            ))}
            <text x={cx} y={rect.y + rect.h - 2} textAnchor="middle" className="room-label sub-light">COPY / IT</text>
        </g>
    );
}

function KitchenSym({ rect }: { rect: Rect }) {
    // A long counter run with sink, stove, fridge — sits as a narrow band along
    // the south side of the core.
    const items = [
        { type: "sink",   cx: rect.x + 16 },
        { type: "stove",  cx: rect.x + 36 },
        { type: "fridge", cx: rect.x + 56 },
    ];
    return (
        <g className="sym-kitchen">
            <rect x={rect.x + 4} y={rect.y + 2} width={rect.w - 8} height={5} rx={0.6} className="cb-counter" />
            {items.map((it, i) => {
                if (it.type === "sink") {
                    return (
                        <g key={i}>
                            <rect x={it.cx - 5} y={rect.y + 3} width={10} height={3} rx={0.4} className="cb-fixture" />
                            <circle cx={it.cx} cy={rect.y + 4.5} r={0.6} className="cb-fixture-dot" />
                        </g>
                    );
                }
                if (it.type === "stove") {
                    return (
                        <g key={i}>
                            <rect x={it.cx - 5} y={rect.y + 3} width={10} height={3} rx={0.4} className="cb-fixture" />
                            <circle cx={it.cx - 2.5} cy={rect.y + 4.5} r={0.6} className="cb-fixture-dot" />
                            <circle cx={it.cx + 2.5} cy={rect.y + 4.5} r={0.6} className="cb-fixture-dot" />
                        </g>
                    );
                }
                return (
                    <rect key={i} x={it.cx - 4} y={rect.y + 2.5} width={8} height={5} rx={0.4} className="cb-fixture" />
                );
            })}
            <text x={rect.x + rect.w - 4} y={rect.y + 5.6} textAnchor="end" className="room-label">KITCHEN · BREAK</text>
        </g>
    );
}
