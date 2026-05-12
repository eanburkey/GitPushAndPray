import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import FloorPlan from "./FloorPlan";
import type { FloorDesk } from "../types";

const CANVAS_WIDTH = 1000;

interface Props {
    floor: number;
    date: string;
    deskId: number;
    currentUserId?: number;
    diameter?: number;
    zoom?: number;
    onClick?: () => void;
}

export default function MiniFloorPlan({
    floor,
    date,
    deskId,
    currentUserId,
    diameter = 280,
    zoom = 1,
    onClick,
}: Props) {
    const [desks, setDesks] = useState<FloorDesk[]>([]);
    const [transform, setTransform] = useState<string | null>(null);
    const canvasRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let alive = true;
        setTransform(null);
        api.floorDesks(floor, date).then(d => {
            if (alive) setDesks(d);
        });
        return () => {
            alive = false;
        };
    }, [floor, date]);

    useLayoutEffect(() => {
        if (!canvasRef.current || desks.length === 0) return;
        const deskEl = canvasRef.current.querySelector<SVGGElement>(
            `[data-desk-id="${deskId}"]`,
        );
        if (!deskEl) return;
        const containerRect = canvasRef.current.getBoundingClientRect();
        const deskRect = deskEl.getBoundingClientRect();
        // Any ancestor CSS transform (e.g. neighbour cards in the bookings
        // carousel use scale(0.78)) scales getBoundingClientRect into screen
        // px. Normalise back into the canvas's own coordinate space, otherwise
        // the centering math is off by that scale factor.
        const parentScale = containerRect.width / CANVAS_WIDTH || 1;
        const cx = (deskRect.left + deskRect.width / 2 - containerRect.left) / parentScale;
        const cy = (deskRect.top + deskRect.height / 2 - containerRect.top) / parentScale;
        const dx = diameter / 2 - cx * zoom;
        const dy = diameter / 2 - cy * zoom;
        setTransform(`translate(${dx}px, ${dy}px) scale(${zoom})`);
    }, [desks, deskId, diameter, zoom]);

    const interactive = !!onClick;

    return (
        <div
            className={`mini-floor${interactive ? " is-clickable" : ""}`}
            style={{ width: diameter, height: diameter }}
            onClick={onClick}
            onKeyDown={e => {
                if (onClick && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onClick();
                }
            }}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? "Open full floor map" : undefined}
        >
            <div
                ref={canvasRef}
                className="mini-floor-canvas"
                style={{
                    width: CANVAS_WIDTH,
                    transformOrigin: "0 0",
                    transform: transform ?? "scale(1)",
                    opacity: transform ? 1 : 0,
                }}
            >
                <FloorPlan
                    desks={desks}
                    selectedDeskId={null}
                    onSelect={() => undefined}
                    currentUserId={currentUserId}
                />
            </div>
            {!transform && <div className="mini-floor-loading">Loading map…</div>}
            {interactive && (
                <div className="mini-floor-overlay" aria-hidden="true">
                    <span className="mini-floor-overlay-text">Expand map</span>
                </div>
            )}
        </div>
    );
}
