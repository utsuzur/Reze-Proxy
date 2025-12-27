import React, { useState } from 'react';
import { X, Search, Activity, Edit2, Save, BarChart2, Clock, ShieldAlert } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface TokenCheckerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Log {
  id: number;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
}

interface TokenData {
  id: string;
  name: string;
  token: string;
  usageCount: number;
  inputTokens: number;
  outputTokens: number;
  requestsToday: number;
  maxRequestsPerDay: number | null;
  remainingRequestsToday: number | null;
  isActive: boolean;
  logs: Log[];
}

export const TokenChecker: React.FC<TokenCheckerProps> = ({ isOpen, onClose }) => {
  const [tokenInput, setTokenInput] = useState('');
  const [data, setData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCheck = async () => {
    if (!tokenInput.trim()) return;
    setLoading(true);
    setError('');
    setData(null);

    try {
      const res = await fetch('/api/my-token/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch token details');
      setData(json);
      setNewName(json.name);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateName = async () => {
    if (!data || !newName.trim()) return;
    try {
      const res = await fetch('/api/my-token/name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: data.token, name: newName })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update name');
      setData({ ...data, name: newName });
      setIsEditingName(false);
    } catch (err: any) {
      alert('Error updating name: ' + err.message);
    }
  };

  if (!isOpen) return null;

  // Prepare graph data (reverse logs to show oldest to newest)
  const graphData = data?.logs ? [...data.logs].reverse().map(log => ({
    time: new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    Input: log.inputTokens,
    Output: log.outputTokens,
    Model: log.modelId
  })) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Activity className="w-5 h-5 text-reze-500" />
            Token Status
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Search Input */}
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Paste your API token here..."
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-reze-500 focus:outline-none transition-all"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
              />
            </div>
            <button
              onClick={handleCheck}
              disabled={loading || !tokenInput}
              className="px-6 py-3 bg-reze-600 text-white font-medium rounded-xl hover:bg-reze-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Checking...' : 'Check'}
            </button>
          </div>

          {error && (
            <div className="p-4 bg-red-50 text-red-600 rounded-xl flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" />
              {error}
            </div>
          )}

          {data && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              
              {/* Token Info Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Name Card */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="text-slate-500 text-sm mb-1">Token Name</div>
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <input 
                        className="bg-white border border-slate-300 rounded px-2 py-1 text-sm w-full"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                      />
                      <button onClick={handleUpdateName} className="p-1 text-green-600 hover:bg-green-100 rounded">
                        <Save className="w-4 h-4" />
                      </button>
                      <button onClick={() => setIsEditingName(false)} className="p-1 text-red-600 hover:bg-red-100 rounded">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-slate-800">{data.name}</div>
                      <button onClick={() => setIsEditingName(true)} className="text-slate-400 hover:text-reze-600">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Usage Card */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                   <div className="text-slate-500 text-sm mb-1">Total Usage</div>
                   <div className="font-semibold text-slate-800">
                      {data.usageCount.toLocaleString()} Requests
                   </div>
                   <div className="text-xs text-slate-400 mt-1">
                      {data.inputTokens.toLocaleString()} in / {data.outputTokens.toLocaleString()} out
                   </div>
                </div>

                {/* Limits Card */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                   <div className="text-slate-500 text-sm mb-1">Daily Limit</div>
                   <div className="font-semibold text-slate-800">
                      {data.maxRequestsPerDay ? (
                          <span className={data.remainingRequestsToday! < 10 ? "text-red-500" : "text-green-600"}>
                              {data.remainingRequestsToday} remaining
                          </span>
                      ) : (
                          <span className="text-green-600">Unlimited</span>
                      )}
                   </div>
                   {data.maxRequestsPerDay && (
                       <div className="text-xs text-slate-400 mt-1">
                           out of {data.maxRequestsPerDay}
                       </div>
                   )}
                </div>
              </div>

              {/* Charts Section */}
              <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
                    <BarChart2 className="w-5 h-5 text-reze-500" />
                    Recent Activity (Token Usage)
                </h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={graphData}>
                      <XAxis dataKey="time" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        cursor={{ fill: '#f1f5f9' }}
                      />
                      <Legend />
                      <Bar dataKey="Input" fill="#94a3b8" radius={[4, 4, 0, 0]} stackId="a" />
                      <Bar dataKey="Output" fill="#8b5cf6" radius={[4, 4, 0, 0]} stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Logs Table */}
              <div className="bg-white border border-slate-100 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-500" />
                    <h3 className="font-semibold text-slate-700">Last 50 Requests</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium">
                            <tr>
                                <th className="px-4 py-3">Time</th>
                                <th className="px-4 py-3">Model</th>
                                <th className="px-4 py-3 text-right">Input</th>
                                <th className="px-4 py-3 text-right">Output</th>
                                <th className="px-4 py-3 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {data.logs.map((log) => (
                                <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="px-4 py-3 text-slate-600">
                                        {new Date(log.timestamp).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-reze-600 bg-reze-50/50 rounded inline-block my-1 ml-4 text-xs px-2 py-0.5">
                                        {log.modelId}
                                    </td>
                                    <td className="px-4 py-3 text-right text-slate-600">{log.inputTokens}</td>
                                    <td className="px-4 py-3 text-right text-slate-600">{log.outputTokens}</td>
                                    <td className="px-4 py-3 text-right font-medium text-slate-800">
                                        {log.inputTokens + log.outputTokens}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
};
