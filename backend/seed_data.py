"""
Seeds the SQLite database with regional road networks, destination landmarks, and sample cached routes.
Computes real ETags for HTTP caching (Conditional GET / 304 Not Modified).
"""
import json
from datetime import datetime
from database import get_db, init_db, compute_etag
from road_network import ALL_REGIONS

def seed():
    init_db()
    conn = get_db()
    cursor = conn.cursor()

    print("Seeding regions...")
    for region_id, factory in ALL_REGIONS.items():
        graph = factory()
        graph_dict = graph.to_dict()
        network_json = json.dumps(graph_dict)
        destinations_json = json.dumps(graph.destinations)
        
        etag = compute_etag(network_json)
        size_kb = round(len(network_json.encode("utf-8")) / 1024, 1)

        city_map = {
            "sf-downtown": ("San Francisco", "USA", "Downtown Financial District, SOMA, and Embarcadero Waterfront with 30 nodes and 36 interconnected road segments."),
            "ny-midtown": ("New York", "USA", "Manhattan Midtown, Central Park South, Times Square, and Grand Central with 18 nodes and 23 road segments."),
            "london-westminster": ("London", "UK", "Central London, Westminster Abbey, Big Ben, Trafalgar Square, and Covent Garden with 12 nodes and 14 road segments."),
            "blr-tech": ("Bengaluru", "India", "Central Business District, MG Road, Indiranagar 100ft Road, and Koramangala tech hub with 10 nodes and 10 segments.")
        }
        city, country, desc = city_map[region_id]

        cursor.execute("""
        INSERT OR REPLACE INTO regions (
            id, name, city, country, description,
            bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon,
            center_lat, center_lon, default_zoom,
            node_count, edge_count, size_kb,
            road_network_json, destinations_json,
            etag, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            graph.region_id,
            graph.name,
            city,
            country,
            desc,
            graph.bbox["min_lat"],
            graph.bbox["min_lon"],
            graph.bbox["max_lat"],
            graph.bbox["max_lon"],
            graph.center["lat"],
            graph.center["lon"],
            14,
            graph_dict["node_count"],
            graph_dict["edge_count"],
            size_kb,
            network_json,
            destinations_json,
            etag,
            1,
            datetime.utcnow().isoformat()
        ))

        # Seed destinations
        for dest in graph.destinations:
            cursor.execute("""
            INSERT OR REPLACE INTO destinations (id, name, category, lat, lon, region_id, popularity)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                dest["id"],
                dest["name"],
                dest["category"],
                dest["lat"],
                dest["lon"],
                region_id,
                dest.get("popularity", 100)
            ))

    # Seed sample pre-cached route for instant demonstration
    sf_graph = ALL_REGIONS["sf-downtown"]()
    sample_route = sf_graph.route_a_star("SF_FERRY", "SF_MOSCONE", "driving")
    if sample_route:
        sample_payload = json.dumps(sample_route)
        route_etag = compute_etag(sample_payload)
        now_str = datetime.utcnow().isoformat()

        cursor.execute("""
        INSERT OR REPLACE INTO routes (
            id, origin_name, origin_lat, origin_lon,
            dest_name, dest_lat, dest_lon, mode,
            distance_km, duration_min, geometry_geojson, steps_json,
            etag, hits, created_at, last_accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            "route_sf_ferry_to_moscone",
            "Ferry Building / Embarcadero",
            37.7955, -122.3937,
            "Moscone Convention Center",
            37.7842, -122.4015,
            "driving",
            sample_route["distance_km"],
            sample_route["duration_min"],
            json.dumps({"type": "LineString", "coordinates": sample_route["coordinates"]}),
            json.dumps(sample_route["steps"]),
            route_etag,
            5,
            now_str,
            now_str
        ))

    conn.commit()
    conn.close()
    print("Database seeding completed successfully.")

if __name__ == "__main__":
    seed()
