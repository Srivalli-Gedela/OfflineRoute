"""
OfflineRoute Flask Backend
Demonstrating HTTP Caching (ETag, Conditional GET 304), TCP Latency & Reconnection,
Offline-to-Online Synchronization, and Road Network Routing.
"""
import time
import json
import math
import os
import hashlib
from datetime import datetime
from flask import Flask, request, jsonify, Response, make_response, send_from_directory
from database import get_db, compute_etag, init_db
from road_network import ALL_REGIONS, snap_to_nearest_node, get_region_graph, build_osm_road_network, haversine_distance_meters

FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))

app = Flask(__name__, static_folder=FRONTEND_DIST, static_url_path="")

# Ensure tables are ready on startup
init_db()

# ------------------------------------------------------------------------------
# CORS & CN Network Inspection Middleware
# ------------------------------------------------------------------------------
@app.before_request
def start_timer():
    request.start_time = time.time()
    # Check for simulated network conditions
    simulated_delay = request.args.get("delay_ms", type=int) or int(request.headers.get("X-Simulated-Latency", 0))
    if simulated_delay > 0:
        # Cap delay to 10 seconds max for testing safety
        time.sleep(min(simulated_delay, 10000) / 1000.0)

    # Simulated error conditions for CN resilience testing
    sim_error = request.args.get("simulate_error", type=int)
    if sim_error in (500, 502, 503, 504):
        resp = jsonify({
            "error": f"Simulated HTTP {sim_error} Network Error",
            "protocol": "HTTP/1.1",
            "demonstrating": "TCP timeout and server failure handling"
        })
        resp.status_code = sim_error
        return resp

@app.after_request
def add_cors_and_cn_headers(response: Response):
    # Standard CORS Headers
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = (
        "Content-Type, If-None-Match, If-Modified-Since, X-Client-Id, "
        "X-Simulated-Latency, X-Simulated-Drop, Cache-Control"
    )
    response.headers["Access-Control-Expose-Headers"] = (
        "ETag, Cache-Control, Last-Modified, X-Response-Time, "
        "X-Cache-Status, X-Protocol, X-Data-Transfer-Saved, Content-Length"
    )

    # Computer Networks Diagnostic Headers
    duration_ms = round((time.time() - getattr(request, "start_time", time.time())) * 1000, 2)
    response.headers["X-Response-Time"] = f"{duration_ms}ms"
    response.headers["X-Protocol"] = request.environ.get("SERVER_PROTOCOL", "HTTP/1.1")
    return response

# Handle pre-flight CORS requests
@app.route("/", defaults={"path": ""}, methods=["OPTIONS"])
@app.route("/<path:path>", methods=["OPTIONS"])
def handle_options(path):
    resp = make_response("", 204)
    return resp

# ------------------------------------------------------------------------------
# CN Heartbeat & Health Check
# ------------------------------------------------------------------------------
@app.route("/api/health", methods=["GET"])
@app.route("/api/ping", methods=["GET"])
def health_check():
    """TCP / HTTP Heartbeat ping to detect connectivity state."""
    return jsonify({
        "status": "online",
        "service": "OfflineRoute Backend",
        "timestamp": datetime.utcnow().isoformat(),
        "protocol": request.environ.get("SERVER_PROTOCOL", "HTTP/1.1")
    })

# ------------------------------------------------------------------------------
# Regions API (with HTTP ETag & Conditional GET 304)
# ------------------------------------------------------------------------------
@app.route("/api/regions", methods=["GET"])
def get_regions():
    """
    Returns list of downloadable regions.
    Demonstrates HTTP Conditional GET: Returns 304 Not Modified if ETag matches!
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, name, city, country, description,
           bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon,
           center_lat, center_lon, default_zoom,
           node_count, edge_count, size_kb, etag, version, updated_at
    FROM regions
    ORDER BY name ASC
    """)
    rows = cursor.fetchall()
    conn.close()

    regions_list = [dict(row) for row in rows]
    payload_str = json.dumps(regions_list, sort_keys=True)
    collection_etag = compute_etag(payload_str)

    # Check client's If-None-Match header
    client_etag = request.headers.get("If-None-Match")
    if client_etag and client_etag.strip() == collection_etag:
        # HTTP 304 Not Modified! Saves payload bandwidth!
        resp = Response("", status=304)
        resp.headers["ETag"] = collection_etag
        resp.headers["Cache-Control"] = "public, max-age=3600, must-revalidate"
        resp.headers["X-Cache-Status"] = "REVALIDATED_304"
        resp.headers["X-Data-Transfer-Saved"] = f"{len(payload_str.encode('utf-8'))} bytes"
        return resp

    # HTTP 200 OK with ETag
    resp = Response(payload_str, status=200, mimetype="application/json")
    resp.headers["ETag"] = collection_etag
    resp.headers["Cache-Control"] = "public, max-age=3600, must-revalidate"
    resp.headers["X-Cache-Status"] = "MISS_200"
    return resp

@app.route("/api/regions/<region_id>", methods=["GET"])
def get_region_road_network(region_id):
    """
    Downloads full regional road network graph for client-side offline routing.
    Supports HTTP Conditional GET (ETag).
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM regions WHERE id = ?", (region_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({"error": f"Region '{region_id}' not found."}), 404

    region_etag = row["etag"]
    client_etag = request.headers.get("If-None-Match")
    
    if client_etag and client_etag.strip() == region_etag:
        # Client already has the exact road network in IndexedDB!
        resp = Response("", status=304)
        resp.headers["ETag"] = region_etag
        resp.headers["Cache-Control"] = "public, max-age=86400, must-revalidate"
        resp.headers["X-Cache-Status"] = "REVALIDATED_304"
        resp.headers["X-Data-Transfer-Saved"] = f"{row['size_kb']} KB"
        return resp

    network_dict = json.loads(row["road_network_json"])
    destinations_list = json.loads(row["destinations_json"])
    
    response_data = {
        "region_id": row["id"],
        "name": row["name"],
        "city": row["city"],
        "country": row["country"],
        "description": row["description"],
        "bbox": {
            "min_lat": row["bbox_min_lat"],
            "min_lon": row["bbox_min_lon"],
            "max_lat": row["bbox_max_lat"],
            "max_lon": row["bbox_max_lon"]
        },
        "center": {
            "lat": row["center_lat"],
            "lon": row["center_lon"]
        },
        "default_zoom": row["default_zoom"],
        "node_count": row["node_count"],
        "edge_count": row["edge_count"],
        "size_kb": row["size_kb"],
        "version": row["version"],
        "etag": row["etag"],
        "updated_at": row["updated_at"],
        "road_network": network_dict,
        "destinations": destinations_list
    }

    payload_str = json.dumps(response_data)
    resp = Response(payload_str, status=200, mimetype="application/json")
    resp.headers["ETag"] = region_etag
    resp.headers["Cache-Control"] = "public, max-age=86400, must-revalidate"
    resp.headers["X-Cache-Status"] = "MISS_200"
    return resp

# ------------------------------------------------------------------------------
# Region Tile Manifest (for client-side offline tile pre-caching)
# ------------------------------------------------------------------------------
def latlon_to_tile(lat: float, lon: float, zoom: int):
    """Converts WGS84 GPS coordinate to OSM tile x, y."""
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    xtile = int((lon + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

@app.route("/api/regions/<region_id>/tiles-manifest", methods=["GET"])
def get_tiles_manifest(region_id):
    """
    Generates a list of map tile coordinate keys (z/x/y) covering the region bounding box.
    Enables client to pre-cache map tiles into IndexedDB for offline viewing.
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon FROM regions WHERE id = ?", (region_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({"error": "Region not found"}), 404

    min_lat, min_lon = row["bbox_min_lat"], row["bbox_min_lon"]
    max_lat, max_lon = row["bbox_max_lat"], row["bbox_max_lon"]

    tiles = []
    # Generate tiles for zooms 13, 14, 15
    for z in [13, 14, 15]:
        x1, y1 = latlon_to_tile(max_lat, min_lon, z)  # Top-left
        x2, y2 = latlon_to_tile(min_lat, max_lon, z)  # Bottom-right
        for x in range(min(x1, x2), max(x1, x2) + 1):
            for y in range(min(y1, y2), max(y1, y2) + 1):
                tiles.append({
                    "z": z,
                    "x": x,
                    "y": y,
                    "url": f"https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                })

    return jsonify({
        "region_id": region_id,
        "zoom_levels": [13, 14, 15],
        "total_tiles": len(tiles),
        "tiles": tiles[:150]  # Cap to first 150 tiles for snappy pre-caching
    })

# ------------------------------------------------------------------------------
# Routing API (Online Route Calculation with Server Cache)
# ------------------------------------------------------------------------------
def find_enclosing_region(lat: float, lon: float):
    """Finds which downloaded/stored region contains this coordinate."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, name, bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon
    FROM regions
    """)
    rows = cursor.fetchall()
    conn.close()

    for r in rows:
        if (r["bbox_min_lat"] <= lat <= r["bbox_max_lat"] and
            r["bbox_min_lon"] <= lon <= r["bbox_max_lon"]):
            return r["id"]
    return None

def route_via_osrm(origin_lat: float, origin_lon: float, dest_lat: float, dest_lon: float, mode: str = "driving"):
    """Fetches real-world driving/walking/cycling route from public OSRM."""
    import requests
    osrm_mode = "driving" if mode == "driving" else ("bike" if mode == "cycling" else "foot")
    url = f"https://router.project-osrm.org/route/v1/{osrm_mode}/{origin_lon:.5f},{origin_lat:.5f};{dest_lon:.5f},{dest_lat:.5f}?overview=full&geometries=geojson&steps=true"
    headers = {"User-Agent": "OfflineRouteApp/1.0"}
    try:
        r = requests.get(url, headers=headers, timeout=8)
        if r.status_code != 200:
            return None
        data = r.json()
        if not data.get("routes"):
            return None
        route = data["routes"][0]
        distance_km = round(route["distance"] / 1000.0, 2)
        duration_min = round(route["duration"] / 60.0, 1)
        geometry = route["geometry"]
        steps = []
        legs = route.get("legs", [])
        if legs and "steps" in legs[0]:
            for i, s in enumerate(legs[0]["steps"]):
                steps.append({
                    "step_index": i + 1,
                    "street": s.get("name") or "Road",
                    "instruction": s.get("maneuver", {}).get("instruction") or f"Head on {s.get('name') or 'road'}",
                    "modifier": s.get("maneuver", {}).get("modifier", "straight"),
                    "distance_m": round(s.get("distance", 0)),
                    "duration_sec": round(s.get("duration", 0)),
                    "location": s.get("maneuver", {}).get("location", [0, 0])
                })
        return {
            "distance_km": distance_km,
            "duration_min": duration_min,
            "geometry": geometry,
            "steps": steps,
            "path_nodes": [f"step_{i}" for i in range(len(steps))]
        }
    except Exception as ex:
        print("[OSRM Route] Live routing warning:", ex)
        return None

@app.route("/api/route", methods=["POST"])
def calculate_route():
    """
    Online Route Calculation endpoint.
    1. Checks if route is already cached on server in SQLite.
    2. Supports ETag conditional validation.
    3. Computes shortest path using local graph A* or OSRM live routing engine.
    4. Caches result in SQLite with ETag.
    """
    data = request.get_json() or {}
    origin = data.get("origin")
    dest = data.get("destination")
    mode = data.get("mode", "driving")

    if not origin or not dest:
        return jsonify({"error": "Missing 'origin' or 'destination' in request body."}), 400

    origin_lat = float(origin.get("lat"))
    origin_lon = float(origin.get("lon"))
    dest_lat = float(dest.get("lat"))
    dest_lon = float(dest.get("lon"))

    # Haversine straight-line distance between origin and destination
    straight_dist_km = haversine_distance_meters(origin_lat, origin_lon, dest_lat, dest_lon) / 1000.0

    # Determine region: both endpoints must be covered by or snap to the same region
    orig_region = find_enclosing_region(origin_lat, origin_lon)
    dest_region = find_enclosing_region(dest_lat, dest_lon)
    region_id = data.get("region_id")
    if not region_id:
        if orig_region and dest_region and orig_region == dest_region:
            region_id = orig_region
        else:
            candidate = orig_region or dest_region
            if candidate:
                cand_graph = get_region_graph(candidate)
                if cand_graph and cand_graph.nodes:
                    s_id, s_dist = snap_to_nearest_node(origin_lat, origin_lon, cand_graph.nodes)
                    e_id, e_dist = snap_to_nearest_node(dest_lat, dest_lon, cand_graph.nodes)
                    if s_id and e_id and s_dist < 4000 and e_dist < 4000:
                        region_id = candidate

    route_key = f"{origin_lat:.4f}_{origin_lon:.4f}_{dest_lat:.4f}_{dest_lon:.4f}_{mode}"
    route_id = f"route_{hashlib.md5(route_key.encode('utf-8')).hexdigest()[:16]}"

    # Check server-side route cache in SQLite
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM routes WHERE id = ?", (route_id,))
    cached = cursor.fetchone()

    client_etag = request.headers.get("If-None-Match")
    if cached:
        c_orig_lat = float(cached["origin_lat"])
        c_orig_lon = float(cached["origin_lon"])
        c_dest_lat = float(cached["dest_lat"])
        c_dest_lon = float(cached["dest_lon"])
        c_dist_km = float(cached["distance_km"])

        # Strictly validate cache integrity: matching coords, matching mode, and physically plausible distance
        is_cache_valid = (
            abs(c_orig_lat - origin_lat) < 0.002 and
            abs(c_orig_lon - origin_lon) < 0.002 and
            abs(c_dest_lat - dest_lat) < 0.002 and
            abs(c_dest_lon - dest_lon) < 0.002 and
            cached["mode"] == mode and
            c_dist_km >= (straight_dist_km * 0.65)
        )

        if not is_cache_valid:
            cursor.execute("DELETE FROM routes WHERE id = ?", (route_id,))
            conn.commit()
            cached = None
        else:
            # Update hit count
            cursor.execute("UPDATE routes SET hits = hits + 1, last_accessed_at = ? WHERE id = ?",
                           (datetime.utcnow().isoformat(), route_id))
            conn.commit()

            if client_etag and client_etag.strip() == cached["etag"]:
                conn.close()
                resp = Response("", status=304)
                resp.headers["ETag"] = cached["etag"]
                resp.headers["Cache-Control"] = "public, max-age=1800"
                resp.headers["X-Cache-Status"] = "REVALIDATED_304"
                resp.headers["X-Routing-Engine"] = "Server Cache (SQLite LRU)"
                return resp

            # Return cached route
            route_payload = {
                "route_id": cached["id"],
                "region_id": region_id or "global",
                "origin": {"name": cached["origin_name"], "lat": cached["origin_lat"], "lon": cached["origin_lon"]},
                "destination": {"name": cached["dest_name"], "lat": cached["dest_lat"], "lon": cached["dest_lon"]},
                "mode": cached["mode"],
                "distance_km": cached["distance_km"],
                "duration_min": cached["duration_min"],
                "geometry": json.loads(cached["geometry_geojson"]),
                "steps": json.loads(cached["steps_json"]),
                "etag": cached["etag"],
                "routing_engine": "Server-side SQLite Cache (0ms calc time)",
                "cache_status": "HIT"
            }
            conn.close()
            resp = Response(json.dumps(route_payload), status=200, mimetype="application/json")
            resp.headers["ETag"] = cached["etag"]
            resp.headers["Cache-Control"] = "public, max-age=1800"
            resp.headers["X-Cache-Status"] = "HIT_200"
            resp.headers["X-Routing-Engine"] = "Server Cache"
            return resp

    # Try local graph if region exists
    route_result = None
    engine_name = "Server OSRM-Compatible A* Graph Solver"
    if region_id:
        graph = get_region_graph(region_id)
        if graph and graph.nodes:
            start_node_id, start_dist = snap_to_nearest_node(origin_lat, origin_lon, graph.nodes)
            end_node_id, end_dist = snap_to_nearest_node(dest_lat, dest_lon, graph.nodes)
            if start_node_id and end_node_id and start_dist < 4000 and end_dist < 4000:
                route_result = graph.route_a_star(start_node_id, end_node_id, mode, origin=origin, dest=dest)

    # Fallback to OSRM live routing API for any global coordinates
    if not route_result:
        osrm_res = route_via_osrm(origin_lat, origin_lon, dest_lat, dest_lon, mode)
        if osrm_res:
            route_result = osrm_res
            engine_name = "OSRM Live Routing Engine"

    if not route_result:
        conn.close()
        return jsonify({
            "error": "No connected road path found between the specified points."
        }), 404

    # Sanity check: Ensure road distance is plausible compared to straight-line distance
    if route_result["distance_km"] < (straight_dist_km * 0.65):
        conn.close()
        return jsonify({
            "error": "Routing calculation produced an invalid or mismatched distance."
        }), 500

    origin_name = origin.get("name") or "Origin"
    dest_name = dest.get("name") or "Destination"
    
    # Ensure route coordinates seamlessly connect from origin point to destination point
    raw_geom = route_result.get("geometry")
    raw_coords = (raw_geom.get("coordinates") if isinstance(raw_geom, dict) else None) or route_result.get("coordinates") or []
    if raw_coords and len(raw_coords) > 0:
        if haversine_distance_meters(origin_lat, origin_lon, raw_coords[0][1], raw_coords[0][0]) > 2.0:
            raw_coords.insert(0, [origin_lon, origin_lat])
        if haversine_distance_meters(raw_coords[-1][1], raw_coords[-1][0], dest_lat, dest_lon) > 2.0:
            raw_coords.append([dest_lon, dest_lat])
    geometry = {"type": "LineString", "coordinates": raw_coords}
    now_str = datetime.utcnow().isoformat()

    route_payload = {
        "route_id": route_id,
        "region_id": region_id or "global",
        "origin": {"name": origin_name, "lat": origin_lat, "lon": origin_lon},
        "destination": {"name": dest_name, "lat": dest_lat, "lon": dest_lon},
        "mode": mode,
        "distance_km": route_result["distance_km"],
        "duration_min": route_result["duration_min"],
        "geometry": geometry,
        "steps": route_result["steps"],
        "path_nodes": route_result.get("path_nodes", []),
        "routing_engine": engine_name,
        "cache_status": "MISS"
    }

    payload_str = json.dumps(route_payload)
    route_etag = compute_etag(payload_str)
    route_payload["etag"] = route_etag

    # Insert into SQLite routes table
    cursor.execute("""
    INSERT OR REPLACE INTO routes (
        id, origin_name, origin_lat, origin_lon,
        dest_name, dest_lat, dest_lon, mode,
        distance_km, duration_min, geometry_geojson, steps_json,
        etag, hits, created_at, last_accessed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        route_id,
        origin_name, origin_lat, origin_lon,
        dest_name, dest_lat, dest_lon, mode,
        route_result["distance_km"], route_result["duration_min"],
        json.dumps(geometry), json.dumps(route_result["steps"]),
        route_etag, 1, now_str, now_str
    ))
    conn.commit()
    conn.close()

    resp = Response(json.dumps(route_payload), status=200, mimetype="application/json")
    resp.headers["ETag"] = route_etag
    resp.headers["Cache-Control"] = "public, max-age=1800"
    resp.headers["X-Cache-Status"] = "MISS_200"
    resp.headers["X-Routing-Engine"] = engine_name
    return resp

# ------------------------------------------------------------------------------
# Search & Autocomplete API (Local DB + OpenStreetMap Nominatim)
# ------------------------------------------------------------------------------
@app.route("/api/search", methods=["GET"])
def search_destinations():
    """
    Searches landmarks, railway stations, universities, and POIs dynamically
    using OpenStreetMap Nominatim geocoding combined with local database entries.
    """
    query = request.args.get("q", "").strip()
    region_id = request.args.get("region_id")

    if not query or len(query) < 2:
        return jsonify([])

    results = []

    # 1. Dynamic OpenStreetMap Nominatim Geocoding (Priority for real-world landmarks, stations, colleges)
    try:
        import requests
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": query,
                "format": "json",
                "addressdetails": 1,
                "limit": 8
            },
            headers={"User-Agent": "OfflineRouteApp/1.0"},
            timeout=4.0
        )
        if resp.status_code == 200:
            for item in resp.json():
                display_name = item.get("display_name", "")
                name = item.get("name") or display_name.split(",")[0].strip()
                cat = (item.get("type") or item.get("class") or "Location").replace("_", " ").title()
                addr = item.get("address", {})
                region_name = addr.get("city") or addr.get("town") or addr.get("state") or addr.get("country") or "Global"

                if not any(r["name"].lower() == name.lower() for r in results):
                    results.append({
                        "id": f"osm_{item.get('place_id') or item.get('osm_id')}",
                        "name": name,
                        "display_name": display_name,
                        "category": cat,
                        "lat": float(item["lat"]),
                        "lon": float(item["lon"]),
                        "region_name": region_name,
                        "is_osm": True
                    })
    except Exception as ex:
        print("[Search] Nominatim geocode warning:", ex)

    # 2. Local SQLite destinations table
    try:
        conn = get_db()
        cursor = conn.cursor()
        if region_id:
            cursor.execute("""
            SELECT d.id, d.name, d.category, d.lat, d.lon, d.popularity, r.name as region_name, r.id as region_id
            FROM destinations d
            JOIN regions r ON d.region_id = r.id
            WHERE d.region_id = ? AND d.name LIKE ?
            ORDER BY d.popularity DESC LIMIT 6
            """, (region_id, f"%{query}%"))
        else:
            cursor.execute("""
            SELECT d.id, d.name, d.category, d.lat, d.lon, d.popularity, r.name as region_name, r.id as region_id
            FROM destinations d
            JOIN regions r ON d.region_id = r.id
            WHERE d.name LIKE ?
            ORDER BY d.popularity DESC LIMIT 6
            """, (f"%{query}%",))

        rows = cursor.fetchall()
        conn.close()
        for r in rows:
            if not any(x["name"].lower() == r["name"].lower() for x in results):
                results.append(dict(r))
    except Exception as ex:
        print("[Search] SQLite search warning:", ex)

    payload_str = json.dumps(results[:12])
    etag = compute_etag(payload_str)

    client_etag = request.headers.get("If-None-Match")
    if client_etag and client_etag.strip() == etag:
        resp = Response("", status=304)
        resp.headers["ETag"] = etag
        resp.headers["X-Cache-Status"] = "REVALIDATED_304"
        return resp

    resp = Response(payload_str, status=200, mimetype="application/json")
    resp.headers["ETag"] = etag
    resp.headers["X-Cache-Status"] = "MISS_200"
    return resp

# ------------------------------------------------------------------------------
# Dynamic Region Search & Download APIs (OpenStreetMap Nominatim + Road Graph)
# ------------------------------------------------------------------------------
@app.route("/api/regions/search", methods=["GET"])
def search_regions():
    """Searches for downloadable geographical regions, cities, and towns using Nominatim."""
    query = request.args.get("q", "").strip()
    if not query or len(query) < 2:
        return jsonify([])

    results = []

    # 1. Search local SQLite regions
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
        SELECT id, name, city, country, description,
               bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon,
               center_lat, center_lon, default_zoom,
               node_count, edge_count, size_kb
        FROM regions
        WHERE name LIKE ? OR city LIKE ? OR country LIKE ?
        LIMIT 5
        """, (f"%{query}%", f"%{query}%", f"%{query}%"))
        for row in cursor.fetchall():
            r = dict(row)
            results.append({
                "id": r["id"],
                "region_id": r["id"],
                "name": r["name"],
                "city": r["city"],
                "country": r["country"],
                "description": r["description"],
                "center": {"lat": r["center_lat"], "lon": r["center_lon"]},
                "bbox": {
                    "min_lat": r["bbox_min_lat"],
                    "min_lon": r["bbox_min_lon"],
                    "max_lat": r["bbox_max_lat"],
                    "max_lon": r["bbox_max_lon"]
                },
                "node_count": r["node_count"],
                "edge_count": r["edge_count"],
                "size_kb": r["size_kb"],
                "is_downloaded": True
            })
        conn.close()
    except Exception as ex:
        print("[Regions Search] Local DB error:", ex)

    # 2. Query Nominatim for cities, towns, and regions
    try:
        import requests
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": query,
                "format": "json",
                "addressdetails": 1,
                "limit": 6
            },
            headers={"User-Agent": "OfflineRouteApp/1.0"},
            timeout=4.5
        )
        if resp.status_code == 200:
            for item in resp.json():
                display_name = item.get("display_name", "")
                addr = item.get("address", {})
                city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality") or item.get("name", "Unknown Area")
                country = addr.get("country", "Global")
                lat = float(item["lat"])
                lon = float(item["lon"])
                bb = item.get("boundingbox")
                if bb and len(bb) == 4:
                    min_lat = float(bb[0])
                    max_lat = float(bb[1])
                    min_lon = float(bb[2])
                    max_lon = float(bb[3])
                else:
                    min_lat = lat - 0.03
                    max_lat = lat + 0.03
                    min_lon = lon - 0.03
                    max_lon = lon + 0.03

                # Ensure span is reasonable
                if (max_lat - min_lat) < 0.02:
                    max_lat += 0.015
                    min_lat -= 0.015
                if (max_lon - min_lon) < 0.02:
                    max_lon += 0.015
                    min_lon -= 0.015

                reg_name = f"{city}, {country}" if city != country else city
                if not any(r["name"].lower() == reg_name.lower() for r in results):
                    results.append({
                        "id": f"reg_{item.get('osm_id', abs(hash(display_name)))}",
                        "region_id": f"reg_{item.get('osm_id', abs(hash(display_name)))}",
                        "name": reg_name,
                        "display_name": display_name,
                        "city": city,
                        "country": country,
                        "description": f"Real-world region covering {city} and vicinity ({item.get('type', 'place').replace('_', ' ').title()})",
                        "center": {"lat": lat, "lon": lon},
                        "bbox": {
                            "min_lat": min_lat,
                            "min_lon": min_lon,
                            "max_lat": max_lat,
                            "max_lon": max_lon
                        },
                        "is_downloaded": False
                    })
    except Exception as ex:
        print("[Regions Search] Nominatim error:", ex)

    return jsonify(results[:8])

@app.route("/api/regions/custom", methods=["POST"])
def create_custom_region():
    """
    Dynamically generates and downloads road network data for any arbitrary region.
    Stores the region into SQLite so HTTP caching, tile manifests, and routing work.
    """
    data = request.get_json() or {}
    name = data.get("name") or "Custom Region"
    city = data.get("city") or "Custom Area"
    country = data.get("country") or "Global"
    bbox = data.get("bbox")
    center = data.get("center")
    origin = data.get("origin")
    destination = data.get("destination")

    if not bbox or not center:
        if origin and destination:
            o_lat, o_lon = float(origin["lat"]), float(origin["lon"])
            d_lat, d_lon = float(destination["lat"]), float(destination["lon"])
            bbox = {
                "min_lat": min(o_lat, d_lat) - 0.02,
                "max_lat": max(o_lat, d_lat) + 0.02,
                "min_lon": min(o_lon, d_lon) - 0.02,
                "max_lon": max(o_lon, d_lon) + 0.02
            }
            center = {
                "lat": (o_lat + d_lat) / 2.0,
                "lon": (o_lon + d_lon) / 2.0
            }
        else:
            return jsonify({"error": "Missing bbox or center in request body"}), 400

    min_lat = float(bbox["min_lat"])
    min_lon = float(bbox["min_lon"])
    max_lat = float(bbox["max_lat"])
    max_lon = float(bbox["max_lon"])

    clean_city = "".join(c for c in city if c.isalnum() or c in ("-", "_")).lower()[:15]
    region_id = data.get("region_id") or f"custom_{clean_city}_{int(time.time())}"

    # Build road network
    network_data = build_osm_road_network(name, city, country, bbox, center, origin, destination)
    nodes = network_data["nodes"]
    edges = network_data["edges"]
    destinations_list = network_data["destinations"]

    road_network_dict = {
        "region_id": region_id,
        "name": name,
        "bbox": bbox,
        "center": center,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": nodes,
        "edges": edges,
        "destinations": destinations_list
    }

    road_network_json = json.dumps(road_network_dict)
    destinations_json = json.dumps(destinations_list)
    size_kb = max(25, int(len(road_network_json.encode("utf-8")) / 1024))
    etag = compute_etag(road_network_json)
    now_str = datetime.utcnow().isoformat()
    desc = data.get("description") or f"Downloaded offline road network for {name} with {len(nodes)} intersections and {len(edges)} road segments."

    # Insert into SQLite regions table
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT OR REPLACE INTO regions (
        id, name, city, country, description,
        bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon,
        center_lat, center_lon, default_zoom,
        node_count, edge_count, size_kb,
        road_network_json, destinations_json,
        etag, version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 14, ?, ?, ?, ?, ?, ?, 1, ?)
    """, (
        region_id, name, city, country, desc,
        min_lat, min_lon, max_lat, max_lon,
        float(center["lat"]), float(center["lon"]),
        len(nodes), len(edges), size_kb,
        road_network_json, destinations_json,
        etag, now_str
    ))

    # Also insert destinations into destinations table for autocomplete
    for d in destinations_list:
        cursor.execute("""
        INSERT OR IGNORE INTO destinations (id, name, category, lat, lon, region_id, popularity)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (d["id"], d["name"], d.get("category", "Landmark"), float(d["lat"]), float(d["lon"]), region_id, d.get("popularity", 90)))

    conn.commit()
    conn.close()

    response_payload = {
        "region_id": region_id,
        "id": region_id,
        "name": name,
        "city": city,
        "country": country,
        "description": desc,
        "bbox": bbox,
        "center": center,
        "default_zoom": 14,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "size_kb": size_kb,
        "version": 1,
        "etag": etag,
        "updated_at": now_str,
        "road_network": road_network_dict,
        "destinations": destinations_list
    }

    return jsonify(response_payload)

# ------------------------------------------------------------------------------
# Offline-to-Online Synchronization Endpoint
# ------------------------------------------------------------------------------
@app.route("/api/sync", methods=["POST"])
def sync_offline_events():
    """
    Receives and processes queued offline events from client:
    - Offline calculated routes
    - Saved routes created offline
    - Visited destinations
    - Offline network telemetry
    """
    data = request.get_json() or {}
    client_id = data.get("client_id", "anonymous_client")
    events = data.get("events", [])

    if not isinstance(events, list):
        return jsonify({"error": "Events must be a list"}), 400

    conn = get_db()
    cursor = conn.cursor()
    synced_count = 0
    now_str = datetime.utcnow().isoformat()

    for ev in events:
        event_type = ev.get("type", "unknown")
        payload = ev.get("payload", {})
        
        # Save event log
        cursor.execute("""
        INSERT INTO sync_events (client_id, event_type, payload_json, status, synced_at)
        VALUES (?, ?, ?, 'PROCESSED', ?)
        """, (client_id, event_type, json.dumps(payload), now_str))

        # If it's a route generated offline, also persist to server's shared route table
        if event_type == "offline_route_calculated" and "geometry" in payload:
            route_id = payload.get("route_id") or f"offline_{int(time.time()*1000)}"
            cursor.execute("""
            INSERT OR IGNORE INTO routes (
                id, origin_name, origin_lat, origin_lon,
                dest_name, dest_lat, dest_lon, mode,
                distance_km, duration_min, geometry_geojson, steps_json,
                etag, hits, created_at, last_accessed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                route_id,
                payload.get("origin", {}).get("name", "Offline Origin"),
                float(payload.get("origin", {}).get("lat", 0)),
                float(payload.get("origin", {}).get("lon", 0)),
                payload.get("destination", {}).get("name", "Offline Dest"),
                float(payload.get("destination", {}).get("lat", 0)),
                float(payload.get("destination", {}).get("lon", 0)),
                payload.get("mode", "driving"),
                payload.get("distance_km", 0),
                payload.get("duration_min", 0),
                json.dumps(payload.get("geometry", {})),
                json.dumps(payload.get("steps", [])),
                payload.get("etag", compute_etag(route_id)),
                1, now_str, now_str
            ))

        synced_count += 1

    conn.commit()
    conn.close()

    return jsonify({
        "status": "synchronized",
        "client_id": client_id,
        "synced_events_count": synced_count,
        "server_timestamp": now_str,
        "message": f"Successfully synchronized {synced_count} offline actions."
    })

# ------------------------------------------------------------------------------
# Computer Networks Telemetry & Performance API
# ------------------------------------------------------------------------------
@app.route("/api/network/stats", methods=["GET"])
def network_stats():
    """
    Returns server network efficiency metrics:
    Demonstrates HTTP Caching bandwidth savings and active sessions.
    """
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) as total_routes, SUM(hits) as total_route_hits FROM routes")
    route_stats = dict(cursor.fetchone())

    cursor.execute("SELECT COUNT(*) as total_synced_events FROM sync_events")
    sync_stats = dict(cursor.fetchone())

    cursor.execute("SELECT COUNT(*) as region_count, SUM(size_kb) as total_graph_size_kb FROM regions")
    region_stats = dict(cursor.fetchone())

    conn.close()

    # Calculate estimated bandwidth saved through 304 Not Modified
    hits = route_stats.get("total_route_hits") or 0
    routes_count = route_stats.get("total_routes") or 1
    cache_hits = max(0, hits - routes_count)
    estimated_kb_saved = round(cache_hits * 14.5, 1)  # average route payload ~14.5 KB

    return jsonify({
        "server_protocol": request.environ.get("SERVER_PROTOCOL", "HTTP/1.1"),
        "transport_layer": "TCP / IP",
        "http_caching": {
            "supported_mechanisms": ["ETag (RFC 7232)", "Conditional GET (304 Not Modified)", "Cache-Control"],
            "cache_hits": cache_hits,
            "estimated_data_saved_kb": estimated_kb_saved,
            "bandwidth_reduction_pct": round((cache_hits / max(1, hits)) * 100, 1) if hits > 0 else 0
        },
        "routes": route_stats,
        "sync_events": sync_stats,
        "regions": region_stats,
        "uptime_status": "Healthy / Listening"
    })

# ------------------------------------------------------------------------------
# Frontend Static Asset Serving (Production & Standalone Unified Mode)
# ------------------------------------------------------------------------------
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path != "" and os.path.exists(os.path.join(FRONTEND_DIST, path)):
        return send_from_directory(FRONTEND_DIST, path)
    index_path = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(index_path):
        return send_from_directory(FRONTEND_DIST, "index.html")
    return jsonify({
        "status": "online",
        "message": "OfflineRoute Backend API is running. Build frontend with 'npm run build' or run Vite dev server on port 3000."
    })

if __name__ == "__main__":
    print("Starting OfflineRoute Flask Server on http://127.0.0.1:5000...")
    app.run(host="127.0.0.1", port=5000, debug=False)
