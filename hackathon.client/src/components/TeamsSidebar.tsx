import { useMemo, useState } from "react";
import type { ActiveVirtualTeam, Team } from "../types";

export type SidebarSelection =
    | { kind: "team"; team: Team }
    | { kind: "virtual"; team: ActiveVirtualTeam };

interface Props {
    open: boolean;
    teams: Team[];
    virtualTeams: ActiveVirtualTeam[];
    myTeamId: number | null;
    favouriteIds: number[];
    selectedTeamId: number | null;
    selectedVirtualTeamId: number | null;
    inOfficeTeamIds: Set<number>;
    onToggleFavourite: (teamId: number) => void;
    onSelect: (selection: SidebarSelection) => void;
    onClose: () => void;
}

export default function TeamsSidebar({
    open,
    teams,
    virtualTeams,
    myTeamId,
    favouriteIds,
    selectedTeamId,
    selectedVirtualTeamId,
    inOfficeTeamIds,
    onToggleFavourite,
    onSelect,
    onClose,
}: Props) {
    const [search, setSearch] = useState("");

    const q = search.trim().toLowerCase();

    const filteredVirtual = useMemo(() => {
        if (!q) return virtualTeams;
        return virtualTeams.filter(v => v.name.toLowerCase().includes(q));
    }, [virtualTeams, q]);

    const grouped = useMemo(() => {
        const favSet = new Set(favouriteIds);
        const matches = (t: Team) =>
            !q ||
            t.name.toLowerCase().includes(q) ||
            (t.homeWing ?? "").toLowerCase().includes(q) ||
            String(t.homeFloor).includes(q);
        const my = myTeamId == null ? [] : teams.filter(t => t.id === myTeamId && matches(t));
        const favs = teams.filter(t => favSet.has(t.id) && t.id !== myTeamId && matches(t));
        const others = teams.filter(t => t.id !== myTeamId && !favSet.has(t.id) && matches(t));
        return { my, favs, others };
    }, [teams, myTeamId, favouriteIds, q]);

    const totalMatches =
        filteredVirtual.length + grouped.my.length + grouped.favs.length + grouped.others.length;

    if (!open) return null;

    return (
        <aside className="teams-sidebar">
            <header className="teams-sidebar-head">
                <h3>Teams</h3>
                <button className="ghost-btn" onClick={onClose}>Close</button>
            </header>
            <div className="teams-sidebar-search">
                <input
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search teams"
                    aria-label="Search teams"
                />
            </div>
            <div className="teams-sidebar-body">
                {filteredVirtual.length > 0 && (
                    <Section title="Virtual teams">
                        {filteredVirtual.map(v => (
                            <VirtualTeamRow
                                key={v.id}
                                team={v}
                                selected={v.id === selectedVirtualTeamId}
                                onSelect={() => onSelect({ kind: "virtual", team: v })}
                            />
                        ))}
                    </Section>
                )}
                {grouped.my.length > 0 && (
                    <Section title="Your team">
                        {grouped.my.map(t => (
                            <TeamRow
                                key={t.id}
                                team={t}
                                selected={t.id === selectedTeamId}
                                isFavourite={favouriteIds.includes(t.id)}
                                inOffice={inOfficeTeamIds.has(t.id)}
                                onSelect={() => onSelect({ kind: "team", team: t })}
                                onToggleFavourite={() => onToggleFavourite(t.id)}
                            />
                        ))}
                    </Section>
                )}
                {grouped.favs.length > 0 && (
                    <Section title="Favourites">
                        {grouped.favs.map(t => (
                            <TeamRow
                                key={t.id}
                                team={t}
                                selected={t.id === selectedTeamId}
                                isFavourite
                                inOffice={inOfficeTeamIds.has(t.id)}
                                onSelect={() => onSelect({ kind: "team", team: t })}
                                onToggleFavourite={() => onToggleFavourite(t.id)}
                            />
                        ))}
                    </Section>
                )}
                {grouped.others.length > 0 && (
                    <Section title={grouped.my.length || grouped.favs.length ? "All other teams" : "All teams"}>
                        {grouped.others.map(t => (
                            <TeamRow
                                key={t.id}
                                team={t}
                                selected={t.id === selectedTeamId}
                                isFavourite={false}
                                inOffice={inOfficeTeamIds.has(t.id)}
                                onSelect={() => onSelect({ kind: "team", team: t })}
                                onToggleFavourite={() => onToggleFavourite(t.id)}
                            />
                        ))}
                    </Section>
                )}
                {totalMatches === 0 && (
                    <div className="empty" style={{ padding: 16 }}>
                        No teams match "{search}".
                    </div>
                )}
            </div>
        </aside>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="teams-section">
            <div className="teams-section-title">{title}</div>
            <ul className="teams-list">{children}</ul>
        </div>
    );
}

interface TeamRowProps {
    team: Team;
    selected: boolean;
    isFavourite: boolean;
    inOffice: boolean;
    onSelect: () => void;
    onToggleFavourite: () => void;
}

function TeamRow({ team, selected, isFavourite, inOffice, onSelect, onToggleFavourite }: TeamRowProps) {
    const swatchColor = inOffice ? team.color : "#cbd5e1";
    return (
        <li className={`teams-row ${selected ? "selected" : ""} ${inOffice ? "" : "is-absent"}`}>
            <button className="teams-row-main" onClick={onSelect}>
                <span
                    className="team-swatch"
                    style={{ background: swatchColor }}
                    title={inOffice ? "Has members in the office today" : "No members in the office today"}
                />
                <span className="teams-row-text">
                    <span className="teams-row-name">{team.name}</span>
                    <span className="teams-row-meta">
                        Floor {team.homeFloor} · {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
                        {!inOffice && " · none in today"}
                    </span>
                </span>
            </button>
            <button
                className={`fav-btn ${isFavourite ? "is-fav" : ""}`}
                onClick={onToggleFavourite}
                title={isFavourite ? "Remove favourite" : "Favourite this team"}
                aria-label={isFavourite ? "Remove favourite" : "Favourite this team"}
            >
                {isFavourite ? "★" : "☆"}
            </button>
        </li>
    );
}

interface VirtualTeamRowProps {
    team: ActiveVirtualTeam;
    selected: boolean;
    onSelect: () => void;
}

function VirtualTeamRow({ team, selected, onSelect }: VirtualTeamRowProps) {
    return (
        <li className={`teams-row is-virtual ${selected ? "selected" : ""}`}>
            <button className="teams-row-main" onClick={onSelect}>
                <span
                    className="team-swatch"
                    style={{ background: team.color, borderRadius: 999 }}
                    title="Virtual team"
                />
                <span className="teams-row-text">
                    <span className="teams-row-name">
                        {team.name}
                        <span
                            className="virtual-pill"
                            style={{
                                marginLeft: 6, fontSize: 10, padding: "1px 6px",
                                borderRadius: 999, background: team.color, color: "#fff",
                                verticalAlign: "middle", fontWeight: 600, letterSpacing: 0.3,
                            }}
                        >VIRTUAL</span>
                    </span>
                    <span className="teams-row-meta">
                        Floor {team.homeFloor} {team.homeWing} · {team.memberCount} {team.memberCount === 1 ? "member" : "members"} · ends {team.endDate}
                    </span>
                </span>
            </button>
        </li>
    );
}
