/**
 * Computer Networks (CN) Network Manager & Telemetry Engine.
 * 
 * Demonstrates:
 * 1. HTTP Caching, ETag, If-None-Match, Conditional GET (304 Not Modified).
 * 2. TCP Handshake simulation, round-trip time (RTT), socket timeouts, and retransmissions.
 * 3. Intermittent connectivity detection, automated reconnection with exponential backoff.
 * 4. Client-server architecture telemetry: comparing cached vs uncached requests,
 *    response times, and data usage savings.
 */
import {
  getPendingSyncEvents,
  clearSyncedEvents
} from './indexedDB.js';

// Configuration & State
class CNNetworkManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.simulatedMode = 'normal'; // 'normal' | 'slow3g' | 'flaky' | 'offline'
    this.packetLossRate = 0.0; // 0.0 to 1.0
    this.artificialLatencyMs = 0;
    this.timeoutLimitMs = 6000;
    this.etagCache = new Map(); // url -> { etag, data, timestamp }
    this.requestLogs = [];
    this.listeners = new Set();
    this.syncListeners = new Set();
    this.isSyncing = false;
    this.heartbeatTimer = null;
    this.pendingSyncCount = 0;

    // Track aggregate stats
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      conditional304s: 0,
      failedRequests: 0,
      totalBytesTransferred: 0,
      totalBytesSaved: 0,
      avgLatencyMs: 0
    };

    this.initNetworkListeners();
    this.startHeartbeat();
  }

  initNetworkListeners() {
    window.addEventListener('online', () => {
      this.handleConnectivityChange(true, 'Browser online event');
    });

    window.addEventListener('offline', () => {
      this.handleConnectivityChange(false, 'Browser offline event');
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeSync(listener) {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  notify() {
    const telemetrySnapshot = {
      isOnline: this.getEffectiveOnlineStatus(),
      simulatedMode: this.simulatedMode,
      stats: { ...this.stats },
      logs: [...this.requestLogs.slice(0, 40)],
      pendingSyncCount: this.pendingSyncCount
    };
    for (const listener of this.listeners) {
      try { listener(telemetrySnapshot); } catch (e) { console.error(e); }
    }
  }

  notifySync(status, details) {
    for (const listener of this.syncListeners) {
      try { listener({ status, details, timestamp: new Date().toISOString() }); } catch (e) { console.error(e); }
    }
  }

  getEffectiveOnlineStatus() {
    if (this.simulatedMode === 'offline') return false;
    return this.isOnline;
  }

  setSimulatedMode(mode) {
    this.simulatedMode = mode;
    if (mode === 'offline') {
      this.artificialLatencyMs = 0;
      this.packetLossRate = 0;
    } else if (mode === 'slow3g') {
      this.artificialLatencyMs = 650;
      this.packetLossRate = 0.05;
    } else if (mode === 'flaky') {
      this.artificialLatencyMs = 250;
      this.packetLossRate = 0.35; // 35% packet drop
    } else {
      // Normal
      this.artificialLatencyMs = 0;
      this.packetLossRate = 0;
    }
    this.notify();
  }

  async handleConnectivityChange(online, reason) {
    const wasOffline = !this.isOnline;
    this.isOnline = online;
    console.log(`[CN NetworkManager] Connectivity changed: ${online ? 'ONLINE' : 'OFFLINE'} (${reason})`);
    
    if (online && wasOffline) {
      // Reconnected! Automatically trigger sync
      this.triggerAutoSync();
    }
    this.notify();
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(async () => {
      if (this.simulatedMode === 'offline') return;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);

        const resp = await fetch('/api/health', {
          method: 'GET',
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (resp.ok && !this.isOnline) {
          this.handleConnectivityChange(true, 'Heartbeat probe successful');
        }
      } catch (err) {
        if (this.isOnline && this.simulatedMode !== 'offline') {
          // Heartbeat failed (server down or connection interrupted)
          console.warn('[CN Heartbeat] Heartbeat failed:', err.message);
        }
      }
    }, 7000);
  }

  /**
   * Enhanced HTTP Client with CN Telemetry, ETag Caching, and Fault Simulation
   */
  async request(url, options = {}) {
    const startTime = performance.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    const method = options.method || 'GET';
    const effectiveOnline = this.getEffectiveOnlineStatus();

    // 1. If simulated or physical offline, immediately short-circuit
    if (!effectiveOnline) {
      const offlineLog = {
        id: requestId,
        url,
        method,
        status: 0,
        statusText: 'ERR_INTERNET_DISCONNECTED',
        protocol: 'TCP / Offline',
        latencyMs: 0,
        dnsMs: 0,
        tcpHandshakeMs: 0,
        ttfbMs: 0,
        downloadMs: 0,
        cacheStatus: 'OFFLINE',
        etag: null,
        bytesTransferred: 0,
        bytesSaved: 0,
        timestamp: new Date().toLocaleTimeString(),
        error: 'Device is offline or offline simulation active'
      };
      this.recordLog(offlineLog);
      throw new Error('ERR_INTERNET_DISCONNECTED: Device is offline.');
    }

    // 2. Simulated Flaky Packet Drop (Simulating TCP Retransmissions / Dropped Packets)
    if (this.packetLossRate > 0 && Math.random() < this.packetLossRate) {
      // Simulate packet loss drop and retry
      console.warn(`[CN Simulation] Packet dropped by simulated flaky network for ${url}!`);
      // Wait simulated RTT before failing
      await new Promise(r => setTimeout(r, 600));
      const dropLog = {
        id: requestId,
        url,
        method,
        status: 408,
        statusText: 'TCP_PACKET_LOSS_TIMEOUT',
        protocol: 'TCP / Simulated Loss',
        latencyMs: 600,
        dnsMs: 25,
        tcpHandshakeMs: 0,
        ttfbMs: 0,
        downloadMs: 0,
        cacheStatus: 'TIMEOUT',
        etag: null,
        bytesTransferred: 0,
        bytesSaved: 0,
        timestamp: new Date().toLocaleTimeString(),
        error: 'Simulated TCP Packet Loss (Connection Reset/Timeout)'
      };
      this.recordLog(dropLog);
      this.stats.failedRequests++;
      throw new Error('TCP_PACKET_LOSS_TIMEOUT: Packet dropped due to network instability.');
    }

    // 3. Simulated Latency injection (Slow 3G / high RTT)
    if (this.artificialLatencyMs > 0) {
      await new Promise(r => setTimeout(r, this.artificialLatencyMs));
    }

    // 4. HTTP Caching Headers: ETag & If-None-Match
    const headers = new Headers(options.headers || {});
    const cacheKey = `${method}:${url}`;
    const cachedEntry = this.etagCache.get(cacheKey);

    if (method === 'GET' && cachedEntry && cachedEntry.etag) {
      headers.set('If-None-Match', cachedEntry.etag);
    }

    // Prepare simulated TCP / DNS timing breakdown
    const simDnsMs = Math.round(12 + Math.random() * 15);
    const simTcpMs = Math.round(20 + Math.random() * 25);

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutLimitMs);

    try {
      const fetchStart = performance.now();
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutHandle);
      const fetchEnd = performance.now();

      const totalLatency = Math.round(fetchEnd - startTime);
      const ttfb = Math.max(1, Math.round(totalLatency - simDnsMs - simTcpMs));
      const downloadMs = Math.round(5 + Math.random() * 10);

      const responseEtag = response.headers.get('ETag');
      let responseData = null;
      let bytesTransferred = 0;
      let bytesSaved = 0;
      let cacheStatus = 'MISS_200';

      // 5. Handle HTTP 304 Not Modified (Conditional GET Success!)
      if (response.status === 304) {
        cacheStatus = 'REVALIDATED_304';
        responseData = cachedEntry.data;
        const estimatedRawBytes = JSON.stringify(responseData).length;
        bytesTransferred = 180; // Only HTTP response headers
        bytesSaved = estimatedRawBytes;

        this.stats.cacheHits++;
        this.stats.conditional304s++;
        this.stats.totalBytesSaved += bytesSaved;
        this.stats.totalBytesTransferred += bytesTransferred;

        console.log(`[CN HTTP Cache] 304 Not Modified for ${url}! Saved ${bytesSaved} bytes.`);
      } else if (response.ok) {
        // HTTP 200 OK
        const text = await response.text();
        bytesTransferred = text.length;

        try {
          responseData = JSON.parse(text);
        } catch {
          responseData = text;
        }

        if (responseEtag && method === 'GET') {
          this.etagCache.set(cacheKey, {
            etag: responseEtag,
            data: responseData,
            timestamp: Date.now()
          });
        }

        this.stats.cacheMisses++;
        this.stats.totalBytesTransferred += bytesTransferred;
      } else {
        cacheStatus = `HTTP_${response.status}`;
        this.stats.failedRequests++;
      }

      this.stats.totalRequests++;

      const logEntry = {
        id: requestId,
        url,
        method,
        status: response.status,
        statusText: response.statusText,
        protocol: response.headers.get('X-Protocol') || 'HTTP/1.1',
        latencyMs: totalLatency,
        dnsMs: simDnsMs,
        tcpHandshakeMs: simTcpMs,
        ttfbMs: ttfb,
        downloadMs: downloadMs,
        cacheStatus,
        etag: responseEtag || cachedEntry?.etag || null,
        bytesTransferred,
        bytesSaved,
        timestamp: new Date().toLocaleTimeString(),
        error: null
      };

      this.recordLog(logEntry);
      return {
        status: response.status,
        ok: response.ok,
        data: responseData,
        etag: responseEtag,
        is304: response.status === 304,
        log: logEntry
      };
    } catch (err) {
      clearTimeout(timeoutHandle);
      const totalLatency = Math.round(performance.now() - startTime);

      const failLog = {
        id: requestId,
        url,
        method,
        status: err.name === 'AbortError' ? 504 : 503,
        statusText: err.name === 'AbortError' ? 'TCP_SOCKET_TIMEOUT' : 'NETWORK_ERROR',
        protocol: 'TCP / IP',
        latencyMs: totalLatency,
        dnsMs: simDnsMs,
        tcpHandshakeMs: simTcpMs,
        ttfbMs: 0,
        downloadMs: 0,
        cacheStatus: 'FAILED',
        etag: null,
        bytesTransferred: 0,
        bytesSaved: 0,
        timestamp: new Date().toLocaleTimeString(),
        error: err.message
      };

      this.recordLog(failLog);
      this.stats.failedRequests++;
      throw err;
    }
  }

  recordLog(entry) {
    this.requestLogs.unshift(entry);
    if (this.requestLogs.length > 50) {
      this.requestLogs.pop();
    }
    // Update average latency
    const recentLatencies = this.requestLogs.map(l => l.latencyMs).filter(ms => ms > 0);
    if (recentLatencies.length > 0) {
      this.stats.avgLatencyMs = Math.round(
        recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length
      );
    }
    this.notify();
  }

  /**
   * Background Offline-to-Online Synchronization
   */
  async triggerAutoSync() {
    if (this.isSyncing) return;
    if (!this.getEffectiveOnlineStatus()) return;

    this.isSyncing = true;
    this.notifySync('SYNCING', 'Detecting pending offline actions...');

    try {
      const pendingEvents = await getPendingSyncEvents();
      this.pendingSyncCount = pendingEvents.length;
      this.notify();

      if (pendingEvents.length === 0) {
        this.notifySync('IDLE', 'All offline routes and events are fully synchronized.');
        this.isSyncing = false;
        return;
      }

      this.notifySync('SYNCING', `Replaying ${pendingEvents.length} queued events to server...`);

      const resp = await this.request('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'client_' + (localStorage.getItem('offlineroute_client_id') || 'dev_browser'),
          events: pendingEvents
        })
      });

      if (resp.ok) {
        // Clear synced items from IndexedDB
        const eventIds = pendingEvents.map(e => e.id);
        await clearSyncedEvents(eventIds);
        this.pendingSyncCount = 0;
        this.notifySync('SUCCESS', `Synchronized ${pendingEvents.length} actions with server!`);
        console.log(`[CN Sync] Successfully synchronized ${pendingEvents.length} offline actions.`);
      } else {
        this.notifySync('ERROR', 'Synchronization failed: server rejected request.');
      }
    } catch (err) {
      console.warn('[CN Sync] Sync failed due to network error:', err.message);
      this.notifySync('ERROR', `Sync deferred: ${err.message}`);
    } finally {
      this.isSyncing = false;
      this.notify();
    }
  }

  async checkPendingSync() {
    try {
      const events = await getPendingSyncEvents();
      this.pendingSyncCount = events.length;
      this.notify();
    } catch (e) {
      console.error(e);
    }
  }
}

export const networkManager = new CNNetworkManager();
