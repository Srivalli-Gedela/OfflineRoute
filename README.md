# OfflineRoute – Hybrid Offline Navigation System

A full-stack Computer Networks project demonstrating **HTTP caching, TCP transport behavior, intermittent connectivity resilience, offline edge computing, and automatic client-server synchronization** in a production-grade navigation application.

---

## 🌟 Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, Vite, Leaflet, OpenStreetMap, Lucide React, Tailwind CSS |
| **Client Offline Storage** | Native **IndexedDB** (`OfflineRouteDB`: road graphs, map tiles, cached routes, sync queue, LRU cache) |
| **Backend** | Flask (Python 3.11), RESTful APIs, HTTP Caching Headers (RFC 7232) |
| **Database** | SQLite (`offlineroute.db`: regions, route history, sync events, telemetry) |
| **Pathfinding Engines** | **Server:** OSRM-compatible A* engine; **Client (Offline):** In-browser JavaScript A* & Dijkstra graph solver |

---

## 🚀 Key Features

### 1. Interactive Map & Navigation
- Real-time map rendering using Leaflet and OpenStreetMap tiles.
- GPS "Locate Me" button with HTML5 Geolocation and simulated region fallback.
- Destination search with autocomplete across landmarks, transit hubs, and POIs.
- Interactive map-click selection to set Origin (A) and Destination (B).
- Driving, Cycling, and Walking transport modes with custom speed models.
- Turn-by-turn navigation instructions with bearings, street names, step distances, and direction icons.

### 2. Downloadable Geographical Road Networks
- Download complete vector road network graphs (nodes, edges, speed limits, street names) for:
  - **San Francisco Downtown & Waterfront** (Ferry Building, Union Square, Pier 39, Moscone Center)
  - **New York Manhattan Midtown** (Times Square, Grand Central, Empire State, Central Park)
  - **Central London & Westminster** (Big Ben, London Eye, Trafalgar Square, Covent Garden)
  - **Bengaluru Central Business District** (MG Road, Indiranagar 100ft Rd, EGL Tech Park)
- Pre-caches map tiles at zooms 13, 14, and 15 into IndexedDB for 100% offline visual map rendering.

### 3. Client-Side Offline Routing (No Internet Required)
- **Cache-First:** Checks IndexedDB `cached_routes` for matching routes (0ms retrieval).
- **Local A\* Engine:** If not cached, runs client-side A\* pathfinding directly in JavaScript using the downloaded road network stored in IndexedDB.
- **Coverage Boundary Check:** Accurately tests if coordinates are within downloaded bounding boxes. Clearly indicates when a destination is outside offline coverage.

### 4. Smart Cache Management (LRU & Storage Limits)
- Least Recently Used (LRU) tracking with `last_accessed_at` and `hits` counters.
- Visual storage meter breaking down Map Tiles, Regional Graphs, and Cached Routes.
- One-click LRU cleanup button (evicts oldest entries beyond limit) and cache purge.

### 5. Automatic Reconnection & Offline-to-Online Synchronization
- Background listener detects transitions between online and offline states.
- Active heartbeat probe pinging `/api/health` with TCP socket timeout handling.
- Queues offline route calculations and user actions into IndexedDB `sync_queue`.
- Replays queued events to the server upon reconnection, achieving eventual consistency.

---

## 🌐 Computer Networks Concepts Demonstrated

### 1. HTTP Caching & Conditional GET (RFC 7232)
- **ETag Generation:** Server computes MD5 entity tags for regions, routes, and search results.
- **`If-None-Match` Header:** The client transmits the stored ETag on subsequent queries.
- **HTTP 304 Not Modified:** The server returns 304 with an empty body if the resource is unchanged, saving over **98% of payload bandwidth**.
- **Telemetry:** Visualizes exact bytes transferred vs bytes saved via 304 revalidations.

### 2. TCP Transport, Latency & Intermittent Connectivity
- **Timing Breakdown:** Measures simulated DNS resolution, TCP 3-way handshake (SYN, SYN-ACK, ACK), Time to First Byte (TTFB), and Content Download times.
- **Network Fault Simulator:**
  - **Normal:** Low RTT broadband.
  - **Slow 3G / Satellite:** +650ms artificial RTT delay.
  - **Flaky Network:** 35% packet drop rate, demonstrating TCP timeout and automatic retry.
  - **Offline Mode:** Simulates complete disconnection (`ERR_INTERNET_DISCONNECTED`).

### 3. Edge-First vs Centralized Client-Server Architecture
- Demonstrates how hybrid offline architectures move computation to the edge (in-browser JavaScript A\* pathfinding) when server availability is degraded or absent.

---

## 📂 Project Structure

```
offlineroute/
├── backend/
│   ├── app.py                # Flask server, REST APIs, HTTP caching (ETags, 304), sync
│   ├── database.py           # SQLite connection and schema (regions, routes, sync)
│   ├── road_network.py       # Graph representations, A*, Dijkstra, datasets (SF, NYC, London, BLR)
│   ├── seed_data.py          # Database seeder for regions and sample routes
│   ├── test_backend.py       # Test suite for backend caching, routing & sync
│   └── requirements.txt      # Python dependencies (Flask, requests)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── MapViewer.jsx        # Leaflet map with offline IndexedDB tile layer
│   │   │   ├── RoutePanel.jsx       # Route calculation, search, mode switcher, presets
│   │   │   ├── TurnByTurn.jsx       # Navigation steps and direction icons
│   │   │   ├── RegionManager.jsx    # Download regions, storage meter, LRU eviction
│   │   │   ├── SavedRoutes.jsx      # Cached route history & quick loading
│   │   │   ├── CNDashboard.jsx      # CN telemetry inspector, comparison charts, protocol docs
│   │   │   └── SyncIndicator.jsx    # Network status pill and reconnection sync
│   │   ├── services/
│   │   │   ├── indexedDB.js         # Native IndexedDB client storage wrapper
│   │   │   ├── offlineRouter.js     # Client-side A* pathfinding & turn-by-turn generator
│   │   │   └── cnNetworkManager.js  # Telemetry fetch client, ETag cache, network simulator
│   │   ├── App.jsx                  # Main application container
│   │   ├── main.jsx                 # React root
│   │   └── index.css                # Custom map pins, scrollbar, leaflet styles
│   ├── test_offline_router.js       # Node.js test script for client routing
│   ├── index.html                   # HTML entry with Tailwind CSS CDN
│   ├── vite.config.js               # Vite config with backend proxy
│   └── package.json                 # Node dependencies
├── run_app.py                       # Universal one-click full-stack launcher
├── start.bat                        # Windows CMD launcher
├── start.ps1                        # PowerShell launcher
└── README.md                        # Documentation & CN concepts guide
```

---

## 🛠️ Setup & Running

### Prerequisites
- Python 3.9+
- Node.js 18+ and npm

### Quick Start (Unified Mode)
Run the application with a single command from the project root:

```bash
python run_app.py
```
*This automatically builds the frontend, seeds the SQLite database, starts the Flask server, and opens your browser at `http://127.0.0.1:5000`.*

### Running Frontend and Backend Separately (Development Mode)

#### 1. Backend Server
```bash
cd backend
python seed_data.py
python app.py
```
*Backend runs on `http://127.0.0.1:5000`.*

#### 2. Frontend Dev Server (Vite)
```bash
cd frontend
npm install
npm run dev
```
*Frontend runs on `http://localhost:3000` with hot module reloading and proxies API calls to port 5000.*

---

## 🧪 Testing Verification

Both frontend and backend include automated test suites:

### 1. Backend API & HTTP Caching Test
```bash
cd backend
python test_backend.py
```
*Verifies health check, HTTP 200 vs 304 Conditional GET, ETag matching, online route calculation, and offline sync endpoint.*

### 2. Client-Side Offline Pathfinding Test
```bash
cd frontend
node test_offline_router.js
```
*Verifies Haversine distance, bearing calculations, spatial snapping to intersections, A\* shortest path routing, and bounding box coverage boundaries.*

---

## ✅ Completion Checklist

- [x] **Interactive map with GPS location and destination search**
- [x] **Download geographical regions with actual road-network data (nodes, edges, speeds)**
- [x] **Cache previously searched routes, map tiles and frequently visited destinations**
- [x] **Automatic connectivity detection and seamless switching between online and offline modes**
- [x] **Offline routing using cached routes first; otherwise calculating new routes using locally stored road data and A\***
- [x] **Support new destinations and rerouting within downloaded regions**
- [x] **Clearly indicate destinations outside offline coverage**
- [x] **Automatically synchronize maps and routes when internet returns**
- [x] **HTTP caching, ETag, Conditional GET (304), TCP communication, timeouts and reconnection handling**
- [x] **Smart cache management using LRU and storage limits**
- [x] **Display connectivity status, downloaded regions, saved routes, distance and travel time**
- [x] **CN Focus: Demonstrate HTTP, TCP, DNS, client-server vs edge architecture, caching comparison, response times, and data usage savings**
- [x] **Modern, responsive, user-friendly interface**
- [x] **Tested every feature with automated test suites**
