import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import AccountMenu from "./AccountMenu";
import NotificationBell from "./NotificationBell";

export default function Layout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    return (
        <div className="app-shell">
            <header className="app-header">
                <Link to="/" className="brand">
                    <img className="brand-mark" src="/public/LBG_Logo.png"/>
                    <span className="brand-name">IntelliDesk</span>
                </Link>
                <nav className="app-nav">
                    <NavLink to="/" end>Dashboard</NavLink>
                    <NavLink to="/floors">Floor map</NavLink>
                    {user && (user.role === "TeamManager" || user.role === "Admin") && (
                        <NavLink to="/team-days">Team days</NavLink>
                    )}
                    {user && (user.role === "TeamManager" || user.role === "Admin") && (
                        <NavLink to="/virtual-teams">Virtual teams</NavLink>
                    )}
                    {user?.role === "Admin" && <NavLink to="/planner">Office planner</NavLink>}
                    {user && (user.role === "TeamManager" || user.role === "Admin") && <NavLink to="/accessibility">Accessibility</NavLink>}
                </nav>
                <div className="user-block">
                    {user && <NotificationBell />}
                    {user && <AccountMenu user={user} onSignOut={handleLogout} />}
                </div>
            </header>
            <main className="app-main">
                <Outlet />
            </main>
        </div>
    );
}
