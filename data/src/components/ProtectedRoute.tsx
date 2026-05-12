import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
    allowedRoles?: ('admin' | 'data-entry')[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
    const { user, loading } = useAuth();

    if (loading) {
        return <div className="h-screen w-full flex items-center justify-center">Loading...</div>;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    // HARDCODED ADMIN EMAIL BYPASS
    // This acts as a secondary safety net if AuthContext role is incorrect.
    const ADMIN_EMAILS = ['hemk3672@gmail.com', 'rojes@gmail.com'];
    const isHardcodedAdmin = user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());

    if (allowedRoles && !allowedRoles.includes(user.role) && !isHardcodedAdmin) {
        console.warn(`⛔ PROTECTED ROUTE BLOCKED: User role '${user.role}' not in allowed [${allowedRoles.join(', ')}]`);
        // If admin tries to go to data-entry only route (if any) or vice versa
        // Though usually admin can access everything, prompts said:
        // "Data Entry users must NEVER see Admin Panel button/page"
        // "Data Entry users: Cannot access Admin Panel"
        return <Navigate to="/" replace />;
    }

    console.log(`✅ PROTECTED ROUTE ACCESS GRANTED: ${user.role} -> Path allowed`);
    return <Outlet />;
};
