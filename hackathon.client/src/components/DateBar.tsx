interface Props {
    value: string;
    onChange: (date: string) => void;
}

function addDays(iso: string, days: number) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

export const MAX_DAYS_AHEAD = 14;

function today() {
    return new Date().toISOString().slice(0, 10);
}
function maxDate() {
    return addDays(today(), MAX_DAYS_AHEAD);
}

function clamp(date: string) {
    if (date < today()) return today();
    if (date > maxDate()) return maxDate();
    return date;
}

export default function DateBar({ value, onChange }: Props) {
    const min = today();
    const max = maxDate();
    return (
        <div className="date-bar">
            <button
                className="ghost-btn"
                disabled={value <= min}
                onClick={() => onChange(clamp(addDays(value, -1)))}
            >‹</button>
            <input
                type="date"
                value={value}
                min={min}
                max={max}
                onChange={e => onChange(clamp(e.target.value))}
            />
            <button
                className="ghost-btn"
                disabled={value >= max}
                onClick={() => onChange(clamp(addDays(value, 1)))}
            >›</button>
            <button className="ghost-btn" onClick={() => onChange(today())}>Today</button>
        </div>
    );
}
