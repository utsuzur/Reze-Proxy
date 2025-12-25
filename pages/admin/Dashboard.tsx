import React, { useEffect, useState } from 'react';
import { storageService } from '../../services/storageService';
import { Provider, ModelConfig, UserToken } from '../../types';
import { Server, Cpu, Key, Activity } from 'lucide-react';

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState({
    providers: 0,
    models: 0,
    activeModels: 0,
    tokens: 0,
  });

  useEffect(() => {
    const fetchData = async () => {
      const providers = await storageService.getProviders();
      const models = await storageService.getModels();
      const tokens = await storageService.getTokens();

      setStats({
        providers: providers.length,
        models: models.length,
        activeModels: models.filter(m => m.isActive).length,
        tokens: tokens.length,
      });
    };
    fetchData();
  }, []);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Shrine Dashboard</h1>
        <p className="text-slate-500">Overview of the Reze Proxy system status</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Providers Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <Server className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">Total Providers</p>
            <h3 className="text-2xl font-bold text-slate-800">{stats.providers}</h3>
          </div>
        </div>

        {/* Models Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
            <Cpu className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">Total Models</p>
            <h3 className="text-2xl font-bold text-slate-800">{stats.models}</h3>
            <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              {stats.activeModels} Active
            </span>
          </div>
        </div>

        {/* Tokens Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
            <Key className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">Issued Tokens</p>
            <h3 className="text-2xl font-bold text-slate-800">{stats.tokens}</h3>
          </div>
        </div>
        
        {/* System Status - Mock for now */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-green-50 text-green-600 rounded-lg">
            <Activity className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">System Status</p>
            <h3 className="text-lg font-bold text-slate-800">Operational</h3>
          </div>
        </div>
      </div>

      <div className="mt-8 p-6 bg-reze-50 rounded-xl border border-reze-100">
        <h2 className="text-lg font-semibold text-reze-800 mb-2">Welcome back, Admin.</h2>
        <p className="text-reze-600">
          Use the navigation menu to manage your AI providers, configure model offerings, and generate access tokens for your clients.
        </p>
      </div>
    </div>
  );
};

export default Dashboard;
