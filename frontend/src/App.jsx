import React, { useState, useEffect, useRef } from 'react';
import MapViewer from './components/MapViewer.jsx';
import RoutePanel from './components/RoutePanel.jsx';
import TurnByTurn from './components/TurnByTurn.jsx';
import RegionManager from './components/RegionManager.jsx';
import SavedRoutes from './components/SavedRoutes.jsx';
import CNDashboard from './components/CNDashboard.jsx';
import SyncIndicator from './components/SyncIndicator.jsx';
import {
  Compass,
  Layers,
  History,
  Activity,
  MapPin,
  Menu,
  X,
  HardDrive,
  Route as RouteIcon
} from 'lucide-react';
import {
  getAllRegions,
  findCachedRoute,
  saveRoute
} from './services/indexedDB.js';
import { calculateOfflineRoute, findCoveringDownloadedRegion, haversineDistanceMeters } from './services/offlineRouter.js';
import { networkManager } from './services/cnNetworkManager.js';

function isRouteMatching(cached, startPoint, endPoint, mode) {
  if (!cached || !cached.origin || !cached.destination) return false;
  if (cached.mode && mode && cached.mode !== mode) return false;
  const oLatDiff = Math.abs(Number(cached.origin.lat) - Number(startPoint.lat));
  const oLonDiff = Math.abs(Number(cached.origin.lon) - Number(startPoint.lon));
  const dLatDiff = Math.abs(Number(cached.destination.lat) - Number(endPoint.lat));
  const dLonDiff = Math.abs(Number(cached.destination.lon) - Number(endPoint.lon));
  if (oLatDiff > 0.002 || oLonDiff > 0.002 || dLatDiff > 0.002 || dLonDiff > 0.002) {
    return false;
  }
  const straightDistKm = haversineDistanceMeters(
    Number(startPoint.lat), Number(startPoint.lon),
    Number(endPoint.lat), Number(endPoint.lon)
  ) / 1000.0;
  if (cached.distance_km && cached.distance_km < (straightDistKm * 0.65)) {
    return false;
  }
  return true;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('navigate'); // 'navigate' | 'regions' | 'saved'
  const [origin, setOrigin] = useState({ name: 'Ferry Building / Embarcadero', lat: 37.7955, lon: -122.3937 });
  const [destination, setDestination] = useState({ name: 'Moscone Convention Center', lat: 37.7842, lon: -122.4015 });
  const [currentRoute, setCurrentRoute] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [coverageError, setCoverageError] = useState(null);

  const [availableRegions, setAvailableRegions] = useState([]);
  const [downloadedRegions, setDownloadedRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [isOffline, setIsOffline] = useState(!networkManager.getEffectiveOnlineStatus());
  const [mapViewInfo, setMapViewInfo] = useState(null);

  const activeQueryIdRef = useRef(0);

  const handleClearRoute = () => {
    activeQueryIdRef.current++;
    setCurrentRoute(null);
    setCoverageError(null);
    setIsLoading(false);
  };

  // Subscribe to network changes
  useEffect(() => {
    const unsub = networkManager.subscribe(async (data) => {
      const offlineNow = !data.isOnline;
      setIsOffline(offlineNow);

      if (offlineNow) {
        // Switching to Offline Mode:
        // Validate if current route or selected locations are covered by downloaded regions!
        if (origin && destination) {
          const coverage = await findCoveringDownloadedRegion(origin, destination);
          if (!coverage.covered) {
            // Coverage unavailable: clear route, distance, estimated time, summary, markers!
            activeQueryIdRef.current++;
            setCurrentRoute(null);
            setCoverageError('Destination outside offline coverage. Connect to the internet or download the required region.');
          }
        }
      } else {
        // Switching to Online Mode
        setCoverageError(null);
      }
    });
    return () => unsub();
  }, [origin, destination]);

  // Fetch regions from server and local IndexedDB
  const fetchRegions = async () => {
    try {
      // 1. Get downloaded regions from local IndexedDB
      const localDownloaded = await getAllRegions();
      setDownloadedRegions(localDownloaded);

      // 2. Fetch available regions from server
      if (networkManager.getEffectiveOnlineStatus()) {
        const resp = await networkManager.request('/api/regions');
        if (resp.ok || resp.status === 304) {
          const merged = [...(resp.data || [])];
          for (const loc of localDownloaded) {
            const locId = loc.id || loc.region_id;
            if (!merged.some((m) => (m.id || m.region_id) === locId)) {
              merged.push(loc);
            }
          }
          setAvailableRegions(merged);
          if (!selectedRegion && merged.length > 0) {
            setSelectedRegion(merged[0]);
          }
        }
      } else {
        // When offline, available list is downloaded regions
        setAvailableRegions(localDownloaded);
        if (!selectedRegion && localDownloaded.length > 0) {
          setSelectedRegion(localDownloaded[0]);
        }
      }
    } catch (err) {
      console.warn('Regions fetch error:', err.message);
      const localDownloaded = await getAllRegions();
      setDownloadedRegions(localDownloaded);
      setAvailableRegions(localDownloaded);
    }
  };

  useEffect(() => {
    fetchRegions();
  }, [isOffline]);

  // Master Route Calculation Handler (Online OSRM vs Offline Local A* vs Cache)
  const handleCalculateRoute = async (startPoint, endPoint, mode = 'driving') => {
    if (!startPoint || !endPoint) return;

    // Clear previous route results, markers, distance, time and summary whenever a new query starts
    const queryId = ++activeQueryIdRef.current;
    setCurrentRoute(null);
    setCoverageError(null);
    setIsLoading(true);

    const effectiveOnline = networkManager.getEffectiveOnlineStatus() && !isOffline;

    try {
      // Step 1: If offline, validate source, destination and connecting road-network coverage FIRST
      if (!effectiveOnline) {
        console.log('[Route] Operating Offline: Validating coverage and road network...');
        const coverageCheck = await findCoveringDownloadedRegion(startPoint, endPoint);
        if (queryId !== activeQueryIdRef.current) return;

        if (!coverageCheck.covered) {
          // If coverage is unavailable, do not calculate or display any route, distance, estimated time or summary.
          setCurrentRoute(null);
          setCoverageError('Destination outside offline coverage. Connect to the internet or download the required region.');
          setIsLoading(false);
          return;
        }

        // Reuse cached routes only when their source, destination and coverage are valid.
        const cached = await findCachedRoute(startPoint, endPoint, mode);
        if (queryId !== activeQueryIdRef.current) return;

        if (cached && isRouteMatching(cached, startPoint, endPoint, mode)) {
          console.log('[Route] Loaded directly from Client IndexedDB Cache (Valid Offline Coverage)!');
          setCurrentRoute({
            ...cached,
            cache_status: 'HIT',
            routing_engine: 'Client IndexedDB Cache (Valid Offline Coverage)'
          });
          setIsLoading(false);
          return;
        }

        // Display routes only after valid offline A* calculation
        console.log('[Route] Operating Offline: Calculating route with local A* engine...');
        const offlineResult = await calculateOfflineRoute(startPoint, endPoint, mode);
        if (queryId !== activeQueryIdRef.current) return;

        if (!offlineResult.success) {
          setCurrentRoute(null);
          setCoverageError(offlineResult.error || 'Destination outside offline coverage. Connect to the internet or download the required region.');
          setIsLoading(false);
          return;
        }

        setCurrentRoute(offlineResult.route);
        setIsLoading(false);
        return;
      }

      // Online Mode
      // Check cache first for online mode
      const cached = await findCachedRoute(startPoint, endPoint, mode);
      if (queryId !== activeQueryIdRef.current) return;

      if (cached && isRouteMatching(cached, startPoint, endPoint, mode)) {
        console.log('[Route] Loaded directly from Client IndexedDB Cache (0ms)!');
        setCurrentRoute({
          ...cached,
          cache_status: 'HIT',
          routing_engine: 'Client IndexedDB Cache (0ms latency)'
        });
        setIsLoading(false);
        return;
      }

      // Online route calculation via Backend API (with ETag & Conditional GET)
      console.log('[Route] Requesting route from server (HTTP/1.1)...');
      const resp = await networkManager.request('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: startPoint,
          destination: endPoint,
          mode
        })
      });
      if (queryId !== activeQueryIdRef.current) return;

      if (!resp.ok && resp.status !== 304) {
        throw new Error(resp.data?.error || `Server returned HTTP ${resp.status}`);
      }

      const routeData = resp.data;
      setCurrentRoute(routeData);

      // Cache locally for future offline access
      await saveRoute(routeData);
    } catch (err) {
      if (queryId !== activeQueryIdRef.current) return;
      console.error('Routing failed:', err);

      // Fallback: If online call failed (e.g. packet loss / timeout), attempt offline calculation only if covered
      console.log('[Route] Online failed. Attempting offline fallback...');
      const fallbackResult = await calculateOfflineRoute(startPoint, endPoint, mode);
      if (queryId !== activeQueryIdRef.current) return;

      if (fallbackResult.success) {
        setCurrentRoute(fallbackResult.route);
      } else {
        setCurrentRoute(null);
        setCoverageError('Destination outside offline coverage. Connect to the internet or download the required region.');
      }
    } finally {
      if (queryId === activeQueryIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  // Preset Selection
  const handleSelectPreset = (preset) => {
    handleClearRoute();
    setOrigin(preset.origin);
    setDestination(preset.dest);
    handleCalculateRoute(preset.origin, preset.dest, 'driving');
  };

  // Map Click Handler: alternates between setting Origin and Destination
  const handleMapClick = (coords) => {
    handleClearRoute();
    if (!origin) {
      setOrigin({ name: `Point (${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)})`, ...coords });
    } else if (!destination) {
      setDestination({ name: `Point (${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)})`, ...coords });
    } else {
      // If both exist, reset origin and start fresh
      setOrigin({ name: `Point (${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)})`, ...coords });
      setDestination(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="bg-slate-900/90 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-emerald-900/20">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white">OfflineRoute</h1>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Hybrid System
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Offline-First Navigation • Local A* Engine • Computer Networks Telemetry
            </p>
          </div>
        </div>

        {/* Sync & Connectivity Status */}
        <SyncIndicator />
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 flex flex-col gap-5">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('navigate')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === 'navigate'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <RouteIcon className="w-4 h-4 text-emerald-400" />
            <span>Route Planner</span>
          </button>

          <button
            onClick={() => setActiveTab('regions')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === 'regions'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <HardDrive className="w-4 h-4 text-indigo-400" />
            <span>Offline Regions ({downloadedRegions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('saved')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === 'saved'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <History className="w-4 h-4 text-cyan-400" />
            <span>Cached Routes</span>
          </button>
        </div>

        {/* Dynamic Grid: Left Sidebar & Right Map */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Panel */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {activeTab === 'navigate' && (
              <>
                <RoutePanel
                  origin={origin}
                  destination={destination}
                  setOrigin={setOrigin}
                  setDestination={setDestination}
                  onCalculateRoute={handleCalculateRoute}
                  isLoading={isLoading}
                  currentRoute={currentRoute}
                  isOffline={isOffline}
                  coverageError={coverageError}
                  downloadedRegions={downloadedRegions}
                  onSelectPreset={handleSelectPreset}
                  onClearRoute={handleClearRoute}
                />
                <TurnByTurn steps={currentRoute?.steps || []} />
              </>
            )}

            {activeTab === 'regions' && (
              <RegionManager
                availableRegions={availableRegions}
                downloadedRegions={downloadedRegions}
                onRegionsUpdated={fetchRegions}
                onSelectRegion={(reg) => setSelectedRegion(reg)}
                mapViewInfo={mapViewInfo}
                origin={origin}
                destination={destination}
              />
            )}

            {activeTab === 'saved' && (
              <SavedRoutes
                currentRouteId={currentRoute?.route_id}
                onLoadRoute={async (r) => {
                  handleClearRoute();
                  if (!networkManager.getEffectiveOnlineStatus() || isOffline) {
                    const coverage = await findCoveringDownloadedRegion(r.origin, r.destination);
                    if (!coverage.covered) {
                      setOrigin(r.origin);
                      setDestination(r.destination);
                      setCurrentRoute(null);
                      setCoverageError('Destination outside offline coverage. Connect to the internet or download the required region.');
                      setActiveTab('navigate');
                      return;
                    }
                  }
                  setOrigin(r.origin);
                  setDestination(r.destination);
                  setCurrentRoute(r);
                  setActiveTab('navigate');
                }}
              />
            )}
          </div>

          {/* Right Map View */}
          <div className="lg:col-span-7 flex flex-col gap-3 min-h-[500px]">
            <MapViewer
              route={currentRoute}
              origin={origin}
              destination={destination}
              onMapClick={handleMapClick}
              regions={availableRegions}
              downloadedRegions={downloadedRegions}
              isOffline={isOffline}
              selectedRegion={selectedRegion}
              coverageError={coverageError}
              isLoading={isLoading}
              onBoundsChange={setMapViewInfo}
            />
          </div>
        </div>

        {/* Computer Networks Telemetry & Protocol Inspector */}
        <div className="w-full mt-2">
          <CNDashboard />
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900/60 border-t border-slate-800/80 px-6 py-4 text-center text-xs text-slate-500">
        OfflineRoute • Full-Stack Hybrid Offline Navigation System • Demonstrating HTTP Caching, TCP, DNS & Offline Graph A*
      </footer>
    </div>
  );
}
