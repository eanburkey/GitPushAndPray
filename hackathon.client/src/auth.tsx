import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "./types";
import { api } from "./api";

interface AuthContextValue {
    user: User | null;
    login: (email: string) => Promise<void>;
    logout: () => void;
    updateUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "intelliDesk.user";

function loadStoredUser(): User | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
        const u = JSON.parse(raw);
        // Schema changed from string GUIDs to numeric IDs; ignore old cached shapes.
        if (typeof u.id === "number" && typeof u.email === "string") {
            // Older clients stored a single nullable `accessibilityNeed`; coerce to the
            // new array shape so the UI doesn't crash before the next login.
            if (!Array.isArray(u.accessibilityNeeds)) u.accessibilityNeeds = [];
            if (typeof u.isAutoBookingEnabled !== "boolean") u.isAutoBookingEnabled = true;
            if (typeof u.autoCheckoutTime !== "string") u.autoCheckoutTime = "10:30";
            return u as User;
        }
    } catch {
        /* fall through */
    }
    localStorage.removeItem(STORAGE_KEY);
    return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(loadStoredUser);

    useEffect(() => {
        if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
        else localStorage.removeItem(STORAGE_KEY);
    }, [user]);

    const login = useCallback(async (email: string) => {
        const { user } = await api.login(email);
        setUser(user);
    }, []);

    const logout = useCallback(() => setUser(null), []);

    const updateUser = useCallback((patch: Partial<User>) => {
        setUser(prev => (prev ? { ...prev, ...patch } : prev));
    }, []);

    const value = useMemo(() => ({ user, login, logout, updateUser }), [user, login, logout, updateUser]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
    return ctx;
}
