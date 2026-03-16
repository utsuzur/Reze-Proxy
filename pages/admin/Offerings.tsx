import React, { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw, Save, X, Globe, Check, Edit2, ChevronDown, Search } from 'lucide-react';
import { Provider, ModelConfig } from '../../types';
import { storageService } from '../../services/storageService';

const PRESETS = [
  { name: 'OpenAI', url: 'https://api.openai.com/v1', type: 'openai' },
  { name: 'Anthropic', url: 'https://api.anthropic.com', type: 'anthropic' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1', type: 'openai' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', type: 'openai' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com', type: 'openai' },
  { name: 'Mistral AI', url: 'https://api.mistral.ai/v1', type: 'openai' },
  { name: 'Together AI', url: 'https://api.together.xyz/v1', type: 'openai' },
  { name: 'Ollama (Local)', url: 'http://localhost:11434/v1', type: 'openai' },
];

const Offerings: React.FC = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [modelSearchQueries, setModelSearchQueries] = useState<Record<string, string>>({});
  
  // Provider Form State
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderUrl, setNewProviderUrl] = useState('');
  const [newProviderKey, setNewProviderKey] = useState('');
  const [newProviderType, setNewProviderType] = useState<'openai' | 'anthropic'>('openai');
  const [newRemoveTopP, setNewRemoveTopP] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    refreshData();
  }, []);

  const refreshData = async () => {
    const loadedProviders = await storageService.getProviders();
    setProviders(loadedProviders);
    setModels(await storageService.getModels());
    // Default all to expanded initially
    setExpandedProviders(new Set(loadedProviders.map(p => p.id)));
  };

  const toggleProvider = (id: string) => {
    const newSet = new Set(expandedProviders);
    if (newSet.has(id)) {
        newSet.delete(id);
    } else {
        newSet.add(id);
    }
    setExpandedProviders(newSet);
  };

  const handleFetchModels = async () => {
    if (!newProviderUrl) return;
    setIsFetching(true);
    setFetchedModels([]);
    setFetchError('');

    try {
        let fetchKey = newProviderKey;
        try {
            const parsed = JSON.parse(newProviderKey);
            if (Array.isArray(parsed) && parsed.length > 0) {
                fetchKey = parsed[0];
            }
        } catch (e) {
            // Not JSON, use as is
        }

        const response = await fetch('/api/admin/fetch-models', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': document.cookie.match(/reze_csrf=([^;]+)/)?.[1] || ''
            },
            body: JSON.stringify({
                url: newProviderUrl,
                key: fetchKey,
                type: newProviderType
            })
        });

        if (!response.ok) {
            const errJson = await response.json();
            throw new Error(errJson.error || `Server returned ${response.status}`);
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
        setFetchError(e.message || "Failed to fetch models. Check URL or API Key.");
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
            removeTopP: newRemoveTopP,
            type: newProviderType
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
            removeTopP: newRemoveTopP,
            type: newProviderType
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
        
        // Auto expand new provider
        setExpandedProviders(prev => new Set(prev).add(newId));
    }
    
    refreshData();
    resetForm();
  };

  const handleEditProvider = (provider: Provider) => {
      setEditingProviderId(provider.id);
      setNewProviderName(provider.name);
      setNewProviderUrl(provider.baseUrl);
      setNewProviderKey(provider.apiKey || ''); 
      setNewProviderType(provider.type || 'openai');
      setNewRemoveTopP(!!provider.removeTopP);
      setIsAdding(true);
      setFetchedModels([]);
  };

  const resetForm = () => {
      setIsAdding(false);
      setEditingProviderId(null);
      setNewProviderName('');
      setNewProviderUrl('');
      setNewProviderKey('');
      setNewProviderType('openai');
      setNewRemoveTopP(false);
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

  const handleBulkToggle = async (providerId: string, isActive: boolean) => {
    if (!window.confirm(`Are you sure you want to ${isActive ? 'enable' : 'disable'} all models for this provider?`)) return;
    
    const providerModels = models.filter(m => m.providerId === providerId);
    if (providerModels.length === 0) return;

    const updatedModels = providerModels.map(m => ({ ...m, isActive }));
    await storageService.saveModels(updatedModels);
    
    setModels(prev => prev.map(m => {
        if (m.providerId === providerId) {
            return { ...m, isActive };
        }
        return m;
    }));
  };

  const handleBulkUpdate = async (providerId: string, inputTokens: string, outputTokens: string) => {
    const maxInput = parseInt(inputTokens);
    const maxOutput = parseInt(outputTokens);

    if (isNaN(maxInput) && isNaN(maxOutput)) return;
    
    if (!window.confirm(`Update tokens for all models?`)) return;

    const providerModels = models.filter(m => m.providerId === providerId);
    if (providerModels.length === 0) return;

    const updatedModels = providerModels.map(m => ({
        ...m,
        maxInputTokens: isNaN(maxInput) ? m.maxInputTokens : maxInput,
        maxOutputTokens: isNaN(maxOutput) ? m.maxOutputTokens : maxOutput
    }));

    await storageService.saveModels(updatedModels);
    
    setModels(prev => prev.map(m => {
        if (m.providerId === providerId) {
             return {
                ...m,
                maxInputTokens: isNaN(maxInput) ? m.maxInputTokens : maxInput,
                maxOutputTokens: isNaN(maxOutput) ? m.maxOutputTokens : maxOutput
            };
        }
        return m;
    }));
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
          <div className="flex justify-between items-center mb-4 border-b border-slate-50 pb-4">
            <h3 className="text-lg font-semibold text-slate-800">{editingProviderId ? 'Edit Provider' : 'New Provider Configuration'}</h3>
            <button onClick={resetForm} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-100">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Fast Configuration
            </label>
            <div className="flex flex-col gap-2">
                <p className="text-xs text-slate-400 mb-1">Select a provider to auto-fill the URL:</p>
                <select 
                    onChange={(e) => {
                        const preset = PRESETS.find(p => p.url === e.target.value);
                        if (preset) {
                            setNewProviderName(preset.name);
                            setNewProviderUrl(preset.url);
                            setNewProviderType(preset.type as 'openai' | 'anthropic');
                        }
                    }}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-reze-500 outline-none shadow-sm"
                    defaultValue=""
                >
                    <option value="" disabled>-- Choose a Provider Preset --</option>
                    {PRESETS.map(p => (
                        <option key={p.url} value={p.url}>{p.name}</option>
                    ))}
                </select>
            </div>
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Provider Type</label>
                <select 
                    value={newProviderType}
                    onChange={(e) => setNewProviderType(e.target.value as 'openai' | 'anthropic')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-reze-500 outline-none bg-white"
                >
                    <option value="openai">OpenAI Compatible</option>
                    <option value="anthropic">Anthropic</option>
                </select>
            </div>
            <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Base URL</label>
                <input 
                    type="text" 
                    value={newProviderUrl}
                    onChange={(e) => setNewProviderUrl(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-reze-500 outline-none"
                    placeholder={newProviderType === 'anthropic' ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
                />
            </div>
            <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Provider API Key(s)</label>
                <div className="space-y-1">
                    <input 
                        type="text" 
                        value={newProviderKey}
                        onChange={(e) => setNewProviderKey(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-reze-500 outline-none font-mono text-sm"
                        placeholder={editingProviderId ? "Keep as is (already masked) or enter new key(s)" : "sk-... or [\"key1\", \"key2\"]"}
                    />
                    <p className="text-[10px] text-slate-500">
                        Enter a single key or a JSON array of keys for rotation: <code>["key1", "key2"]</code>
                    </p>
                </div>
            </div>
            <div className="md:col-span-2 flex items-center gap-2 mt-2">
                <input
                    type="checkbox"
                    id="removeTopP"
                    checked={newRemoveTopP}
                    onChange={(e) => setNewRemoveTopP(e.target.checked)}
                    className="w-4 h-4 text-reze-600 rounded border-slate-300 focus:ring-reze-500"
                />
                <label htmlFor="removeTopP" className="text-sm text-slate-700">
                    Remove <code>top_p</code> parameter (Fix for some providers like o1)
                </label>
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
                <div 
                  className="bg-slate-50 px-4 py-4 md:px-6 border-b border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 cursor-pointer hover:bg-slate-100 transition-colors"
                  onClick={() => toggleProvider(provider.id)}
                >
                    <div className="flex items-center gap-3">
                        <div className={`transition-transform duration-200 ${expandedProviders.has(provider.id) ? 'rotate-180' : ''}`}>
                            <ChevronDown className="w-5 h-5 text-slate-400" />
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-slate-200">
                            <Globe className="w-5 h-5 text-reze-500" />
                        </div>
                        <div className="overflow-hidden">
                            <h3 className="font-semibold text-slate-800 truncate">{provider.name}</h3>
                            <p className="text-xs text-slate-500 font-mono truncate max-w-[200px] md:max-w-md">{provider.baseUrl}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 self-end md:self-auto" onClick={(e) => e.stopPropagation()}>
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
                
                {expandedProviders.has(provider.id) && (
                  <div className="p-4 md:p-6 animate-in slide-in-from-top-2 fade-in duration-200">
                      <div className="flex flex-col items-center justify-center mb-8 gap-6 border-b border-slate-100 pb-6">
                          <div className="flex flex-col items-center gap-3 w-full">
                                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Bulk Actions</h4>
                                <div className="flex flex-wrap justify-center items-end gap-3">
                                    <div>
                                        <label className="text-[10px] text-slate-500 block mb-1 text-center">Set Max Input</label>
                                        <input 
                                            id={`bulk-input-${provider.id}`}
                                            type="number" 
                                            className="w-24 px-2 py-1 border border-slate-200 rounded text-sm outline-none focus:ring-1 focus:ring-reze-500 text-center"
                                            placeholder="4096"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 block mb-1 text-center">Set Max Output</label>
                                        <input 
                                            id={`bulk-output-${provider.id}`}
                                            type="number" 
                                            className="w-24 px-2 py-1 border border-slate-200 rounded text-sm outline-none focus:ring-1 focus:ring-reze-500 text-center"
                                            placeholder="1024"
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            const inputEl = document.getElementById(`bulk-input-${provider.id}`) as HTMLInputElement;
                                            const outputEl = document.getElementById(`bulk-output-${provider.id}`) as HTMLInputElement;
                                            handleBulkUpdate(provider.id, inputEl.value, outputEl.value);
                                            inputEl.value = '';
                                            outputEl.value = '';
                                        }}
                                        className="px-4 py-1.5 bg-slate-800 text-white text-xs font-medium rounded hover:bg-slate-900 transition-colors shadow-sm"
                                    >
                                        Apply
                                    </button>
                                </div>
                          </div>
                          <div className="flex gap-3 justify-center">
                              <button
                                  onClick={() => handleBulkToggle(provider.id, false)}
                                  className="text-xs px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition-colors font-medium border border-slate-200"
                              >
                                  Disable All Models
                              </button>
                              <button
                                  onClick={() => handleBulkToggle(provider.id, true)}
                                  className="text-xs px-4 py-1.5 bg-reze-100 hover:bg-reze-200 text-reze-700 rounded transition-colors font-medium border border-reze-200"
                              >
                                  Enable All Models
                              </button>
                          </div>
                      </div>

                      <div className="flex justify-between items-center mb-4 px-1">
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Configured Models</h4>
                          <div className="relative">
                              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                              <input 
                                  type="text" 
                                  placeholder="Search models..." 
                                  className="pl-9 pr-4 py-1.5 text-sm border border-slate-200 rounded-full focus:ring-1 focus:ring-reze-500 outline-none bg-slate-50 w-64"
                                  value={modelSearchQueries[provider.id] || ''}
                                  onChange={(e) => setModelSearchQueries(prev => ({ ...prev, [provider.id]: e.target.value }))}
                              />
                          </div>
                      </div>
                      
                      {/* Mobile Model List */}
                      <div className="md:hidden space-y-4">
                          {models.filter(m => m.providerId === provider.id && m.name.toLowerCase().includes((modelSearchQueries[provider.id] || '').toLowerCase())).map(model => (
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
                                  {models.filter(m => m.providerId === provider.id && m.name.toLowerCase().includes((modelSearchQueries[provider.id] || '').toLowerCase())).map(model => (
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
                )}
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