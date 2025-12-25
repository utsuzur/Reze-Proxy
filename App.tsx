import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/admin/Login';
import Offerings from './pages/admin/Offerings';
import ManageTokens from './pages/admin/ManageTokens';
import Dashboard from './pages/admin/Dashboard';

// Protected Route Component
const ProtectedRoute = ({ children }: { children?: React.ReactNode }) => {
  const isAuthenticated = sessionStorage.getItem('reze_auth') === 'true';
  if (!isAuthenticated) {
    return <Navigate to="/shrine/login" replace />;
  }
  return <Layout isAdmin={true}>{children}</Layout>;
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