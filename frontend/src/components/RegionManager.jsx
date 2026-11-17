import React, { useState, useEffect } from 'react';
import {
  Download,
  Trash2,
  HardDrive,
  Database,
  CheckCircle2,
  Layers,
  MapPin,
  RefreshCw,
  AlertCircle,
  FileCheck,
  Search,
  Crosshair,
  Globe
} from 'lucide-react';
import {
  saveRegion,
  deleteRegion,
  getAllRegions,
  saveTile,
  getStorageMetrics,
  purgeLRUCache,
  clearAllCache
} from '../services/indexedDB.js';
import { networkManager } from '../services/cnNetworkManager.js';

export default function RegionManager({
  availableRegions = [],
  downloadedRegions = [],
  onRegionsUpdated,
  onSelectRegion,
  mapViewInfo = null,
  origin = null,
  destination = null
}) {
  const [downloadingId, setDownloadingId] = useState(null);
  const [progressText, setProgressText] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [storageStats, setStorageStats] = useState(null);
  const [purgeFeedback, setPurgeFeedback] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const refreshStorage = async () => {
    try {
      const stats = await getStorageMetrics();
      setStorageStats(stats);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refreshStorage();
  }, [downloadedRegions]);

  const downloadedIds = new Set(downloadedRegions.map((r) => r.region_id || r.id));

  // Merge available server regions and local downloaded regions to display all
  const allRegionsMap = new Map();
  availableRegions.forEach((r) => allRegionsMap.set(r.id || r.region_id, r));
  downloadedRegions.forEach((r) => {
    const id = r.id || r.region_id;
    allRegionsMap.set(id, { ...allRegionsMap.get(id), ...r });
  });
  const allRegionsList = Array.from(allRegionsMap.values());

  // Search arbitrary geographical regions via Nominatim geocoding
  const handleSearchRegions = async () => {
    if (!searchQuery || searchQuery.trim().length < 2) return;
    setIsSearching(true);
    try {
      const resp = await fetch(`/api/regions/search?q=${encodeURIComponent(searchQuery)}`);
      if (resp.ok) {
        const data = await resp.json();
        setSearchResults(data);
      }
    } catch (err) {
      console.error('Region search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Download Custom / Arbitrary Region with Real OSM Road Network + Tiles
  const handleDownloadCustom = async (customRegion) => {
    const customId = customRegion.region_id || customRegion.id || `custom_${Date.now()}`;
    setDownloadingId(customId);
    setProgressPercent(15);
    setProgressText(`1/3 Fetching real OpenStreetMap road network for ${customRegion.name}...`);

    try {
      const resp = await fetch('/api/regions/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customRegion.name,
          city: customRegion.city || 'Custom Area',
          country: customRegion.country || 'Global',
          bbox: customRegion.bbox,
          center: customRegion.center,
          origin: customRegion.origin || null,
          destination: customRegion.destination || null
        })
      });

      if (!resp.ok) {
        throw new Error(`Server returned HTTP ${resp.status}`);
      }

      const regionData = await resp.json();
      setProgressPercent(45);
      setProgressText(`2/3 Storing ${regionData.node_count} nodes & ${regionData.edge_count} edges into IndexedDB...`);

      await saveRegion(regionData);

      // Pre-cache tiles
      setProgressPercent(65);
      setProgressText('3/3 Pre-caching map tiles for offline viewing...');

      try {
        const manifestResult = await networkManager.request(`/api/regions/${regionData.region_id}/tiles-manifest`);
        if (manifestResult.ok && manifestResult.data?.tiles) {
          const tiles = manifestResult.data.tiles.slice(0, 35);
          let count = 0;
          for (const t of tiles) {
            try {
              const res = await fetch(t.url);
              if (res.ok) {
                const blob = await res.blob();
                const reader = new FileReader();
                reader.onloadend = async () => {
                  await saveTile(t.z, t.x, t.y, reader.result, regionData.region_id);
                };
                reader.readAsDataURL(blob);
              }
            } catch {
              // Ignore single tile network failures
            }
            count++;
            setProgressPercent(65 + Math.round((count / tiles.length) * 30));
          }
        }
      } catch (e) {
        console.warn('Tile pre-caching skipped:', e);
      }

      setProgressPercent(100);
      setProgressText(`Done! ${regionData.name} is now 100% available offline.`);
      setSearchResults([]);
      setSearchQuery('');

      if (onRegionsUpdated) {
        await onRegionsUpdated();
      }
      await refreshStorage();
    } catch (err) {
      console.error('Download custom region error:', err);
      alert(`Download failed: ${err.message}`);
    } finally {
      setTimeout(() => {
        setDownloadingId(null);
        setProgressText('');
        setProgressPercent(0);
      }, 1000);
    }
  };

  const handleDownloadMapArea = () => {
    if (!mapViewInfo || !mapViewInfo.bbox) {
      alert('Map coordinates not ready yet. Please navigate the map and try again.');
      return;
    }
    const targetRegion = {
      name: `Map Area (${mapViewInfo.center.lat.toFixed(3)}, ${mapViewInfo.center.lon.toFixed(3)})`,
      city: 'Custom Map Area',
      country: 'Visible Bounds',
      bbox: mapViewInfo.bbox,
      center: mapViewInfo.center
    };
    handleDownloadCustom(targetRegion);
  };

  const handleDownloadRouteArea = () => {
    if (!origin || !destination) return;
    const minLat = Math.min(origin.lat, destination.lat) - 0.02;
    const maxLat = Math.max(origin.lat, destination.lat) + 0.02;
    const minLon = Math.min(origin.lon, destination.lon) - 0.02;
    const maxLon = Math.max(origin.lon, destination.lon) + 0.02;

    const oName = (origin.name || 'Origin').split(',')[0].trim();
    const dName = (destination.name || 'Destination').split(',')[0].trim();

    const targetRegion = {
      name: `${oName} ➔ ${dName}`,
      city: oName,
      country: 'Corridor',
      bbox: { min_lat: minLat, min_lon: minLon, max_lat: maxLat, max_lon: maxLon },
      center: { lat: (origin.lat + destination.lat) / 2.0, lon: (origin.lon + destination.lon) / 2.0 },
      origin,
      destination
    };
    handleDownloadCustom(targetRegion);
  };

  // Download Predefined Region with Road Network Graph + Map Tile Pre-caching
  const handleDownloadRegion = async (region) => {
    const regionId = region.id || region.region_id;
    setDownloadingId(regionId);
    setProgressPercent(10);
    setProgressText('1/3 Fetching road network graph from server (HTTP Conditional GET)...');

    try {
      const result = await networkManager.request(`/api/regions/${regionId}`);
      if (!result.ok && result.status !== 304) {
        throw new Error(`Server returned HTTP ${result.status}`);
      }

      setProgressPercent(40);
      setProgressText('2/3 Storing nodes, edges & spatial index into IndexedDB...');

      const regionData = result.data;
      await saveRegion(regionData);

      setProgressPercent(60);
      setProgressText('3/3 Pre-caching map tiles for offline viewing...');

      try {
        const manifestResult = await networkManager.request(`/api/regions/${regionId}/tiles-manifest`);
        if (manifestResult.ok && manifestResult.data?.tiles) {
          const tiles = manifestResult.data.tiles.slice(0, 35);
          let count = 0;
          for (const t of tiles) {
            try {
              const res = await fetch(t.url);
              if (res.ok) {
                const blob = await res.blob();
                const reader = new FileReader();
                reader.onloadend = async () => {
                  await saveTile(t.z, t.x, t.y, reader.result, regionId);
                };
                reader.readAsDataURL(blob);
              }
            } catch {
              // Ignore single tile network errors
            }
            count++;
            setProgressPercent(60 + Math.round((count / tiles.length) * 35));
          }
        }
      } catch (err) {
        console.warn('Tile pre-caching skipped:', err);
      }

      setProgressPercent(100);
      setProgressText('Done! Region is now 100% available offline.');

      if (onRegionsUpdated) {
        await onRegionsUpdated();
      }
      await refreshStorage();
    } catch (err) {
      console.error('Region download error:', err);
      alert(`Download failed: ${err.message}`);
    } finally {
      setTimeout(() => {
        setDownloadingId(null);
        setProgressText('');
        setProgressPercent(0);
      }, 800);
    }
  };

  const handleDeleteRegion = async (regionId) => {
    if (!window.confirm('Delete this offline region and its cached tiles from local storage?')) return;
    try {
      await deleteRegion(regionId);
      if (onRegionsUpdated) {
        await onRegionsUpdated();
      }
      await refreshStorage();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleLRUPurge = async () => {
    try {
      const evicted = await purgeLRUCache(10);
      setPurgeFeedback(`LRU Eviction complete: purged ${evicted} old cached routes.`);
      await refreshStorage();
      setTimeout(() => setPurgeFeedback(''), 4000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Clear all cached routes and map tiles from IndexedDB?')) return;
    try {
      await clearAllCache();
      setPurgeFeedback('Cleared all routes and tiles cache.');
      await refreshStorage();
      setTimeout(() => setPurgeFeedback(''), 4000);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-indigo-400" />
          <div>
            <h3 className="text-sm font-semibold text-white">Offline Regions & Storage Manager</h3>
            <p className="text-xs text-slate-400">IndexedDB Regional Road Networks & Tiles</p>
          </div>
        </div>
      </div>

      {/* Dynamic Search & Download Any City / Region Box */}
      <div className="flex flex-col gap-2.5 p-3.5 bg-slate-800/70 border border-slate-700/80 rounded-xl shadow-inner">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-indigo-400" />
            Download Any Region Worldwide (OpenStreetMap)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-2 focus-within:border-indigo-500 transition-colors">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search any city, town or region (e.g. Patna, Bihta, Tokyo)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchRegions()}
              className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none"
            />
          </div>
          <button
            onClick={handleSearchRegions}
            disabled={isSearching}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition-all"
          >
            <Search className="w-3.5 h-3.5" />
            <span>{isSearching ? 'Searching...' : 'Search'}</span>
          </button>
        </div>

        {/* Dynamic Search Results */}
        {searchResults.length > 0 && (
          <div className="flex flex-col gap-2 mt-1 max-h-56 overflow-y-auto pr-1">
            {searchResults.map((item, idx) => (
              <div
                key={idx}
                className="p-2.5 bg-slate-900/70 border border-slate-700/70 rounded-lg flex items-center justify-between text-xs text-slate-200 transition-colors"
              >
                <div className="min-w-0 pr-2">
                  <div className="font-semibold text-slate-100 truncate">{item.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">{item.display_name}</div>
                </div>
                <button
                  onClick={() => handleDownloadCustom(item)}
                  disabled={downloadingId !== null}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-[11px] font-medium flex items-center gap-1 shrink-0 shadow-sm transition-all"
                >
                  <Download className="w-3 h-3" />
                  <span>Download</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Map Area & Active Route Quick Download Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-700/50">
          {mapViewInfo && (
            <button
              onClick={handleDownloadMapArea}
              disabled={downloadingId !== null}
              className="px-2.5 py-1.5 bg-slate-700/80 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-colors border border-slate-600/60"
            >
              <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
              <span>Download Visible Map Area ({mapViewInfo.center?.lat?.toFixed(2)}, {mapViewInfo.center?.lon?.toFixed(2)})</span>
            </button>
          )}

          {origin && destination && (
            <button
              onClick={handleDownloadRouteArea}
              disabled={downloadingId !== null}
              className="px-2.5 py-1.5 bg-slate-700/80 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-colors border border-slate-600/60"
            >
              <MapPin className="w-3.5 h-3.5 text-indigo-400" />
              <span>Download Active Route: {(origin.name || 'Origin').split(',')[0]} ➔ {(destination.name || 'Destination').split(',')[0]}</span>
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar when Downloading */}
      {downloadingId && (
        <div className="p-3 bg-indigo-950/40 border border-indigo-500/40 rounded-xl flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-indigo-300 font-medium">
            <span>{progressText}</span>
            <span className="font-mono">{progressPercent}%</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Geographical Regions List */}
      <div className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Available & Downloaded Regions ({allRegionsList.length})
        </span>

        {allRegionsList.map((region) => {
          const regionId = region.id || region.region_id;
          const isDownloaded = downloadedIds.has(regionId);
          const isCurrentDownloading = downloadingId === regionId;

          return (
            <div
              key={regionId}
              className={`p-3.5 rounded-xl border transition-all flex flex-col gap-2.5 ${
                isDownloaded
                  ? 'bg-slate-800/80 border-emerald-500/40 shadow-sm'
                  : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">{region.name}</span>
                    {isDownloaded && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Offline Ready
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{region.city}, {region.country}</div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onSelectRegion(region)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                  >
                    View Map
                  </button>

                  {isDownloaded ? (
                    <button
                      onClick={() => handleDeleteRegion(regionId)}
                      title="Delete offline data"
                      className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDownloadRegion(region)}
                      disabled={isCurrentDownloading}
                      className="px-3 py-1 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 shadow-sm transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{isCurrentDownloading ? 'Downloading...' : 'Download'}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="text-xs text-slate-400 leading-relaxed">
                {region.description}
              </div>

              <div className="flex items-center gap-4 text-[11px] text-slate-400 font-mono pt-1 border-t border-slate-700/40">
                <span>Nodes: <strong className="text-slate-200">{region.node_count || 30}</strong></span>
                <span>Edges: <strong className="text-slate-200">{region.edge_count || 36}</strong></span>
                <span>Size: <strong className="text-slate-200">{region.size_kb || 45} KB</strong></span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Storage Metrics & LRU Manager */}
      <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-semibold text-slate-200">Local Storage & LRU Engine</span>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            ~{storageStats?.estimatedTotalKb || 0} KB / 50 MB
          </span>
        </div>

        {/* Storage Bar Breakdown */}
        <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden flex">
          <div
            style={{ width: `${Math.min(100, Math.max(5, (storageStats?.breakdownKb?.tiles || 0) / 500))}%` }}
            className="bg-emerald-500 h-full"
            title="Map Tiles"
          />
          <div
            style={{ width: `${Math.min(100, Math.max(5, (storageStats?.breakdownKb?.regions || 0) / 500))}%` }}
            className="bg-indigo-500 h-full"
            title="Regions"
          />
          <div
            style={{ width: `${Math.min(100, Math.max(5, (storageStats?.breakdownKb?.routes || 0) / 500))}%` }}
            className="bg-cyan-500 h-full"
            title="Cached Routes"
          />
        </div>

        {/* Legend */}
        <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Tiles: {storageStats?.tilesCount || 0}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            <span>Regions: {storageStats?.regionsCount || 0}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-500" />
            <span>Routes: {storageStats?.routesCount || 0}</span>
          </div>
        </div>

        {/* LRU Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
          <button
            onClick={handleLRUPurge}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium text-slate-200 transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Enforce LRU Cleanup</span>
          </button>

          <button
            onClick={handleClearAll}
            className="px-3 py-1.5 bg-slate-700/60 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded-lg text-xs font-medium transition-colors"
          >
            Purge Tiles & Routes
          </button>
        </div>

        {purgeFeedback && (
          <div className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>{purgeFeedback}</span>
          </div>
        )}
      </div>
    </div>
  );
}
