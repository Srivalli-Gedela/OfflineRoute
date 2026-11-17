import React, { useState, useEffect } from 'react';
import {
  Bookmark,
  Trash2,
  Navigation,
  Clock,
  Compass,
  Zap,
  CheckCircle2,
  History
} from 'lucide-react';
import {
  getAllCachedRoutes,
  deleteCachedRoute
} from '../services/indexedDB.js';

export default function SavedRoutes({ onLoadRoute, currentRouteId }) {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRoutes = async () => {
    try {
      setLoading(true);
      const list = await getAllCachedRoutes();
      setRoutes(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, [currentRouteId]);

  const handleDelete = async (routeId, e) => {
    e.stopPropagation();
    try {
      await deleteCachedRoute(routeId);
      await fetchRoutes();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl text-xs text-slate-400">
        Loading cached routes...
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-cyan-400" />
          <div>
            <h3 className="text-sm font-semibold text-white">Cached Routes (LRU Storage)</h3>
            <p className="text-xs text-slate-400">0ms Instant Offline Retrieval</p>
          </div>
        </div>
        <span className="text-xs text-slate-400 font-mono">{routes.length} saved</span>
      </div>

      {routes.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-500 bg-slate-800/30 rounded-xl border border-slate-800/80">
          No cached routes found. Search and calculate a route to automatically save it for offline use!
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 max-h-80 overflow-y-auto pr-1">
          {routes.map((r) => {
            const isSelected = r.id === currentRouteId;
            return (
              <div
                key={r.id}
                onClick={() => onLoadRoute(r)}
                className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-500/50 shadow-md'
                    : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/60 hover:border-slate-600'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex flex-col min-w-0 pr-2">
                    <div className="text-xs font-semibold text-slate-100 truncate">
                      {r.origin?.name || 'Start'} ➔ {r.destination?.name || 'Dest'}
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 font-mono">
                      <span>{r.distance_km} km</span>
                      <span>•</span>
                      <span>{r.duration_min} min</span>
                      <span>•</span>
                      <span className="capitalize">{r.mode}</span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDelete(r.id, e)}
                    className="p-1 text-slate-500 hover:text-rose-400 transition-colors shrink-0"
                    title="Delete route from cache"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-700/40">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    Offline Ready
                  </span>
                  <span className="font-mono text-slate-500">
                    {r.hits || 1} hits • {new Date(r.last_accessed_at || r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
