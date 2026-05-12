import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { NotificationsProvider } from "./notifications";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import FloorsPage from "./pages/FloorsPage";
import TeamDaysPage from "./pages/TeamDaysPage";
import VirtualTeamsPage from "./pages/VirtualTeamsPage";
import PlannerPage from "./pages/PlannerPage";
import AccessibilityPage from "./pages/AccessibilityPage";
import type { Role } from "./types";
import "./App.css";

function RequireAuth({ children }: { children: React.ReactElement }) {
    const { user } = useAuth();
    return user ? children : <Navigate to="/login" replace />;
}

function RequireRole({ allow, children }: { allow: Role[]; children: React.ReactElement }) {
    const { user } = useAuth();
    if (!user) return <Navigate to="/login" replace />;
    return allow.includes(user.role) ? children : <Navigate to="/" replace />;
}

export default function App() {
    return (
        <AuthProvider>
            <NotificationsProvider>
                <BrowserRouter>
                    <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route
                        path="/"
                        element={
                            <RequireAuth>
                                <Layout />
                            </RequireAuth>
                        }
                    >
                        <Route index element={<DashboardPage />} />
                        <Route path="floors" element={<FloorsPage />} />
                        <Route
                            path="team-days"
                            element={
                                <RequireRole allow={["TeamManager", "Admin"]}>
                                    <TeamDaysPage />
                                </RequireRole>
                            }
                        />
                        <Route
                            path="virtual-teams"
                            element={
                                <RequireRole allow={["TeamManager", "Admin"]}>
                                    <VirtualTeamsPage />
                                </RequireRole>
                            }
                        />
                        <Route
                            path="planner"
                            element={
                                <RequireRole allow={["Admin"]}>
                                    <PlannerPage />
                                </RequireRole>
                            }
                        />
                        <Route
                            path="accessibility"
                            element={
                                <RequireRole allow={["TeamManager", "Admin"]}>
                                    <AccessibilityPage />
                                </RequireRole>
                            }
                        />
                    </Route>
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </BrowserRouter>
            </NotificationsProvider>
        </AuthProvider>
    );
}
