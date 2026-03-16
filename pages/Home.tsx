import React, { useEffect, useState } from 'react';
import { ModelConfig } from '../types';
import { Cpu, Zap, Box, Key, Search, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { TokenChecker } from '../components/TokenChecker';

type PublicProvider = {
  id: string;
  name: string;
  type?: 'openai' | 'anthropic';
};

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button 
            onClick={handleCopy} 
            className="p-1.5 text-slate-400 hover:text-reze-600 hover:bg-reze-50 rounded-md transition-all"
            title="Copy model ID"
        >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    );
};

const Home: React.FC = () => {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [isTokenCheckerOpen, setIsTokenCheckerOpen] = useState(false);

  const [globalSearch, setGlobalSearch] = useState('');
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [providerSearch, setProviderSearch] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [modelsRes, providersRes] = await Promise.all([
          fetch('/api/public/models', { credentials: 'same-origin' }),
          fetch('/api/public/providers', { credentials: 'same-origin' })
        ]);

        const modelsJson = modelsRes.ok ? await modelsRes.json() : [];
        const providersJson = providersRes.ok ? await providersRes.json() : [];

        setModels(modelsJson);
        setProviders(providersJson);
      } catch (e) {
        console.error(e);
        setModels([]);
        setProviders([]);
      }
    };
    fetchData();
  }, []);

  const toggleProvider = (providerId: string) => {
    const newExpanded = new Set(expandedProviders);
    if (newExpanded.has(providerId)) {
        newExpanded.delete(providerId);
    } else {
        newExpanded.add(providerId);
    }
    setExpandedProviders(newExpanded);
  };

  const handleProviderSearch = (providerId: string, query: string) => {
      setProviderSearch(prev => ({ ...prev, [providerId]: query }));
  };

  // Filter models based on search criteria
  const getFilteredModels = (providerId: string) => {
      const pModels = models.filter(m => m.providerId === providerId);
      const pQuery = (providerSearch[providerId] || '').toLowerCase();
      const gQuery = globalSearch.toLowerCase();
      
      return pModels.filter(m => {
          const matchesGlobal = m.name.toLowerCase().includes(gQuery);
          const matchesProvider = m.name.toLowerCase().includes(pQuery);
          return matchesGlobal && matchesProvider;
      });
  };

  // Get only providers that have active models
  const activeProviders = providers.filter(p => models.some(m => m.providerId === p.id));

  // Filter providers based on whether they have matching models for the global search
  const visibleProviders = activeProviders.filter(p => {
      // If global search is empty, show all active providers
      if (!globalSearch) return true;
      // If global search matches provider name, show it
      if (p.name.toLowerCase().includes(globalSearch.toLowerCase())) return true;
      // If provider has models that match the global search, show it
      return getFilteredModels(p.id).length > 0;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-reze-50 via-white to-purple-50 flex flex-col">
      <TokenChecker isOpen={isTokenCheckerOpen} onClose={() => setIsTokenCheckerOpen(false)} />
      
      {/* Hero Section */}
      <header className="pt-24 pb-16 px-6 text-center">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="inline-flex items-center justify-center p-3 bg-reze-100 rounded-2xl mb-4 text-reze-600">
             <Box className="w-8 h-8" />
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900">
            Reze Proxy
          </h1>
          <p className="text-xl md:text-2xl text-slate-500 font-light italic">
            "Let's run away together"
          </p>
          
          <div className="flex justify-center gap-4 pt-4">
            <button 
              onClick={() => setIsTokenCheckerOpen(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl hover:border-reze-300 hover:text-reze-600 hover:shadow-md transition-all font-medium"
            >
              <Key className="w-4 h-4" />
              Check User Token
            </button>
          </div>

          <div className="h-1 w-24 bg-reze-400 mx-auto rounded-full mt-8 opacity-50"></div>
        </div>
      </header>

      {/* Stats/Info Section */}
      <section className="py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <h2 className="text-2xl font-semibold text-slate-800 flex items-center gap-2">
              <Zap className="w-5 h-5 text-reze-500" />
              Available models
            </h2>
            
            {/* Global Search */}
            <div className="relative w-full md:w-96">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                    type="text"
                    placeholder="Search all models..."
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-reze-500 focus:border-transparent outline-none transition-all"
                />
            </div>
          </div>
          
          <div className="space-y-4">
            {visibleProviders.map((provider) => {
              const isExpanded = expandedProviders.has(provider.id);
              const filteredModels = getFilteredModels(provider.id);
              const modelCount = models.filter(m => m.providerId === provider.id).length;
              
              const forceExpand = !!globalSearch && filteredModels.length > 0;
              const open = isExpanded || forceExpand;

              return (
                <div 
                    key={provider.id} 
                    className="bg-white rounded-xl border border-slate-200 overflow-hidden transition-all duration-300 shadow-sm hover:shadow-md"
                >
                    <button 
                        onClick={() => toggleProvider(provider.id)}
                        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-reze-50 flex items-center justify-center text-reze-600 font-bold">
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
                                </h3>
                                <p className="text-sm text-slate-500">{modelCount} models available</p>
                            </div>
                        </div>
                        {open ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                    </button>

                    {open && (
                        <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                            {/* Provider Specific Search */}
                            <div className="relative mb-4">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                <input 
                                    type="text"
                                    placeholder={`Search in ${provider.name}...`}
                                    value={providerSearch[provider.id] || ''}
                                    onChange={(e) => handleProviderSearch(provider.id, e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-md focus:ring-1 focus:ring-reze-500 focus:border-reze-500 outline-none"
                                />
                            </div>

                            {filteredModels.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {filteredModels.map(model => (
                                        <div key={model.id} className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col gap-2">
                                            <div className="flex justify-between items-start">
                                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                                    <span className="font-mono text-sm font-semibold text-slate-700 break-all truncate">
                                                        {model.name}
                                                    </span>
                                                    <CopyButton text={`${provider.name}/${model.name}`} />
                                                </div>
                                                <Cpu className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" />
                                            </div>
                                            <div className="flex gap-3 text-xs text-slate-500 mt-auto pt-2 border-t border-slate-50">
                                                <div>
                                                    <span className="block text-[10px] uppercase tracking-wider text-slate-400">Input</span>
                                                    {model.maxInputTokens.toLocaleString()}
                                                </div>
                                                <div>
                                                    <span className="block text-[10px] uppercase tracking-wider text-slate-400">Output</span>
                                                    {model.maxOutputTokens.toLocaleString()}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-slate-400 text-sm">
                                    No models found matching your search.
                                </div>
                            )}
                        </div>
                    )}
                </div>
              );
            })}
          </div>

          {models.length === 0 && (
            <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
              <p className="text-slate-400">No models currently available to run away with.</p>
            </div>
          )}
        </div>
      </section>

      <footer className="mt-auto py-8 text-center text-slate-400 text-sm">
        <p>© {new Date().getFullYear()} Reze Proxy. All systems operational.</p>
      </footer>
    </div>
  );
};

export default Home;
