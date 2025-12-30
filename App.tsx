import React, { Suspense, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/admin/Login';

// Lazy Load Admin Pages
const Dashboard = React.lazy(() => import('./pages/admin/Dashboard'));
const Offerings = React.lazy(() => import('./pages/admin/Offerings'));
const ManageTokens = React.lazy(() => import('./pages/admin/ManageTokens'));

// Loading Component
const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="w-8 h-8 border-4 border-reze-200 border-t-reze-600 rounded-full animate-spin"></div>
  </div>
);

// Protected Route Component (server-verified cookie session)
const ProtectedRoute = ({ children }: { children?: React.ReactNode }) => {
  const [status, setStatus] = useState<'loading' | 'authed' | 'unauthed'>('loading');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/admin/me', { credentials: 'same-origin' });
        if (!res.ok) {
          if (!cancelled) setStatus('unauthed');
          return;
        }
        const data = await res.json();
        if (!cancelled) setStatus(data?.authenticated ? 'authed' : 'unauthed');
      } catch {
        if (!cancelled) setStatus('unauthed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return <LoadingFallback />;
  }

  if (status === 'unauthed') {
    return <Navigate to="/shrine/login" replace />;
  }

  return (
    <Layout isAdmin={true}>
      <Suspense fallback={<LoadingFallback />}>{children}</Suspense>
    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <Router>
      <Routes>
        {/* Public Route */}
        <Route path="/" element={
            <Layout>
                <Home />
            </Layout>
        } />

        {/* Admin Login */}
        <Route path="/shrine/login" element={<Login />} />
        
        {/* Protected Admin Routes */}
        <Route path="/shrine" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        
        <Route path="/shrine/offerings" element={
          <ProtectedRoute>
            <Offerings />
          </ProtectedRoute>
        } />
        
        <Route path="/shrine/manage-tokens" element={
          <ProtectedRoute>
            <ManageTokens />
          </ProtectedRoute>
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;