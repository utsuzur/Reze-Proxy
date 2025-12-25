import React, { useEffect, useState } from 'react';
import { ModelConfig, Provider } from '../types';
import { storageService } from '../services/storageService';
import { Cpu, Zap, Box } from 'lucide-react';

const Home: React.FC = () => {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const allModels = await storageService.getModels();
      setModels(allModels.filter(m => m.isActive));
      setProviders(await storageService.getProviders());
    };
    fetchData();
  }, []);

  const getProviderName = (id: string) => providers.find(p => p.id === id)?.name || 'Unknown Provider';

  return (
    <div className="min-h-screen bg-gradient-to-br from-reze-50 via-white to-purple-50 flex flex-col">
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
          <div className="h-1 w-24 bg-reze-400 mx-auto rounded-full mt-8 opacity-50"></div>
        </div>
      </header>

      {/* Stats/Info Section */}
      <section className="py-12 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-semibold text-slate-800 mb-8 flex items-center gap-2">
            <Zap className="w-5 h-5 text-reze-500" />
            Available Offerings
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {models.map((model) => (
              <div 
                key={`${model.providerId}-${model.id}`}
                className="group bg-white rounded-xl p-6 shadow-sm border border-slate-100 hover:border-reze-200 hover:shadow-md transition-all duration-300"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="inline-block px-2 py-1 bg-reze-50 text-reze-700 text-xs font-medium rounded-full mb-2">
                      {getProviderName(model.providerId)}
                    </span>
                    <h3 className="text-lg font-bold text-slate-800 font-mono">{model.name}</h3>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-lg text-slate-400 group-hover:text-reze-500 transition-colors">
                    <Cpu className="w-5 h-5" />
                  </div>
                </div>
                
                <div className="space-y-3 pt-4 border-t border-slate-50">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Max Input</span>
                    <span className="font-medium text-slate-700">{model.maxInputTokens.toLocaleString()} tokens</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Max Output</span>
                    <span className="font-medium text-slate-700">{model.maxOutputTokens.toLocaleString()} tokens</span>
                  </div>
                </div>
              </div>
            ))}
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
        <a href="/shrine" className="mt-2 inline-block opacity-20 hover:opacity-100 transition-opacity text-xs">Shrine Access</a>
      </footer>
    </div>
  );
};

export default Home;
