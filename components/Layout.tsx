import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Shield, Home, Server, Key, LayoutDashboard, Menu, X, AlertTriangle } from 'lucide-react';

interface LayoutProps {
  children?: React.ReactNode;
  isAdmin?: boolean;
}

const getCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;

  const parts = document.cookie.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return null;
};

const Layout: React.FC<LayoutProps> = ({ children, isAdmin = false }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  const adminPost = async (url: string) => {
    const csrf = getCookie('reze_csrf');

    await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {}
    });
  };

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await adminPost('/api/admin/logout');
    } finally {
      setIsSigningOut(false);
      navigate('/shrine/login', { replace: true });
    }
  };

  const handleLogoutAll = async () => {
    if (!window.confirm('Log out everywhere? This will revoke all admin sessions.')) return;

    setIsSigningOut(true);
    try {
      await adminPost('/api/admin/logout-all');
    } finally {
      setIsSigningOut(false);
      navigate('/shrine/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-reze-200">
      {isAdmin && (
        <>
          {/* Mobile Header */}
          <div className="md:hidden fixed top-0 left-0 right-0 bg-white border-b border-reze-100 px-4 py-3 flex items-center justify-between z-40 shadow-sm">
            <div className="flex items-center gap-2 font-bold text-reze-600">
              <Shield className="w-5 h-5" />
              <span>Reze Shrine</span>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg focus:outline-none"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {/* Backdrop */}
          {isMobileMenuOpen && (
            <div
              className="fixed inset-0 bg-black/20 z-40 md:hidden backdrop-blur-sm"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          {/* Sidebar */}
          <nav
            className={`fixed left-0 top-0 h-full w-64 bg-white border-r border-reze-100 flex flex-col shadow-xl z-50 transition-transform duration-300 md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
          >
            <div className="p-6 border-b border-reze-50">
              <h1 className="text-xl font-bold text-reze-600 flex items-center gap-2">
                <Shield className="w-6 h-6" />
                Reze Shrine
              </h1>
              <p className="text-xs text-slate-400 mt-1">Admin Control Panel</p>
            </div>

            <div className="flex-1 py-6 px-3 space-y-1">
              <Link
                to="/shrine"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive('/shrine') ? 'bg-reze-50 text-reze-700 font-medium' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                <LayoutDashboard className="w-5 h-5" />
                Dashboard
              </Link>
              <Link
                to="/shrine/offerings"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive('/shrine/offerings') ? 'bg-reze-50 text-reze-700 font-medium' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                <Server className="w-5 h-5" />
                Offerings (Models)
              </Link>
              <Link
                to="/shrine/manage-tokens"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive('/shrine/manage-tokens') ? 'bg-reze-50 text-reze-700 font-medium' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                <Key className="w-5 h-5" />
                User Tokens
              </Link>
              <Link
                to="/shrine/errors"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive('/shrine/errors') ? 'bg-reze-50 text-reze-700 font-medium' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                <AlertTriangle className="w-5 h-5" />
                Error Logs
              </Link>
            </div>

            <div className="p-4 border-t border-reze-50 space-y-2">
              <button
                onClick={handleLogout}
                disabled={isSigningOut}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors"
              >
                Logout
              </button>
              <button
                onClick={handleLogoutAll}
                disabled={isSigningOut}
                className="w-full px-3 py-2 text-sm rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60 transition-colors"
              >
                Logout Everywhere
              </button>

              <Link to="/" className="mt-2 flex items-center gap-2 text-sm text-slate-500 hover:text-reze-600 transition-colors">
                <Home className="w-4 h-4" />
                Return to Public
              </Link>
            </div>
          </nav>
        </>
      )}

      <main className={`${isAdmin ? 'md:ml-64 pt-16 md:pt-0' : ''} min-h-screen transition-all duration-300`}>
        <div className="container mx-auto px-4 py-6 md:px-8 md:py-8 max-w-7xl">{children}</div>
      </main>
    </div>
  );
};

export default Layout;