import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    
    // In a real app, this would hit a backend auth endpoint.
    // For this demo/frontend artifact, we check env vars or fallback default.
    const envUser = process.env.REACT_APP_ADMIN_USER || 'admin';
    const envPass = process.env.REACT_APP_ADMIN_PASSWORD || 'password';

    if (username === envUser && password === envPass) {
      // Set a simple flag in session storage
      sessionStorage.setItem('reze_auth', 'true');
      navigate('/shrine/offerings');
    } else {
      setError('Invalid credentials. The shrine is closed to strangers.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-reze-100">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-reze-100 rounded-full mb-4 text-reze-600">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Shrine Access</h2>
          <p className="text-slate-500 text-sm mt-2">Enter your credentials to continue</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg text-center">
              {error}
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-reze-500 focus:border-transparent transition-all"
              placeholder="admin"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-reze-500 focus:border-transparent transition-all"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-reze-600 hover:bg-reze-700 text-white font-medium rounded-lg transition-colors shadow-lg shadow-reze-200"
          >
            Enter Shrine
          </button>
        </form>
        
        <div className="mt-6 text-center text-xs text-slate-400">
           Enter your Shrine credentials.
        </div>
      </div>
    </div>
  );
};

export default Login;
