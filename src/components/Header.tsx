import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, LayoutDashboard, FileText } from 'lucide-react';

const Header: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    if (!user) return null;

    const handleLogout = async () => {
        try {
            await logout();
            navigate('/login');
        } catch (error) {
            console.error("Failed to log out", error);
        }
    };

    return (
        <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
            <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-black rounded flex items-center justify-center text-white font-bold">
                        C
                    </div>
                    <h1 className="text-xl font-bold tracking-tight text-gray-900">CartonERP</h1>
                </div>

                <div className="flex items-center gap-4">
                    <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium text-gray-900">{user.email}</p>
                        <p className="text-xs text-gray-500 capitalize">{user.role}</p>
                    </div>

                    <div className="h-8 w-px bg-gray-200 mx-2 hidden sm:block"></div>


                    {(user.role === 'admin' ||
                        ['hemk3672@gmail.com', 'rojes@gmail.com'].includes((user.email || '').toLowerCase())) && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => navigate('/')}
                                    className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${location.pathname === '/' ? 'bg-gray-100 text-black' : 'text-gray-700 hover:text-black hover:bg-gray-50'
                                        }`}
                                    title="Go to Data Entry"
                                >
                                    <FileText size={18} />
                                    <span className="hidden sm:inline">Entry</span>
                                </button>

                                <button
                                    onClick={() => navigate('/admin')}
                                    className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${location.pathname === '/admin' ? 'bg-gray-100 text-black' : 'text-gray-700 hover:text-black hover:bg-gray-50'
                                        }`}
                                    title="Go to Admin Panel"
                                >
                                    <LayoutDashboard size={18} />
                                    <span className="hidden sm:inline">Admin</span>
                                </button>
                            </div>
                        )}

                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors"
                    >
                        <LogOut size={18} />
                        <span className="hidden sm:inline">Logout</span>
                    </button>
                </div>
            </div>
        </header>
    );
};

export default Header;
