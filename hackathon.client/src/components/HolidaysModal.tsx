import { useEffect } from "react";
import HolidaysCard from "./HolidaysCard";

interface Props {
    userId: number;
    onClose: () => void;
}

export default function HolidaysModal({ userId, onClose }: Props) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div
                className="modal-card holidays-modal-card"
                onClick={e => e.stopPropagation()}
            >
                <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
                <HolidaysCard userId={userId} />
            </div>
        </div>
    );
}
