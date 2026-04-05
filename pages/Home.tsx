import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ModelConfig } from '../types';
import { Cpu, Zap, Box, Key, Search, ChevronDown, ChevronUp, Copy, Check, ShieldAlert, Eye } from 'lucide-react';
import { clearAttachedUserToken, getAttachedUserToken, setAttachedUserToken } from '../services/userTokenCookie';

type ProviderCard = {
  id: string;
  name: string;
  type?: 'openai' | 'anthropic';
  isPrivate?: boolean;
};

type PrivateCatalogResponse = {
  isPrivate: boolean;
  providers: ProviderCard[];
  models: ModelConfig[];
};

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button onClick={handleCopy} className="p-1.5 text-slate-400 hover:text-reze-600 hover:bg-reze-50 rounded-md transition-all" title="Copy model ID">
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
};

const Home: React.FC = () => {
  const [publicModels, setPublicModels] = useState<ModelConfig[]>([]);
  const [publicProviders, setPublicProviders] = useState<ProviderCard[]>([]);
  const [privateModels, setPrivateModels] = useState<ModelConfig[]>([]);
  const [privateProviders, setPrivateProviders] = useState<ProviderCard[]>([]);
  const [attachedToken, setAttachedToken] = useState<string | null>(null);
  const [isAttachOpen, setIsAttachOpen] = useState(false);
  const [attachInput, setAttachInput] = useState('');
  const [attachError, setAttachError] = useState('');
  const [attachLoading, setAttachLoading] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [providerSearch, setProviderSearch] = useState<Record<string, string>>({});

  const allProviders = [...publicProviders, ...privateProviders];
  const allModels = [...publicModels, ...privateModels];

  const loadPublicCatalog = async () => {
    try {
      const [modelsRes, providersRes] = await Promise.all([
        fetch('/api/public/models', { credentials: 'same-origin' }),
        fetch('/api/public/providers', { credentials: 'same-origin' })
      ]);

      setPublicModels(modelsRes.ok ? await modelsRes.json() : []);
      setPublicProviders(providersRes.ok ? await providersRes.json() : []);
    } catch (e) {
      console.error(e);
      setPublicModels([]);
      setPublicProviders([]);
    }
  };

  const loadPrivateCatalog = async (token: string | null) => {
    if (!token) {
      setPrivateModels([]);
      setPrivateProviders([]);
      return;
    }

    try {
      const res = await fetch('/api/my-token/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const json: PrivateCatalogResponse | { error: string } = await res.json();

      if (!res.ok) throw new Error((json as any).error || 'Failed to fetch private catalog');

      const catalog = json as PrivateCatalogResponse;
      setPrivateProviders(catalog.providers || []);
      setPrivateModels(catalog.models || []);
    } catch (err) {
      console.error(err);
      clearAttachedUserToken();
      setAttachedToken(null);
      setPrivateModels([]);
      setPrivateProviders([]);
    }
  };

  useEffect(() => {
    const token = getAttachedUserToken();
    setAttachedToken(token);
    setAttachInput(token || '');
    loadPublicCatalog();
    loadPrivateCatalog(token);
  }, []);

  const handleAttachToken = async () => {
    if (!attachInput.trim()) return;
    setAttachLoading(true);
    setAttachError('');

    try {
      const res = await fetch('/api/my-token/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: attachInput.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to attach token');

      setAttachedUserToken(attachInput.trim());
      setAttachedToken(attachInput.trim());
      await loadPrivateCatalog(attachInput.trim());
      setIsAttachOpen(false);
    } catch (err: any) {
      setAttachError(err.message || 'Failed to attach token');
    } finally {
      setAttachLoading(false);
    }
  };

  const toggleProvider = (providerId: string) => {
    const next = new Set(expandedProviders);
    if (next.has(providerId)) next.delete(providerId);
    else next.add(providerId);
    setExpandedProviders(next);
  };

  const handleProviderSearch = (providerId: string, query: string) => {
    setProviderSearch(prev => ({ ...prev, [providerId]: query }));
  };

  const getFilteredModels = (provider: ProviderCard) => {
    const providerModels = allModels.filter(m => m.providerId === provider.id);
    const providerQuery = (providerSearch[provider.id] || '').toLowerCase();
    const globalQuery = globalSearch.toLowerCase();

    return providerModels.filter(m => m.name.toLowerCase().includes(providerQuery) && m.name.toLowerCase().includes(globalQuery));
  };

  const activeProviders = allProviders.filter(provider => allModels.some(model => model.providerId === provider.id));
  const visibleProviders = activeProviders.filter(provider => {
    if (!globalSearch) return true;
    if (provider.name.toLowerCase().includes(globalSearch.toLowerCase())) return true;
    return getFilteredModels(provider).length > 0;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-reze-50 via-white to-emerald-50 flex flex-col public-home-shell">
      {isAttachOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl p-6 ring-1 ring-slate-200/70">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Attach User Token</h2>
            <p className="text-slate-500 mb-5">Paste your token to unlock any attached private pool and usage view.</p>
            <div className="space-y-4">
              <input
                type="text"
                value={attachInput}
                onChange={(e) => setAttachInput(e.target.value)}
                placeholder="Paste your API token here..."
                className="w-full px-4 py-3 bg-slate-50 rounded-xl shadow-inner ring-1 ring-slate-200 focus:ring-2 focus:ring-reze-500 focus:outline-none"
              />
              {attachError && (
                <div className="p-3 bg-red-50 text-red-600 rounded-xl flex items-center gap-2 text-sm">
                  <ShieldAlert className="w-4 h-4" />
                  {attachError}
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button onClick={() => setIsAttachOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-800">Cancel</button>
                <button
                  onClick={handleAttachToken}
                  disabled={attachLoading || !attachInput.trim()}
                  className="px-5 py-2.5 bg-reze-600 text-white rounded-xl hover:bg-reze-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {attachLoading ? 'Attaching...' : 'Attach Token'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <header className="pt-24 pb-16 px-6 text-center">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="inline-flex items-center justify-center p-3 bg-reze-100 rounded-2xl mb-4 text-reze-600">
            <Box className="w-8 h-8" />
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900">Reze Proxy</h1>
          <p className="text-xl md:text-2xl text-slate-500 font-light italic">"Let's run away together"</p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <button
              onClick={() => {
                setAttachInput(attachedToken || '');
                setAttachError('');
                setIsAttachOpen(true);
              }}
              className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl transition-all font-medium ${
                attachedToken
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 shadow-md ring-1 ring-emerald-200/80'
                  : 'bg-white text-slate-700 hover:text-reze-600 hover:shadow-lg shadow-md ring-1 ring-slate-200/80'
              }`}
            >
              <Key className="w-4 h-4 theme-icon" />
              {attachedToken ? 'Token attached. Edit?' : 'Attach User Token'}
            </button>

            {attachedToken && (
              <Link
                to="/user-token"
                className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all font-medium shadow-lg"
              >
                <Eye className="w-4 h-4 theme-icon" />
                View Token Usage
              </Link>
            )}
          </div>

          <div className="h-1 w-24 bg-reze-400 mx-auto rounded-full mt-8 opacity-50"></div>
        </div>
      </header>

      <section className="py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <h2 className="text-2xl font-semibold text-slate-800 flex items-center gap-2">
              <Zap className="w-5 h-5 text-reze-500 theme-icon" />
              Available models
            </h2>

            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 theme-icon" />
              <input
                type="text"
                placeholder="Search all models..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white rounded-lg focus:ring-2 focus:ring-reze-500 focus:border-transparent outline-none transition-all shadow-md ring-1 ring-slate-200/80"
              />
            </div>
          </div>

          <div className="space-y-4">
            {visibleProviders.map((provider) => {
              const isExpanded = expandedProviders.has(provider.id);
              const filteredModels = getFilteredModels(provider);
              const modelCount = allModels.filter(m => m.providerId === provider.id).length;
              const forceExpand = !!globalSearch && filteredModels.length > 0;
              const open = isExpanded || forceExpand;

              return (
                <div key={provider.id} className="bg-white rounded-2xl overflow-hidden transition-all duration-300 shadow-lg hover:shadow-xl relative provider-surface">
                  <button onClick={() => toggleProvider(provider.id)} className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-inner ${provider.isPrivate ? 'bg-emerald-50 text-emerald-600' : 'bg-reze-50 text-reze-600'}`}>
                        {provider.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                          {provider.name}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tight ${
                            provider.type === 'anthropic'
                              ? 'bg-orange-100 text-orange-600 border border-orange-200'
                              : 'bg-blue-100 text-blue-600 border border-blue-200'
                          }`}>
                            {provider.type === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                          </span>
                          {provider.isPrivate && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tight bg-emerald-100 text-emerald-700 border border-emerald-200">
                              Private
                            </span>
                          )}
                        </h3>
                        <p className="text-sm text-slate-500">{modelCount} models available</p>
                      </div>
                    </div>
                    {open ? <ChevronUp className="w-5 h-5 text-slate-400 theme-icon" /> : <ChevronDown className="w-5 h-5 text-slate-400 theme-icon" />}
                  </button>

                  {open && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                      <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 theme-icon" />
                        <input
                          type="text"
                          placeholder={`Search in ${provider.name}...`}
                          value={providerSearch[provider.id] || ''}
                          onChange={(e) => handleProviderSearch(provider.id, e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-sm bg-white rounded-md focus:ring-1 focus:ring-reze-500 focus:border-reze-500 outline-none shadow-sm ring-1 ring-slate-200/80"
                        />
                      </div>

                      {filteredModels.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {filteredModels.map(model => (
                            <div key={`${provider.id}:${model.id}:${model.name}`} className="bg-white p-3 rounded-xl flex flex-col gap-2 shadow-md ring-1 ring-slate-200/70">
                              <div className="flex justify-between items-start">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <span className="font-mono text-sm font-semibold text-slate-700 break-all truncate">{model.name}</span>
                                  <CopyButton text={provider.isPrivate ? model.name : `${provider.name}/${model.name}`} />
                                </div>
                                <Cpu className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2 theme-icon" />
                              </div>
                              <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-slate-50">
                                <div className="flex gap-4 text-xs text-slate-500">
                                  <div>
                                    <span className="block text-[10px] uppercase tracking-wider text-slate-400">Max Input</span>
                                    {model.maxInputTokens.toLocaleString()}
                                  </div>
                                  <div>
                                    <span className="block text-[10px] uppercase tracking-wider text-slate-400">Max Output</span>
                                    {model.maxOutputTokens.toLocaleString()}
                                  </div>
                                </div>
                                {(model.inputPricePer1k !== undefined || model.outputPricePer1k !== undefined) && (
                                  <div className="flex gap-4 text-xs text-slate-600 bg-slate-50/50 p-2 rounded-md ring-1 ring-slate-200/60">
                                    <div>
                                      <span className="block text-[9px] uppercase tracking-wider text-slate-400">Input / 1M</span>
                                      <span className="font-medium text-green-600">${((model.inputPricePer1k || 0) * 1000).toFixed(2)}</span>
                                    </div>
                                    <div>
                                      <span className="block text-[9px] uppercase tracking-wider text-slate-400">Output / 1M</span>
                                      <span className="font-medium text-green-600">${((model.outputPricePer1k || 0) * 1000).toFixed(2)}</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-slate-400 text-sm">No models found matching your search.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
