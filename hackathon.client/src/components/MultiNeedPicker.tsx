import { useEffect, useRef, useState } from "react";
import type { AccessibilityType } from "../types";
import { ACCESSIBILITY_GLYPHS, ACCESSIBILITY_LABELS } from "./AccessibilityIcon";

const ALL_TYPES: AccessibilityType[] = ["StandingDesk", "TreadmillDesk", "LargeMonitor", "DualMonitor"];

interface Props {
    selected: AccessibilityType[];
    onChange: (next: AccessibilityType[]) => void;
    disabled?: boolean;
}

export default function MultiNeedPicker({ selected, onChange, disabled }: Props) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const toggle = (type: AccessibilityType) => {
        if (disabled) return;
        const has = selected.includes(type);
        onChange(has ? selected.filter(t => t !== type) : [...selected, type]);
    };

    const clear = () => {
        if (disabled) return;
        if (selected.length > 0) onChange([]);
    };

    return (
        <div className="multi-need" ref={rootRef}>
            <button
                type="button"
                className="multi-need-button"
                onClick={() => !disabled && setOpen(v => !v)}
                aria-expanded={open}
                aria-haspopup="listbox"
                disabled={disabled}
            >
                {selected.length === 0 ? (
                    <span className="muted">No needs</span>
                ) : (
                    <span className="multi-need-chips">
                        {selected.map(t => (
                            <span key={t} className="multi-need-chip" title={ACCESSIBILITY_LABELS[t]}>
                                <span aria-hidden>{ACCESSIBILITY_GLYPHS[t]}</span>
                                {ACCESSIBILITY_LABELS[t]}
                            </span>
                        ))}
                    </span>
                )}
                <span className="multi-need-caret" aria-hidden>▾</span>
            </button>

            {open && (
                <div className="multi-need-menu" role="listbox">
                    {ALL_TYPES.map(t => {
                        const checked = selected.includes(t);
                        return (
                            <label key={t} className={`multi-need-option ${checked ? "is-on" : ""}`}>
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(t)}
                                />
                                <span aria-hidden style={{ width: 18, textAlign: "center" }}>
                                    {ACCESSIBILITY_GLYPHS[t]}
                                </span>
                                {ACCESSIBILITY_LABELS[t]}
                            </label>
                        );
                    })}
                    <div className="multi-need-footer">
                        <button type="button" className="link-btn" onClick={clear} disabled={selected.length === 0}>
                            Clear all
                        </button>
                        <button type="button" className="link-btn" onClick={() => setOpen(false)}>
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
