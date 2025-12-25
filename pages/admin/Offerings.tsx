import React, { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw, Save, X, Globe, Check, Edit2 } from 'lucide-react';
import { Provider, ModelConfig } from '../../types';
import { storageService } from '../../services/storageService';

const Offerings: React.FC = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Provider Form State
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderUrl, setNewProviderUrl] = useState('');
  const [newProviderKey, setNewProviderKey] = useState('');
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    refreshData();
  }, []);

  const refreshData = async () => {
    setProviders(await storageService.getProviders());
    setModels(await storageService.getModels());
  };

  const handleFetchModels = async () => {
    if (!newProviderUrl) return;
    setIsFetching(true);
    setFetchedModels([]);
    setFetchError('');

    try {
        const cleanUrl = newProviderUrl.replace(/\/+$/, '');
        const response = await fetch(`${cleanUrl}/models`, {
            headers: newProviderKey ? {
                'Authorization': `Bearer ${newProviderKey}`
            } : {}
        });

        if (!response.ok) {
            throw new Error(`Provider returned ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Handle different formats: { data: [{id: ...}] } or [{id: ...}]
        let modelList: string[] = [];
        if (data.data && Array.isArray(data.data)) {
            modelList = data.data.map((m: any) => m.id);
        } else if (Array.isArray(data)) {
            modelList = data.map((m: any) => m.id);
        } else {
            throw new Error('Unexpected response format');
        }

        if (modelList.length === 0) throw new Error('No models found in response');
        
        setFetchedModels(modelList);
    } catch (e: any) {
        console.error("Failed to fetch", e);
        setFetchError(e.message || "Failed to fetch models. Check URL, CORS, or API Key.");
    } finally {
        setIsFetching(false);
    }
  };

  const handleSaveProvider = async () => {
    if (!newProviderName || !newProviderUrl) return;
    
    if (editingProviderId) {
        // Update Existing
        const updatedProvider: Provider = {
            id: editingProviderId,
            name: newProviderName,
            baseUrl: newProviderUrl,
            apiKey: newProviderKey,
            type: 'openai'
        };
        await storageService.updateProvider(updatedProvider);
        
        // If models were fetched during edit, we check for new ones to add
        if (fetchedModels.length > 0) {
             const newModelConfigs: ModelConfig[] = fetchedModels
                .filter(mid => !models.some(m => m.id === mid && m.providerId === editingProviderId))
                .map(modelId => ({
                    id: modelId,
                    name: modelId,
                    providerId: editingProviderId,
                    maxInputTokens: 4096,
                    maxOutputTokens: 1024,
                    isActive: true
                }));
             if (newModelConfigs.length > 0) {
                 await storageService.saveModels(newModelConfigs);
             }
        }
    } else {
        // Create New
        const newId = `prov_${Date.now()}`;
        const provider: Provider = {
            id: newId,
            name: newProviderName,
            baseUrl: newProviderUrl,
            apiKey: newProviderKey,
            type: 'openai'
        };

        const newModelConfigs: ModelConfig[] = fetchedModels.map(modelId => ({
            id: modelId,
            name: modelId,
            providerId: newId,
            maxInputTokens: 4096,
            maxOutputTokens: 1024,
            isActive: true
        }));

        await storageService.saveProvider(provider);
        await storageService.saveModels(newModelConfigs);
    }
    
    refreshData();
    resetForm();
  };

  const handleEditProvider = (provider: Provider) => {
      setEditingProviderId(provider.id);
      setNewProviderName(provider.name);
      setNewProviderUrl(provider.baseUrl);
      setNewProviderKey(provider.apiKey || ''); 
      setIsAdding(true);
      setFetchedModels([]);
  };

  const resetForm = () => {
      setIsAdding(false);
      setEditingProviderId(null);
      setNewProviderName('');
      setNewProviderUrl('');
      setNewProviderKey('');
      setFetchedModels([]);
      setFetchError('');
  };

  const handleDeleteProvider = async (id: string) => {
    if(window.confirm('Are you sure? This will remove all associated models.')) {
        await storageService.deleteProvider(id);
        refreshData();
    }
  };

  const handleUpdateModel = async (model: ModelConfig, updates: Partial<ModelConfig>) => {
    const updated = { ...model, ...updates };
    await storageService.updateModel(updated);
    setModels(prev => prev.map(m => (m.id === updated.id && m.providerId === updated.providerId) ? updated : m));
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Offerings</h1>
          <p className="text-slate-500">Manage AI providers and their models</p>
        </div>
        <button 
          onClick={() => { resetForm(); setIsAdding(true); }}
          className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-reze-600 text-white rounded-lg hover:bg-reze-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Provider
        </button>
      </div>

      {/* Add/Edit Provider Modal/Panel */}
      {isAdding && (
        <div className="mb-8 bg-white p-6 rounded-xl shadow-lg border border-reze-100 animate-in fade-in slide-in-from-top-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-slate-800">{editingProviderId ? 'Edit Provider' : 'New Provider Configuration'}</h3>
            <button onClick={resetForm} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Provider Name</label>
                <input 
                    type="text" 
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-reze-500 outline-none"
                    placeholder="e.g. My Private LLM"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Base URL</label>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={newProviderUrl}
                        onChange={(e) => setNewProviderUrl(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-reze-500 outline-none"
                        placeholder="https://api.example.com/v1"
                    />
                </div>
            </div>
            <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Provider User Token (API Key)</label>
                <input 
                    type="password" 
                    value={newProviderKey}
                    onChange={(e) => setNewProviderKey(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-reze-500 outline-none font-mono text-sm"
                    placeholder={editingProviderId ? "Leave blank to keep existing key" : "sk-..."}
                />
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between bg-slate-50 p-4 rounded-lg border border-slate-100 mb-4 gap-4">
             <div className="text-sm text-slate-600">
                {isFetching ? (
                    <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin"/> Fetching models...</span>
                ) : fetchError ? (
                    <span className="flex items-center gap-2 text-red-600 break-all">{fetchError}</span>
                ) : fetchedModels.length > 0 ? (
                    <span className="flex items-center gap-2 text-green-600"><Check className="w-4 h-4"/> Found {fetchedModels.length} models</span>
                ) : (
                    <span>Click 'Fetch' to {editingProviderId ? 'refresh/discover new' : 'discover'} models.</span>
                )}
             </div>
             <button 
                onClick={handleFetchModels}
                disabled={!newProviderUrl || isFetching}
                className="w-full md:w-auto px-3 py-1.5 text-sm bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50"
             >
                Fetch Models
             </button>
          </div>

          <div className="flex justify-end gap-3">
             <button onClick={resetForm} className="px-4 py-2 text-slate-600 hover:text-slate-900">Cancel</button>
             <button 
                onClick={handleSaveProvider}
                disabled={!newProviderName || !newProviderUrl || (!editingProviderId && fetchedModels.length === 0)}
                className="px-4 py-2 bg-reze-600 text-white rounded-lg hover:bg-reze-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
             >
                <Save className="w-4 h-4" />
                {editingProviderId ? 'Update Provider' : 'Save Provider'}
             </button>
          </div>
        </div>
      )}

      {/* Providers List */}
      <div className="space-y-6">
        {providers.map(provider => (
            <div key={provider.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-4 md:px-6 border-b border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white rounded-lg border border-slate-200">
                            <Globe className="w-5 h-5 text-reze-500" />
                        </div>
                        <div className="overflow-hidden">
                            <h3 className="font-semibold text-slate-800 truncate">{provider.name}</h3>
                            <p className="text-xs text-slate-500 font-mono truncate max-w-[200px] md:max-w-md">{provider.baseUrl}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 self-end md:self-auto">
                        <button 
                            onClick={() => handleEditProvider(provider)}
                            className="p-2 text-slate-400 hover:text-reze-600 transition-colors"
                            title="Edit Provider"
                        >
                            <Edit2 className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={() => handleDeleteProvider(provider.id)}
                            className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                            title="Delete Provider"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    </div>
                </div>
                
                <div className="p-4 md:p-6">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Configured Models</h4>
                    
                    {/* Mobile Model List */}
                    <div className="md:hidden space-y-4">
                        {models.filter(m => m.providerId === provider.id).map(model => (
                            <div key={model.id} className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-3">
                                <div>
                                    <label className="text-xs font-medium text-slate-500 block mb-1">Public Name</label>
                                    <input 
                                        type="text"
                                        className="w-full px-2 py-1 border border-slate-200 rounded text-slate-700 font-medium text-sm focus:ring-1 focus:ring-reze-500 outline-none"
                                        value={model.name}
                                        onChange={(e) => handleUpdateModel(model, { name: e.target.value })}
                                    />
                                    <div className="text-[10px] text-slate-400 font-mono mt-1 truncate">ID: {model.id}</div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] text-slate-500 block mb-1">Max Input</label>
                                        <input 
                                            type="number"
                                            className="w-full px-2 py-1 border border-slate-200 rounded text-slate-600 text-xs focus:ring-1 focus:ring-reze-500 outline-none"
                                            value={model.maxInputTokens}
                                            onChange={(e) => handleUpdateModel(model, { maxInputTokens: parseInt(e.target.value) })}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 block mb-1">Max Output</label>
                                        <input 
                                            type="number"
                                            className="w-full px-2 py-1 border border-slate-200 rounded text-slate-600 text-xs focus:ring-1 focus:ring-reze-500 outline-none"
                                            value={model.maxOutputTokens}
                                            onChange={(e) => handleUpdateModel(model, { maxOutputTokens: parseInt(e.target.value) })}
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-end">
                                    <button 
                                        onClick={() => handleUpdateModel(model, { isActive: !model.isActive })}
                                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${model.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}
                                    >
                                        {model.isActive ? 'Active' : 'Disabled'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Desktop Model Table */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 bg-slate-50/50 uppercase">
                                <tr>
                                    <th className="px-4 py-3 rounded-l-lg w-1/3">Model ID</th>
                                    <th className="px-4 py-3 w-1/6">Max Input</th>
                                    <th className="px-4 py-3 w-1/6">Max Output</th>
                                    <th className="px-4 py-3 rounded-r-lg text-right w-1/6">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {models.filter(m => m.providerId === provider.id).map(model => (
                                    <tr key={model.id} className="hover:bg-slate-50/50">
                                        <td className="px-4 py-3">
                                            <input 
                                                type="text"
                                                className="w-full px-2 py-1 border border-slate-200 rounded text-slate-700 font-medium text-sm focus:ring-1 focus:ring-reze-500 outline-none"
                                                value={model.name}
                                                onChange={(e) => handleUpdateModel(model, { name: e.target.value })}
                                            />
                                            <div className="text-xs text-slate-400 font-mono mt-1" title="Provider Model ID">
                                                ID: {model.id}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <input 
                                                type="number"
                                                className="w-full px-2 py-1 border border-slate-200 rounded text-slate-600 text-xs focus:ring-1 focus:ring-reze-500 outline-none"
                                                value={model.maxInputTokens}
                                                onChange={(e) => handleUpdateModel(model, { maxInputTokens: parseInt(e.target.value) })}
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input 
                                                type="number"
                                                className="w-full px-2 py-1 border border-slate-200 rounded text-slate-600 text-xs focus:ring-1 focus:ring-reze-500 outline-none"
                                                value={model.maxOutputTokens}
                                                onChange={(e) => handleUpdateModel(model, { maxOutputTokens: parseInt(e.target.value) })}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button 
                                                onClick={() => handleUpdateModel(model, { isActive: !model.isActive })}
                                                className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${model.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}
                                            >
                                                {model.isActive ? 'Active' : 'Disabled'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        ))}

        {providers.length === 0 && !isAdding && (
            <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <p className="text-slate-500">No providers configured.</p>
                <button onClick={() => setIsAdding(true)} className="text-reze-600 font-medium hover:underline mt-2">Add your first provider</button>
            </div>
        )}
      </div>
    </div>
  );
};

export default Offerings;