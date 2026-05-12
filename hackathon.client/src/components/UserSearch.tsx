import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "../types";

interface Props {
    users: User[];
    onSelect: (user: User) => void;
    disabled?: boolean;
}

const MAX_RESULTS = 8;

export default function UserSearch({ users, onSelect, disabled }: Props) {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [highlightedIdx, setHighlightedIdx] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return users
            .filter(u =>
                u.name.toLowerCase().includes(q) ||
                u.email.toLowerCase().includes(q))
            .slice(0, MAX_RESULTS);
    }, [users, query]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const select = (u: User) => {
        setQuery(u.name);
        setOpen(false);
        onSelect(u);
    };

    return (
        <div ref={containerRef} className="user-search">
            <span className="user-search-icon" aria-hidden>🔍</span>
            <input
                type="search"
                value={query}
                onChange={e => {
                    setQuery(e.target.value);
                    setOpen(true);
                    setHighlightedIdx(0);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={e => {
                    if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setHighlightedIdx(i => Math.min(matches.length - 1, i + 1));
                    } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setHighlightedIdx(i => Math.max(0, i - 1));
                    } else if (e.key === "Enter" && matches[highlightedIdx]) {
                        e.preventDefault();
                        select(matches[highlightedIdx]);
                    } else if (e.key === "Escape") {
                        setOpen(false);
                    }
                }}
                placeholder="Find a person on the floor…"
                aria-label="Find a person on the floor"
                disabled={disabled}
                autoComplete="off"
            />
            {open && query.trim() && (
                <ul className="user-search-results" role="listbox">
                    {matches.length === 0 ? (
                        <li className="user-search-empty">No people match "{query}".</li>
                    ) : (
                        matches.map((u, i) => (
                            <li
                                key={u.id}
                                role="option"
                                aria-selected={i === highlightedIdx}
                                className={i === highlightedIdx ? "highlighted" : ""}
                                onMouseDown={e => {
                                    e.preventDefault();
                                    select(u);
                                }}
                                onMouseEnter={() => setHighlightedIdx(i)}
                            >
                                <span
                                    className="user-search-avatar"
                                    style={{ background: u.teamColor ?? "#94a3b8" }}
                                >
                                    {u.initials}
                                </span>
                                <span className="user-search-text">
                                    <span className="user-search-name">{u.name}</span>
                                    <span className="user-search-team">{u.teamName ?? "—"}</span>
                                </span>
                            </li>
                        ))
                    )}
                </ul>
            )}
        </div>
    );
}
