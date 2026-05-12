import type { AccessibilityType } from "../types";

export const ACCESSIBILITY_LABELS: Record<AccessibilityType, string> = {
    StandingDesk: "Standing desk",
    TreadmillDesk: "Treadmill desk",
    LargeMonitor: "Large monitor",
    DualMonitor: "Dual monitor",
};

// Short glyph used to badge the desk on the floor plan. We use printable
// unicode so it renders the same in SVG <text> and in the modal.
export const ACCESSIBILITY_GLYPHS: Record<AccessibilityType, string> = {
    StandingDesk: "↥",
    TreadmillDesk: "🏃",
    LargeMonitor: "▣",
    DualMonitor: "⧉",
};

export const ACCESSIBILITY_COLOR = "#0891b2"; // teal-600 — clearly distinct from team colours.

interface Props {
    type: AccessibilityType;
    size?: number;
}

export function AccessibilityChip({ type, size = 16 }: Props) {
    return (
        <span
            className="a11y-chip"
            title={ACCESSIBILITY_LABELS[type]}
            style={{
                width: size,
                height: size,
                fontSize: size * 0.7,
                lineHeight: `${size}px`,
            }}
        >
            {ACCESSIBILITY_GLYPHS[type]}
        </span>
    );
}
