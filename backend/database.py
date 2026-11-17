"""
Database models and SQLite connection manager for OfflineRoute.
Handles regions, road networks, cached routes, sync events, and CN telemetry.
"""
import sqlite3
import os
import json
import hashlib
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "offlineroute.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def compute_etag(data_str: str) -> str:
    """Computes an MD5 ETag for HTTP caching revalidation."""
    return f'"{hashlib.md5(data_str.encode("utf-8")).hexdigest()}"'

def init_db():
    """Initializes tables for regions, routes, destinations, sync events, and CN telemetry."""
    conn = get_db()
    cursor = conn.cursor()

    # Regions table: stores downloadable offline maps with full road network graphs
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS regions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        city TEXT NOT NULL,
        country TEXT NOT NULL,
        description TEXT,
        bbox_min_lat REAL NOT NULL,
        bbox_min_lon REAL NOT NULL,
        bbox_max_lat REAL NOT NULL,
        bbox_max_lon REAL NOT NULL,
        center_lat REAL NOT NULL,
        center_lon REAL NOT NULL,
        default_zoom INTEGER NOT NULL DEFAULT 14,
        node_count INTEGER NOT NULL DEFAULT 0,
        edge_count INTEGER NOT NULL DEFAULT 0,
        size_kb INTEGER NOT NULL DEFAULT 0,
        road_network_json TEXT NOT NULL,
        destinations_json TEXT NOT NULL,
        etag TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
    );
    """)

    # Routes table: server-side cached routes for fast O(1) retrieval and ETag matching
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS routes (
        id TEXT PRIMARY KEY,
        origin_name TEXT,
        origin_lat REAL NOT NULL,
        origin_lon REAL NOT NULL,
        dest_name TEXT,
        dest_lat REAL NOT NULL,
        dest_lon REAL NOT NULL,
        mode TEXT NOT NULL DEFAULT 'driving',
        distance_km REAL NOT NULL,
        duration_min REAL NOT NULL,
        geometry_geojson TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        etag TEXT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL
    );
    """)

    # Destinations index for autocomplete search
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS destinations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        region_id TEXT NOT NULL,
        popularity INTEGER NOT NULL DEFAULT 100,
        FOREIGN KEY (region_id) REFERENCES regions (id)
    );
    """)

    # Sync events: offline actions submitted by clients upon reconnection
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sync_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PROCESSED',
        synced_at TEXT NOT NULL
    );
    """)

    # Network Telemetry: tracks requests, response sizes, caching efficiency, and simulated network metrics
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS network_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        is_cache_hit INTEGER NOT NULL DEFAULT 0,
        latency_ms REAL NOT NULL,
        bytes_sent INTEGER NOT NULL,
        bytes_received INTEGER NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'HTTP/1.1',
        created_at TEXT NOT NULL
    );
    """)

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database schema successfully initialized.")
