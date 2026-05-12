import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import FloorPlan from "./FloorPlan";
import type { FloorDesk } from "../types";

const CANVAS_WIDTH = 1000;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 8;

interface Props {
    floor: number;
    date: string;
    focusDeskId?: number;
    currentUserId?: number;
    onClose: () => void;
}

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

export default function FullFloorMapModal({
    floor,
    date,
    focusDeskId,
    currentUserId,
    onClose,
}: Props) {
    const [desks, setDesks] = useState<FloorDesk[]>([]);
    const [zoom, setZoom] = useState(1.4);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [ready, setReady] = useState(false);
    const [dragging, setDragging] = useState(false);
    const viewportRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

    useEffect(() => {
        let alive = true;
        api.floorDesks(floor, date).then(d => {
            if (alive) setDesks(d);
        });
        return () => {
            alive = false;
        };
    }, [floor, date]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    useLayoutEffect(() => {
        if (!viewportRef.current || !canvasRef.current || desks.length === 0) return;
        const vp = viewportRef.current.getBoundingClientRect();
        if (focusDeskId !== undefined) {
            const deskEl = canvasRef.current.querySelector<SVGGElement>(
                `[data-desk-id="${focusDeskId}"]`,
            );
            if (deskEl) {
                const canvasRect = canvasRef.current.getBoundingClientRect();
                const deskRect = deskEl.getBoundingClientRect();
                const cx = deskRect.left + deskRect.width / 2 - canvasRect.left;
                const cy = deskRect.top + deskRect.height / 2 - canvasRect.top;
                const initialZoom = 1.6;
                setZoom(initialZoom);
                setPan({
                    x: vp.width / 2 - cx * initialZoom,
                    y: vp.height / 2 - cy * initialZoom,
                });
                setReady(true);
                return;
            }
        }
        const initialZoom = 1;
        const canvasRect = canvasRef.current.getBoundingClientRect();
        setZoom(initialZoom);
        setPan({
            x: (vp.width - canvasRect.width * initialZoom) / 2,
            y: (vp.height - canvasRect.height * initialZoom) / 2,
        });
        setReady(true);
    }, [desks, focusDeskId]);

    const onWheel = (e: React.WheelEvent) => {
        if (!viewportRef.current) return;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
        if (newZoom === zoom) return;
        const rect = viewportRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const ratio = newZoom / zoom;
        setPan({ x: mx - (mx - pan.x) * ratio, y: my - (my - pan.y) * ratio });
        setZoom(newZoom);
    };

    const onMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        setDragging(true);
    };
    const onMouseMove = (e: React.MouseEvent) => {
        if (!dragRef.current) return;
        setPan({
            x: dragRef.current.panX + (e.clientX - dragRef.current.x),
            y: dragRef.current.panY + (e.clientY - dragRef.current.y),
        });
    };
    const stopDrag = () => {
        dragRef.current = null;
        setDragging(false);
    };

    const zoomBy = (factor: number) => {
        if (!viewportRef.current) return;
        const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const rect = viewportRef.current.getBoundingClientRect();
        const mx = rect.width / 2;
        const my = rect.height / 2;
        const ratio = newZoom / zoom;
        setPan({ x: mx - (mx - pan.x) * ratio, y: my - (my - pan.y) * ratio });
        setZoom(newZoom);
    };

    const recenter = () => {
        if (!viewportRef.current || !canvasRef.current || focusDeskId === undefined) return;
        const deskEl = canvasRef.current.querySelector<SVGGElement>(
            `[data-desk-id="${focusDeskId}"]`,
        );
        if (!deskEl) return;
        const vp = viewportRef.current.getBoundingClientRect();
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const deskRect = deskEl.getBoundingClientRect();
        const currentScale = canvasRect.width / CANVAS_WIDTH;
        const cx = (deskRect.left + deskRect.width / 2 - canvasRect.left) / currentScale;
        const cy = (deskRect.top + deskRect.height / 2 - canvasRect.top) / currentScale;
        setPan({ x: vp.width / 2 - cx * zoom, y: vp.height / 2 - cy * zoom });
    };

    // Call recenter when the modal is visible, desks are loaded, and ready is true
    useEffect(() => {
        if (ready && desks.length > 0 && focusDeskId !== undefined) {
            recenter();
        }
        // Only run when ready, desks, or focusDeskId changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, desks, focusDeskId]);

    return (
        <div className="modal-backdrop map-modal-backdrop" onClick={onClose}>
            <div className="map-modal" onClick={e => e.stopPropagation()}>
                <button className="modal-close" onClick={onClose} aria-label="Close map">×</button>
                <div className="map-modal-toolbar">
                    <div className="map-modal-title">
                        Floor {floor}
                        <span className="muted"> · {date}</span>
                    </div>
                    <div className="map-modal-controls">
                        {focusDeskId !== undefined && (
                            <button className="ghost-btn" onClick={recenter}>Recenter</button>
                        )}
                        <button className="ghost-btn" onClick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
                        <span className="map-modal-zoom">{Math.round(zoom * 100)}%</span>
                        <button className="ghost-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
                    </div>
                </div>
                <div
                    ref={viewportRef}
                    className={`map-modal-viewport${dragging ? " is-dragging" : ""}`}
                    onWheel={onWheel}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={stopDrag}
                    onMouseLeave={stopDrag}
                >
                    <div
                        ref={canvasRef}
                        className="map-modal-canvas"
                        style={{
                            width: CANVAS_WIDTH,
                            transformOrigin: "0 0",
                            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                            opacity: ready ? 1 : 0,
                        }}
                    >
                        <FloorPlan
                            desks={desks}
                            selectedDeskId={focusDeskId ?? null}
                            onSelect={() => undefined}
                            currentUserId={currentUserId}
                        />
                    </div>
                </div>
                <div className="map-modal-hint muted">
                    Scroll to zoom · drag to pan · Esc to close
                </div>
            </div>
        </div>
    );
}
