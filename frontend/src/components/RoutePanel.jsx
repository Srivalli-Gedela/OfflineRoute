import React, { useState, useEffect } from 'react';
import {
  Navigation,
  Car,
  Footprints,
  Bike,
  ArrowUpDown,
  Search,
  CheckCircle2,
  AlertTriangle,
  Zap,
  HardDrive,
  Compass,
  Clock,
  Route as RouteIcon
} from 'lucide-react';

export default function RoutePanel({
  origin,
  destination,
  setOrigin,
  setDestination,
  onCalculateRoute,
  isLoading,
  currentRoute,
  isOffline,
  coverageError,
  downloadedRegions = [],
  onSelectPreset,
  onClearRoute
}) {
  const [mode, setMode] = useState('driving');
  const [originQuery, setOriginQuery] = useState(origin?.name || '');
  const [destQuery, setDestQuery] = useState(destination?.name || '');
  const [activeInput, setActiveInput] = useState(null); // 'origin' | 'dest'
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Sync input text with prop changes (e.g. from preset buttons or map clicks)
  useEffect(() => {
    setOriginQuery(origin?.name || '');
  }, [origin]);

  useEffect(() => {
    setDestQuery(destination?.name || '');
  }, [destination]);

  // Preset quick-test routes for instant one-click testing
  const presets = [
    {
      name: 'SF: Ferry Building ➔ Moscone Center',
      region: 'sf-downtown',
      origin: { name: 'Ferry Building / Embarcadero', lat: 37.7955, lon: -122.3937 },
      dest: { name: 'Moscone Convention Center', lat: 37.7842, lon: -122.4015 }
    },
    {
      name: 'SF: Union Square ➔ Pier 39 Fisherman\'s',
      region: 'sf-downtown',
      origin: { name: 'Union Square (Powell & Post)', lat: 37.7879, lon: -122.4075 },
      dest: { name: 'Pier 39 / Fisherman\'s Wharf', lat: 37.8087, lon: -122.4098 }
    },
    {
      name: 'NYC: Times Square ➔ Grand Central',
      region: 'ny-midtown',
      origin: { name: 'Times Square (42nd & Broadway)', lat: 40.7580, lon: -73.9855 },
      dest: { name: 'Grand Central Terminal', lat: 40.7527, lon: -73.9772 }
    },
    {
      name: 'London: Big Ben ➔ The London Eye',
      region: 'london-westminster',
      origin: { name: 'Big Ben / Parliament', lat: 51.5007, lon: -0.1246 },
      dest: { name: 'The London Eye', lat: 51.5033, lon: -0.1195 }
    },
    {
      name: 'BLR: MG Road ➔ Indiranagar 100ft',
      region: 'blr-tech',
      origin: { name: 'MG Road Metro Station', lat: 12.9756, lon: 77.6066 },
      dest: { name: 'Indiranagar 100ft Rd / CMH Rd', lat: 12.9784, lon: 77.6408 }
    }
  ];

  // Dynamic Autocomplete Search via OpenStreetMap Nominatim and Downloaded Regions
  useEffect(() => {
    const currentQuery = activeInput === 'origin' ? originQuery : (activeInput === 'dest' ? destQuery : '');
    if (!activeInput || !currentQuery || currentQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const localMatches = [];
        const qLower = currentQuery.toLowerCase();
        for (const reg of downloadedRegions) {
          const dests = reg.destinations || reg.road_network?.destinations || [];
          for (const d of dests) {
            if (d.name && d.name.toLowerCase().includes(qLower)) {
              if (!localMatches.some(m => m.name.toLowerCase() === d.name.toLowerCase())) {
                localMatches.push({ ...d, region_name: reg.name, is_offline_local: true });
              }
            }
          }
          const nodes = reg.nodes || reg.road_network?.nodes || {};
          for (const [nid, node] of Object.entries(nodes)) {
            if (node.name && !node.name.startsWith('Road Node') && !node.name.startsWith('Node_') && node.name.toLowerCase().includes(qLower)) {
              if (!localMatches.some(m => m.name.toLowerCase() === node.name.toLowerCase())) {
                localMatches.push({
                  id: nid,
                  name: node.name,
                  category: node.type || 'Landmark',
                  lat: node.lat,
                  lon: node.lon,
                  region_name: reg.name,
                  is_offline_local: true
                });
              }
            }
          }
        }

        if (isOffline) {
          setSearchResults(localMatches);
        } else {
          // Query dynamic search API (OSM Nominatim)
          const resp = await fetch(`/api/search?q=${encodeURIComponent(currentQuery)}`);
          if (resp.ok) {
            const apiResults = await resp.json();
            const combined = [...apiResults, ...localMatches.filter(l => !apiResults.some(a => a.name.toLowerCase() === l.name.toLowerCase()))];
            setSearchResults(combined.slice(0, 8));
          } else {
            setSearchResults(localMatches);
          }
        }
      } catch (e) {
        console.error('Search autocomplete error:', e);
      } finally {
        setIsSearching(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [originQuery, destQuery, activeInput, isOffline, downloadedRegions]);

  const handleSwap = () => {
    if (onClearRoute) onClearRoute();
    const tempOrigin = origin;
    const tempOriginQuery = originQuery;
    setOrigin(destination);
    setOriginQuery(destQuery);
    setDestination(tempOrigin);
    setDestQuery(tempOriginQuery);
    setActiveInput(null);
    setSearchResults([]);
  };

  const handleSelectSearchResult = (item, targetField = activeInput) => {
    if (onClearRoute) onClearRoute();
    const loc = { name: item.name, lat: item.lat, lon: item.lon };
    if (targetField === 'origin') {
      setOrigin(loc);
      setOriginQuery(item.name);
    } else {
      setDestination(loc);
      setDestQuery(item.name);
    }
    setActiveInput(null);
    setSearchResults([]);
  };

  const resolveLocation = async (queryText) => {
    if (!queryText || queryText.trim().length === 0) return null;
    const qLower = queryText.toLowerCase();
    for (const reg of downloadedRegions) {
      const dests = reg.destinations || reg.road_network?.destinations || [];
      const match = dests.find(d => d.name && d.name.toLowerCase().includes(qLower));
      if (match) return { name: match.name, lat: match.lat, lon: match.lon };
    }
    try {
      const resp = await fetch(`/api/search?q=${encodeURIComponent(queryText)}`);
      if (resp.ok) {
        const results = await resp.json();
        if (results.length > 0) {
          return { name: results[0].name, lat: results[0].lat, lon: results[0].lon };
        }
      }
    } catch (e) {
      console.error('Failed to resolve location:', e);
    }
    return null;
  };

  const handleCalculateClick = async () => {
    let currentOrigin = origin;
    let currentDest = destination;

    if (originQuery && (!currentOrigin || currentOrigin.name !== originQuery)) {
      const resolved = await resolveLocation(originQuery);
      if (resolved) {
        currentOrigin = resolved;
        setOrigin(resolved);
        setOriginQuery(resolved.name);
      }
    }

    if (destQuery && (!currentDest || currentDest.name !== destQuery)) {
      const resolved = await resolveLocation(destQuery);
      if (resolved) {
        currentDest = resolved;
        setDestination(resolved);
        setDestQuery(resolved.name);
      }
    }

    setActiveInput(null);
    setSearchResults([]);

    if (currentOrigin && currentDest) {
      onCalculateRoute(currentOrigin, currentDest, mode);
    }
  };

  const handleKeyDown = async (e, field) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchResults.length > 0) {
        handleSelectSearchResult(searchResults[0], field);
      } else {
        const queryText = field === 'origin' ? originQuery : destQuery;
        const resolved = await resolveLocation(queryText);
        if (resolved) {
          handleSelectSearchResult(resolved, field);
        }
      }
    } else if (e.key === 'Escape') {
      setActiveInput(null);
      setSearchResults([]);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
            <RouteIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Hybrid Navigation</h2>
            <p className="text-xs text-slate-400">Online & Local A* Graph Routing</p>
          </div>
        </div>

        {/* Mode selector pills */}
        <div className="flex items-center bg-slate-800/90 p-1 rounded-lg border border-slate-700/80">
          <button
            onClick={() => {
              if (mode !== 'driving') {
                setMode('driving');
                if (onClearRoute) onClearRoute();
              }
            }}
            className={`p-1.5 rounded-md text-xs font-medium transition-all ${
              mode === 'driving' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
            title="Driving mode"
          >
            <Car className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (mode !== 'cycling') {
                setMode('cycling');
                if (onClearRoute) onClearRoute();
              }
            }}
            className={`p-1.5 rounded-md text-xs font-medium transition-all ${
              mode === 'cycling' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
            title="Cycling mode"
          >
            <Bike className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (mode !== 'walking') {
                setMode('walking');
                if (onClearRoute) onClearRoute();
              }
            }}
            className={`p-1.5 rounded-md text-xs font-medium transition-all ${
              mode === 'walking' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
            title="Walking mode"
          >
            <Footprints className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Origin & Destination Inputs */}
      <div className="flex flex-col gap-2 relative">
        {/* Origin */}
        <div className="relative">
          <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2.5 focus-within:border-emerald-500 transition-colors">
            <div className="w-3 h-3 rounded-full bg-emerald-500 shrink-0 border border-white/60" />
            <input
              type="text"
              placeholder="Starting point (or click on map)"
              value={originQuery}
              onFocus={() => {
                setActiveInput('origin');
              }}
              onChange={(e) => {
                setOriginQuery(e.target.value);
                setActiveInput('origin');
                if (onClearRoute) onClearRoute();
              }}
              onKeyDown={(e) => handleKeyDown(e, 'origin')}
              className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
            />
            {originQuery && (
              <button
                onClick={() => {
                  if (onClearRoute) onClearRoute();
                  setOrigin(null);
                  setOriginQuery('');
                  setSearchResults([]);
                }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                ×
              </button>
            )}
          </div>

          {/* Origin Autocomplete Dropdown */}
          {activeInput === 'origin' && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden divide-y divide-slate-700/60 max-h-60 overflow-y-auto">
              {searchResults.map((item, idx) => (
                <div
                  key={idx}
                  onMouseDown={() => handleSelectSearchResult(item, 'origin')}
                  className="px-3.5 py-2.5 hover:bg-slate-700/70 cursor-pointer flex items-center justify-between text-xs text-slate-200 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-100 truncate">{item.name}</div>
                      <div className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
                        <span>{item.category || 'Location'}</span>
                        <span>•</span>
                        <span className="font-mono text-emerald-400">
                          ({Number(item.lat).toFixed(4)}, {Number(item.lon).toFixed(4)})
                        </span>
                        {item.region_name && <span>• {item.region_name}</span>}
                      </div>
                    </div>
                  </div>
                  {item.is_offline_local && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0 ml-1">
                      Offline Available
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Swap button */}
        <button
          onClick={handleSwap}
          title="Swap starting point and destination"
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white border border-slate-600 flex items-center justify-center shadow-md active:scale-90 transition-all"
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
        </button>

        {/* Destination */}
        <div className="relative">
          <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2.5 focus-within:border-rose-500 transition-colors">
            <div className="w-3 h-3 rounded-full bg-rose-500 shrink-0 border border-white/60" />
            <input
              type="text"
              placeholder="Destination location (or click on map)"
              value={destQuery}
              onFocus={() => {
                setActiveInput('dest');
              }}
              onChange={(e) => {
                setDestQuery(e.target.value);
                setActiveInput('dest');
                if (onClearRoute) onClearRoute();
              }}
              onKeyDown={(e) => handleKeyDown(e, 'dest')}
              className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
            />
            {destQuery && (
              <button
                onClick={() => {
                  if (onClearRoute) onClearRoute();
                  setDestination(null);
                  setDestQuery('');
                  setSearchResults([]);
                }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                ×
              </button>
            )}
          </div>

          {/* Destination Autocomplete Dropdown */}
          {activeInput === 'dest' && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden divide-y divide-slate-700/60 max-h-60 overflow-y-auto">
              {searchResults.map((item, idx) => (
                <div
                  key={idx}
                  onMouseDown={() => handleSelectSearchResult(item, 'dest')}
                  className="px-3.5 py-2.5 hover:bg-slate-700/70 cursor-pointer flex items-center justify-between text-xs text-slate-200 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-100 truncate">{item.name}</div>
                      <div className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
                        <span>{item.category || 'Location'}</span>
                        <span>•</span>
                        <span className="font-mono text-emerald-400">
                          ({Number(item.lat).toFixed(4)}, {Number(item.lon).toFixed(4)})
                        </span>
                        {item.region_name && <span>• {item.region_name}</span>}
                      </div>
                    </div>
                  </div>
                  {item.is_offline_local && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0 ml-1">
                      Offline Available
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Calculate Route CTA */}
      <button
        onClick={handleCalculateClick}
        disabled={isLoading || (!origin && !originQuery) || (!destination && !destQuery)}
        className={`w-full py-2.5 px-4 rounded-xl font-medium text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${
          isLoading || (!origin && !originQuery) || (!destination && !destQuery)
            ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            : isOffline
            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40 border border-emerald-500'
            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40 border border-blue-500'
        }`}
      >
        <Navigation className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        <span>
          {isLoading
            ? 'Calculating Path...'
            : isOffline
            ? 'Calculate Offline Route (A* Engine)'
            : 'Calculate Route (Online / Cached)'}
        </span>
      </button>

      {/* Out of Coverage Warning */}
      {coverageError && (
        <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl text-amber-200 text-xs flex items-start gap-2.5 shadow-md">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-amber-300">Offline Coverage Boundary Exceeded</div>
            <div className="mt-0.5 leading-relaxed text-amber-200/90">{coverageError}</div>
          </div>
        </div>
      )}

      {/* Active Route Summary Card */}
      {currentRoute && (
        <div className="p-4 bg-slate-800/90 border border-slate-700/80 rounded-xl flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Summary</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${
                currentRoute.is_offline
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : currentRoute.cache_status === 'HIT'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                  : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
              }`}>
                {currentRoute.is_offline ? '⚡ Offline A* Route' : currentRoute.cache_status === 'HIT' ? '⚡ HTTP Cache Hit' : '☁️ Online OSRM'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {currentRoute.mode?.toUpperCase()}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-700/40 flex items-center gap-2.5">
              <Compass className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <div className="text-[11px] text-slate-400">Total Distance</div>
                <div className="text-sm font-bold text-white">{currentRoute.distance_km} km</div>
              </div>
            </div>

            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-700/40 flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <div className="text-[11px] text-slate-400">Estimated Time</div>
                <div className="text-sm font-bold text-white">{currentRoute.duration_min} min</div>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-1">
            <Zap className="w-3 h-3 text-amber-400" />
            <span className="truncate">{currentRoute.routing_engine}</span>
          </div>
        </div>
      )}

      {/* Preset Fast-Pick Routes */}
      <div className="flex flex-col gap-1.5 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Quick Demo Presets
        </span>
        <div className="grid grid-cols-1 gap-1.5">
          {presets.map((p, idx) => (
            <button
              key={idx}
              onClick={() => onSelectPreset(p)}
              className="text-left px-2.5 py-1.5 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 rounded-lg text-xs text-slate-300 hover:text-white transition-all flex items-center justify-between"
            >
              <span className="truncate">{p.name}</span>
              <span className="text-[10px] text-slate-500 font-mono shrink-0 ml-2">Load</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
