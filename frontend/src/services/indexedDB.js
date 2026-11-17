/**
 * IndexedDB Service for OfflineRoute.
 * Provides client-side persistent storage for:
 * 1. Downloaded Regional Road Networks (Nodes & Edges graph)
 * 2. Offline Map Tiles (z/x/y tiles for offline Leaflet rendering)
 * 3. Cached Routes with LRU metadata
 * 4. Frequently Visited Destinations
 * 5. Sync Queue for intermittent connectivity reconnection
 */

const DB_NAME = 'OfflineRouteDB';
const DB_VERSION = 1;

let dbPromise = null;

export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store 1: Regional Road Networks
      if (!db.objectStoreNames.contains('regions')) {
        const regionsStore = db.createObjectStore('regions', { keyPath: 'region_id' });
        regionsStore.createIndex('name', 'name', { unique: false });
        regionsStore.createIndex('downloaded_at', 'downloaded_at', { unique: false });
      }

      // Store 2: Offline Map Tiles
      if (!db.objectStoreNames.contains('tiles')) {
        const tilesStore = db.createObjectStore('tiles', { keyPath: 'key' }); // 'z/x/y'
        tilesStore.createIndex('region_id', 'region_id', { unique: false });
        tilesStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Store 3: Cached Routes (with LRU metadata)
      if (!db.objectStoreNames.contains('cached_routes')) {
        const routesStore = db.createObjectStore('cached_routes', { keyPath: 'id' });
        routesStore.createIndex('last_accessed_at', 'last_accessed_at', { unique: false });
        routesStore.createIndex('hits', 'hits', { unique: false });
        routesStore.createIndex('signature', 'signature', { unique: false });
      }

      // Store 4: Frequently Visited Destinations
      if (!db.objectStoreNames.contains('frequently_visited')) {
        const destStore = db.createObjectStore('frequently_visited', { keyPath: 'id' });
        destStore.createIndex('popularity', 'popularity', { unique: false });
        destStore.createIndex('last_visited', 'last_visited', { unique: false });
      }

      // Store 5: Sync Queue for offline events
      if (!db.objectStoreNames.contains('sync_queue')) {
        const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
        syncStore.createIndex('status', 'status', { unique: false });
        syncStore.createIndex('created_at', 'created_at', { unique: false });
      }

      // Store 6: Cache Metadata (LRU storage limits & metrics)
      if (!db.objectStoreNames.contains('cache_metadata')) {
        db.createObjectStore('cache_metadata', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });

  return dbPromise;
}

// -----------------------------------------------------------------------------
// Regional Road Networks
// -----------------------------------------------------------------------------
export async function saveRegion(regionData) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['regions'], 'readwrite');
    const store = tx.objectStore('regions');
    const record = {
      ...regionData,
      downloaded_at: new Date().toISOString()
    };
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function getRegion(regionId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['regions'], 'readonly');
    const store = tx.objectStore('regions');
    const req = store.get(regionId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllRegions() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['regions'], 'readonly');
    const store = tx.objectStore('regions');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRegion(regionId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['regions', 'tiles'], 'readwrite');
    tx.objectStore('regions').delete(regionId);

    // Delete tiles associated with region
    const tilesStore = tx.objectStore('tiles');
    const index = tilesStore.index('region_id');
    const req = index.openCursor(IDBKeyRange.only(regionId));
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// -----------------------------------------------------------------------------
// Map Tiles Caching
// -----------------------------------------------------------------------------
export async function saveTile(z, x, y, dataUrlOrBlob, regionId = 'global') {
  const db = await openDatabase();
  const key = `${z}/${x}/${y}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['tiles'], 'readwrite');
    const store = tx.objectStore('tiles');
    const record = {
      key,
      z, x, y,
      data: dataUrlOrBlob,
      region_id: regionId,
      timestamp: Date.now()
    };
    const req = store.put(record);
    req.onsuccess = () => resolve(key);
    req.onerror = () => reject(req.error);
  });
}

export async function getTile(z, x, y) {
  const db = await openDatabase();
  const key = `${z}/${x}/${y}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['tiles'], 'readonly');
    const store = tx.objectStore('tiles');
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.data : null);
    req.onerror = () => reject(req.error);
  });
}

export async function getTilesCount() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['tiles'], 'readonly');
    const store = tx.objectStore('tiles');
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// -----------------------------------------------------------------------------
// Route Caching with LRU (Least Recently Used) Management
// -----------------------------------------------------------------------------
export function createRouteSignature(origin, dest, mode = 'driving') {
  if (!origin || !dest || origin.lat == null || origin.lon == null || dest.lat == null || dest.lon == null) {
    return '';
  }
  const oLat = Number(origin.lat).toFixed(4);
  const oLon = Number(origin.lon).toFixed(4);
  const dLat = Number(dest.lat).toFixed(4);
  const dLon = Number(dest.lon).toFixed(4);
  return `${oLat},${oLon}->${dLat},${dLon}_${mode}`;
}

export async function saveRoute(route) {
  const db = await openDatabase();
  const signature = createRouteSignature(route.origin, route.destination, route.mode);
  const id = route.route_id || `route_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cached_routes'], 'readwrite');
    const store = tx.objectStore('cached_routes');
    
    // Check if route exists to update hits
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      const record = {
        ...route,
        id,
        signature,
        hits: existing ? (existing.hits || 1) + 1 : 1,
        created_at: existing ? existing.created_at : now,
        last_accessed_at: now
      };
      store.put(record);
      resolve(record);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function findCachedRoute(origin, dest, mode = 'driving') {
  const signature = createRouteSignature(origin, dest, mode);
  if (!signature) return null;
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cached_routes'], 'readwrite');
    const store = tx.objectStore('cached_routes');
    const index = store.index('signature');
    const req = index.get(signature);

    req.onsuccess = () => {
      const match = req.result;
      if (match) {
        // Validate coordinates: origin and dest must match closely (< 0.002 deg)
        const oLatDiff = Math.abs(Number(match.origin?.lat) - Number(origin.lat));
        const oLonDiff = Math.abs(Number(match.origin?.lon) - Number(origin.lon));
        const dLatDiff = Math.abs(Number(match.destination?.lat) - Number(dest.lat));
        const dLonDiff = Math.abs(Number(match.destination?.lon) - Number(dest.lon));

        if (oLatDiff > 0.002 || oLonDiff > 0.002 || dLatDiff > 0.002 || dLonDiff > 0.002 || (match.mode && match.mode !== mode)) {
          resolve(null);
          return;
        }

        // Update LRU last accessed time and hits
        match.hits = (match.hits || 1) + 1;
        match.last_accessed_at = new Date().toISOString();
        store.put(match);
        resolve(match);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllCachedRoutes() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cached_routes'], 'readonly');
    const store = tx.objectStore('cached_routes');
    const index = store.index('last_accessed_at');
    const req = index.getAll();
    req.onsuccess = () => {
      const results = req.result || [];
      // Return sorted with most recently accessed first
      resolve(results.reverse());
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCachedRoute(routeId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cached_routes'], 'readwrite');
    const store = tx.objectStore('cached_routes');
    const req = store.delete(routeId);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// -----------------------------------------------------------------------------
// Frequently Visited Destinations
// -----------------------------------------------------------------------------
export async function trackDestinationVisit(dest) {
  const db = await openDatabase();
  const id = dest.id || `dest_${dest.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const now = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['frequently_visited'], 'readwrite');
    const store = tx.objectStore('frequently_visited');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result;
      const record = {
        id,
        name: dest.name,
        category: dest.category || 'Location',
        lat: dest.lat,
        lon: dest.lon,
        region_id: dest.region_id || null,
        visits: existing ? (existing.visits || 1) + 1 : 1,
        last_visited: now
      };
      store.put(record);
      resolve(record);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getFrequentlyVisitedDestinations() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['frequently_visited'], 'readonly');
    const store = tx.objectStore('frequently_visited');
    const req = store.getAll();
    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => (b.visits || 0) - (a.visits || 0));
      resolve(list.slice(0, 8));
    };
    req.onerror = () => reject(req.error);
  });
}

// -----------------------------------------------------------------------------
// Sync Queue for Offline Actions
// -----------------------------------------------------------------------------
export async function enqueueSyncEvent(eventType, payload) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sync_queue'], 'readwrite');
    const store = tx.objectStore('sync_queue');
    const record = {
      type: eventType,
      payload,
      status: 'PENDING',
      created_at: new Date().toISOString()
    };
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingSyncEvents() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sync_queue'], 'readonly');
    const store = tx.objectStore('sync_queue');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearSyncedEvents(eventIds) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sync_queue'], 'readwrite');
    const store = tx.objectStore('sync_queue');
    for (const id of eventIds) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// -----------------------------------------------------------------------------
// LRU Cache Eviction & Storage Management
// -----------------------------------------------------------------------------
export async function getStorageMetrics() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['regions', 'tiles', 'cached_routes', 'sync_queue'], 'readonly');
    let regionsCount = 0;
    let tilesCount = 0;
    let routesCount = 0;
    let syncCount = 0;

    tx.objectStore('regions').count().onsuccess = (e) => regionsCount = e.target.result;
    tx.objectStore('tiles').count().onsuccess = (e) => tilesCount = e.target.result;
    tx.objectStore('cached_routes').count().onsuccess = (e) => routesCount = e.target.result;
    tx.objectStore('sync_queue').count().onsuccess = (e) => syncCount = e.target.result;

    tx.oncomplete = () => {
      // Approximate storage usage in KB
      const estTilesKb = tilesCount * 18; // approx 18KB per PNG tile
      const estRoutesKb = routesCount * 6; // approx 6KB per route
      const estRegionsKb = regionsCount * 45; // approx 45KB per region graph
      const totalKb = estTilesKb + estRoutesKb + estRegionsKb + (syncCount * 1);

      resolve({
        regionsCount,
        tilesCount,
        routesCount,
        syncCount,
        estimatedTotalKb: totalKb,
        breakdownKb: {
          tiles: estTilesKb,
          routes: estRoutesKb,
          regions: estRegionsKb,
          sync: syncCount
        }
      });
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function purgeLRUCache(maxItemsToKeep = 20) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cached_routes'], 'readwrite');
    const store = tx.objectStore('cached_routes');
    const index = store.index('last_accessed_at');
    const req = index.getAll();

    req.onsuccess = () => {
      const allRoutes = req.result || [];
      if (allRoutes.length > maxItemsToKeep) {
        // Evict oldest items first
        const toEvict = allRoutes.slice(0, allRoutes.length - maxItemsToKeep);
        for (const item of toEvict) {
          store.delete(item.id);
        }
        resolve(toEvict.length);
      } else {
        resolve(0);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllCache() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['tiles', 'cached_routes', 'sync_queue'], 'readwrite');
    tx.objectStore('tiles').clear();
    tx.objectStore('cached_routes').clear();
    tx.objectStore('sync_queue').clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
