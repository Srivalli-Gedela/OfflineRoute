import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getTile, saveTile } from '../services/indexedDB.js';
import { Compass, Crosshair, MapPin, Layers } from 'lucide-react';

// Fix Leaflet's default marker icon paths in bundler environments
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
});

export default function MapViewer({
  route,
  origin,
  destination,
  onMapClick,
  regions = [],
  downloadedRegions = [],
  isOffline = false,
  selectedRegion = null,
  coverageError = null,
  isLoading = false,
  onBoundsChange = null
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const routeLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const regionBoundsLayerRef = useRef(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default center San Francisco Downtown
    const map = L.map(mapContainerRef.current, {
      center: [37.7900, -122.4010],
      zoom: 14,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Custom Offline-Aware Tile Layer
    const OfflineTileLayer = L.TileLayer.extend({
      createTile: function (coords, done) {
        const tile = document.createElement('img');
        const { z, x, y } = coords;
        const tileUrl = this.getTileUrl(coords);

        tile.setAttribute('role', 'presentation');

        // Check IndexedDB first for offline tile
        getTile(z, x, y).then((cachedData) => {
          if (cachedData) {
            tile.src = cachedData;
            done(null, tile);
          } else if (navigator.onLine && !isOffline) {
            // Online: fetch from OSM and cache to IndexedDB
            fetch(tileUrl)
              .then((res) => {
                if (!res.ok) throw new Error('Tile fetch failed');
                return res.blob();
              })
              .then((blob) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const base64data = reader.result;
                  tile.src = base64data;
                  saveTile(z, x, y, base64data, 'auto_cache').catch(() => {});
                  done(null, tile);
                };
                reader.readAsDataURL(blob);
              })
              .catch(() => {
                this.renderFallbackTile(tile, coords, done);
              });
          } else {
            // Offline and tile not cached: render clean canvas grid tile
            this.renderFallbackTile(tile, coords, done);
          }
        }).catch(() => {
          this.renderFallbackTile(tile, coords, done);
        });

        return tile;
      },

      renderFallbackTile: function (tile, coords, done) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Dark/clean grid pattern
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 256, 256);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, 256, 256);

        // Subgrid
        ctx.strokeStyle = '#243044';
        ctx.beginPath();
        ctx.moveTo(128, 0); ctx.lineTo(128, 256);
        ctx.moveTo(0, 128); ctx.lineTo(256, 128);
        ctx.stroke();

        ctx.fillStyle = '#64748b';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Offline Area`, 128, 120);
        ctx.fillText(`Zoom ${coords.z} (${coords.x}, ${coords.y})`, 128, 140);

        tile.src = canvas.toDataURL();
        done(null, tile);
      }
    });

    const tileLayer = new OfflineTileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    });
    tileLayer.addTo(map);

    // Click handler for selecting origin and destination on map
    map.on('click', (e) => {
      if (onMapClick) {
        onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
      }
    });

    const reportBounds = () => {
      if (onBoundsChange) {
        const b = map.getBounds();
        const c = map.getCenter();
        onBoundsChange({
          bbox: {
            min_lat: Number(b.getSouth().toFixed(5)),
            min_lon: Number(b.getWest().toFixed(5)),
            max_lat: Number(b.getNorth().toFixed(5)),
            max_lon: Number(b.getEast().toFixed(5))
          },
          center: {
            lat: Number(c.lat.toFixed(5)),
            lon: Number(c.lng.toFixed(5))
          }
        });
      }
    };

    map.on('moveend', reportBounds);
    setTimeout(reportBounds, 500);

    routeLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    regionBoundsLayerRef.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Region Bounding Box Overlays
  useEffect(() => {
    if (!mapInstanceRef.current || !regionBoundsLayerRef.current) return;
    regionBoundsLayerRef.current.clearLayers();

    const downloadedIds = new Set(downloadedRegions.map((r) => r.region_id || r.id));

    regions.forEach((region) => {
      const isDownloaded = downloadedIds.has(region.id || region.region_id);
      const bbox = region.bbox || {
        min_lat: region.bbox_min_lat,
        min_lon: region.bbox_min_lon,
        max_lat: region.bbox_max_lat,
        max_lon: region.bbox_max_lon
      };

      if (!bbox || bbox.min_lat === undefined) return;

      const bounds = [
        [bbox.min_lat, bbox.min_lon],
        [bbox.max_lat, bbox.max_lon]
      ];

      const rect = L.rectangle(bounds, {
        color: isDownloaded ? '#10b981' : '#6366f1',
        weight: isDownloaded ? 2 : 1,
        dashArray: isDownloaded ? null : '4, 4',
        fillColor: isDownloaded ? '#10b981' : '#6366f1',
        fillOpacity: isDownloaded ? 0.08 : 0.03
      });

      rect.bindTooltip(
        `<b>${region.name}</b><br/>${isDownloaded ? '✅ Downloaded (Offline Available)' : '☁️ Cloud Available (Download for Offline)'}`,
        { permanent: false, direction: 'top' }
      );

      regionBoundsLayerRef.current.addLayer(rect);
    });
  }, [regions, downloadedRegions]);

  // Center on Selected Region
  useEffect(() => {
    if (!mapInstanceRef.current || !selectedRegion) return;
    const center = selectedRegion.center || {
      lat: selectedRegion.center_lat,
      lon: selectedRegion.center_lon
    };
    if (center && center.lat) {
      mapInstanceRef.current.flyTo([center.lat, center.lon], selectedRegion.default_zoom || 14, {
        duration: 1.2
      });
    }
  }, [selectedRegion]);

  // Update Markers (Origin and Destination)
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;
    markersLayerRef.current.clearLayers();

    // If calculation failed (coverageError) or actively calculating: clear markers
    if (coverageError || isLoading) {
      return;
    }

    // Start Marker (Green)
    if (origin && origin.lat && origin.lon) {
      const startIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `<div style="background-color: #10b981; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(16, 185, 129, 0.5); border: 2px solid white; color: white; font-weight: bold; font-size: 12px;">A</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      const marker = L.marker([origin.lat, origin.lon], { icon: startIcon });
      marker.bindPopup(`<b>Start Point</b><br/>${origin.name || 'Selected Location'}`);
      markersLayerRef.current.addLayer(marker);
    }

    // Destination Marker (Red)
    if (destination && destination.lat && destination.lon) {
      const endIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `<div style="background-color: #ef4444; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.5); border: 2px solid white; color: white; font-weight: bold; font-size: 12px;">B</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      const marker = L.marker([destination.lat, destination.lon], { icon: endIcon });
      marker.bindPopup(`<b>Destination</b><br/>${destination.name || 'Selected Location'}`);
      markersLayerRef.current.addLayer(marker);
    }
  }, [origin, destination, coverageError, isLoading, route]);

  // Pan to updated locations when selection changes (when no active route polyline)
  useEffect(() => {
    if (!mapInstanceRef.current || route) return;
    if (origin && origin.lat && destination && destination.lat) {
      const bounds = L.latLngBounds([[origin.lat, origin.lon], [destination.lat, destination.lon]]);
      mapInstanceRef.current.fitBounds(bounds, { padding: [80, 80], maxZoom: 14 });
    } else if (destination && destination.lat) {
      mapInstanceRef.current.flyTo([destination.lat, destination.lon], 13);
    } else if (origin && origin.lat) {
      mapInstanceRef.current.flyTo([origin.lat, origin.lon], 13);
    }
  }, [origin, destination, route]);

  // Draw Route Polyline
  useEffect(() => {
    if (!mapInstanceRef.current || !routeLayerRef.current) return;
    routeLayerRef.current.clearLayers();

    if (route && route.geometry && route.geometry.coordinates && !coverageError) {
      // Leaflet expects [lat, lon], GeoJSON has [lon, lat]
      let latLngs = route.geometry.coordinates.map((coord) => [coord[1], coord[0]]);

      // Ensure route polyline connects seamlessly from Marker A (Dot A)
      if (origin && origin.lat != null && origin.lon != null && latLngs.length > 0) {
        const first = latLngs[0];
        const distToStart = Math.hypot(first[0] - origin.lat, first[1] - origin.lon);
        if (distToStart > 0.00002) {
          latLngs.unshift([origin.lat, origin.lon]);
        }
      }

      // Ensure route polyline connects seamlessly to Marker B (Dot B)
      if (destination && destination.lat != null && destination.lon != null && latLngs.length > 0) {
        const last = latLngs[latLngs.length - 1];
        const distToEnd = Math.hypot(last[0] - destination.lat, last[1] - destination.lon);
        if (distToEnd > 0.00002) {
          latLngs.push([destination.lat, destination.lon]);
        }
      }

      // Outer glow polyline
      const glowLine = L.polyline(latLngs, {
        color: route.is_offline ? '#10b981' : '#3b82f6',
        weight: 8,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round'
      });

      // Main route polyline
      const mainLine = L.polyline(latLngs, {
        color: route.is_offline ? '#059669' : '#2563eb',
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
      });

      routeLayerRef.current.addLayer(glowLine);
      routeLayerRef.current.addLayer(mainLine);

      // Auto fit map view to route bounds
      const bounds = L.latLngBounds(latLngs);
      mapInstanceRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }
  }, [route, origin, destination, coverageError]);

  // GPS Locate Me Handler
  const handleLocateMe = () => {
    setGpsLoading(true);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsLoading(false);
          const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'Current GPS Location' };
          if (onMapClick) onMapClick(coords);
          if (mapInstanceRef.current) {
            mapInstanceRef.current.flyTo([coords.lat, coords.lon], 15);
          }
        },
        () => {
          setGpsLoading(false);
          // Fallback to center of active region
          if (selectedRegion && selectedRegion.center) {
            const coords = { ...selectedRegion.center, name: `${selectedRegion.name} (Simulated GPS)` };
            if (onMapClick) onMapClick(coords);
          }
        },
        { timeout: 5000 }
      );
    } else {
      setGpsLoading(false);
    }
  };

  return (
    <div className="relative w-full h-full min-h-[500px] bg-slate-900 rounded-xl overflow-hidden border border-slate-700/60 shadow-2xl">
      <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: '520px' }} />

      {/* Floating GPS and Region Quick Controls */}
      <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
        <button
          onClick={handleLocateMe}
          title="Locate my position (GPS)"
          className="p-3 bg-slate-800/90 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 rounded-xl border border-slate-600/60 shadow-lg backdrop-blur-md transition-all active:scale-95 flex items-center justify-center"
        >
          <Crosshair className={`w-5 h-5 ${gpsLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Map Legend Overlay */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-slate-900/85 backdrop-blur-md px-3.5 py-2.5 rounded-lg border border-slate-700 text-xs text-slate-300 flex items-center gap-4 shadow-lg pointer-events-none">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block border border-white/50" />
          <span>Start (A)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-rose-500 inline-block border border-white/50" />
          <span>Dest (B)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 bg-emerald-400 inline-block rounded" />
          <span>Offline Route</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 bg-blue-500 inline-block rounded" />
          <span>Online Route</span>
        </div>
      </div>
    </div>
  );
}
