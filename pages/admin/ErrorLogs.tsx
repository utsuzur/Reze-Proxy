import React, { useEffect, useState } from 'react';
import { storageService } from '../../services/storageService';
import { ErrorLog } from '../../types';
import { AlertTriangle, Trash2, RefreshCw } from 'lucide-react';

const ErrorLogs: React.FC = () => {
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    const data = await storageService.getErrorLogs();
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handlePrune = async () => {
    if (!window.confirm("Are you sure you want to delete error logs older than 30 days?")) return;
    await storageService.pruneErrorLogs();
    await fetchLogs();
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            Error Logs
          </h1>
          <p className="text-slate-500 mt-1">Review system and provider errors.</p>
        </div>
        
        <div className="flex gap-2">
           <button
            onClick={fetchLogs}
            className="flex items-center gap-2 px-4 py-2 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handlePrune}
            className="flex items-center gap-2 px-4 py-2 text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Prune Old Logs
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-medium">
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Token ID</th>
                <th className="px-6 py-4">Model / Provider</th>
                <th className="px-6 py-4">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    No error logs found.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            log.errorType === 'server_error' 
                                ? 'bg-red-100 text-red-700' 
                                : 'bg-amber-100 text-amber-700'
                        }`}>
                            {log.errorType === 'server_error' ? 'Server' : 'Provider'}
                        </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-600">
                      {log.tokenId || '-'}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      <div className="flex flex-col">
                        <span className="font-medium">{log.modelId}</span>
                        <span className="text-xs text-slate-400">{log.providerId}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-700 max-w-xs md:max-w-md break-words">
                      {log.errorMessage}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ErrorLogs;
