"""
Road network graph representations, spatial snapping, and A* / Dijkstra routing engine.
Provides datasets for San Francisco Downtown, New York Midtown, London Westminster, and Bengaluru Tech Corridor.
"""
import math
import heapq
from typing import Dict, List, Tuple, Any, Optional

def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two GPS coordinates in meters."""
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates initial compass bearing (0-360 degrees) from point 1 to point 2."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = (math.cos(phi1) * math.sin(phi2) -
         math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda))
    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360.0) % 360.0

def snap_to_nearest_node(lat: float, lon: float, nodes: Dict[str, Any]) -> Tuple[str, float]:
    """Finds the closest road network node to a given coordinate."""
    best_node_id = None
    min_dist = float("inf")
    for node_id, data in nodes.items():
        d = haversine_distance_meters(lat, lon, data["lat"], data["lon"])
        if d < min_dist:
            min_dist = d
            best_node_id = node_id
    return best_node_id, min_dist

class RoadGraph:
    def __init__(self, region_id: str, name: str, bbox: Dict[str, float], center: Dict[str, float]):
        self.region_id = region_id
        self.name = name
        self.bbox = bbox
        self.center = center
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.adjacency: Dict[str, List[Dict[str, Any]]] = {}
        self.destinations: List[Dict[str, Any]] = []

    def add_node(self, node_id: str, lat: float, lon: float, name: str, node_type: str = "intersection"):
        self.nodes[node_id] = {
            "id": node_id,
            "lat": lat,
            "lon": lon,
            "name": name,
            "type": node_type
        }
        if node_id not in self.adjacency:
            self.adjacency[node_id] = []

    def add_edge(self, u: str, v: str, street_name: str, road_type: str = "primary",
                 max_speed_kmh: float = 40.0, bidirectional: bool = True):
        dist_m = haversine_distance_meters(
            self.nodes[u]["lat"], self.nodes[u]["lon"],
            self.nodes[v]["lat"], self.nodes[v]["lon"]
        )
        edge_data_uv = {
            "target": v,
            "street": street_name,
            "road_type": road_type,
            "distance_m": round(dist_m, 1),
            "max_speed_kmh": max_speed_kmh
        }
        self.adjacency[u].append(edge_data_uv)

        if bidirectional:
            edge_data_vu = {
                "target": u,
                "street": street_name,
                "road_type": road_type,
                "distance_m": round(dist_m, 1),
                "max_speed_kmh": max_speed_kmh
            }
            self.adjacency[v].append(edge_data_vu)

    def add_destination(self, dest_id: str, name: str, category: str, lat: float, lon: float, popularity: int = 100):
        self.destinations.append({
            "id": dest_id,
            "name": name,
            "category": category,
            "lat": lat,
            "lon": lon,
            "popularity": popularity
        })

    def to_dict(self) -> Dict[str, Any]:
        """Serializes the graph for JSON transmission and IndexedDB client storage."""
        edges_list = []
        for u, neighbors in self.adjacency.items():
            for edge in neighbors:
                edges_list.append({
                    "source": u,
                    "target": edge["target"],
                    "street": edge["street"],
                    "road_type": edge["road_type"],
                    "distance_m": edge["distance_m"],
                    "max_speed_kmh": edge["max_speed_kmh"]
                })
        return {
            "region_id": self.region_id,
            "name": self.name,
            "bbox": self.bbox,
            "center": self.center,
            "node_count": len(self.nodes),
            "edge_count": len(edges_list),
            "nodes": self.nodes,
            "edges": edges_list,
            "destinations": self.destinations
        }

    def route_a_star(self, start_node_id: str, end_node_id: str, mode: str = "driving", origin: Optional[Dict[str, Any]] = None, dest: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """
        Computes the optimal route using A* pathfinding with Haversine distance heuristic.
        Supports driving, cycling, and walking modes with realistic travel speeds.
        Seamlessly connects origin and destination coordinates to the route geometry.
        """
        if start_node_id not in self.nodes or end_node_id not in self.nodes:
            return None

        # Mode speed multipliers (km/h)
        speed_defaults = {
            "driving": 40.0,
            "cycling": 18.0,
            "walking": 4.5
        }
        default_speed = speed_defaults.get(mode, 40.0)

        # Target coordinates for heuristic
        target_lat = self.nodes[end_node_id]["lat"]
        target_lon = self.nodes[end_node_id]["lon"]

        def heuristic(node_id: str) -> float:
            n = self.nodes[node_id]
            dist_m = haversine_distance_meters(n["lat"], n["lon"], target_lat, target_lon)
            # Time in seconds at max speed
            return dist_m / (default_speed * 1000.0 / 3600.0)

        # Priority queue entries: (f_score, g_score, current_node_id, path, edges_taken)
        pq = []
        heapq.heappush(pq, (heuristic(start_node_id), 0.0, start_node_id, [start_node_id], []))

        g_scores = {start_node_id: 0.0}
        visited = set()

        while pq:
            f, g, current, path, edges_taken = heapq.heappop(pq)

            if current == end_node_id:
                return self._build_route_result(path, edges_taken, mode, origin, dest)

            if current in visited:
                continue
            visited.add(current)

            for edge in self.adjacency.get(current, []):
                neighbor = edge["target"]
                speed = edge["max_speed_kmh"] if mode == "driving" else default_speed
                speed_mps = max(1.0, speed * 1000.0 / 3600.0)
                travel_time_sec = edge["distance_m"] / speed_mps

                tentative_g = g + travel_time_sec

                if tentative_g < g_scores.get(neighbor, float("inf")):
                    g_scores[neighbor] = tentative_g
                    f_score = tentative_g + heuristic(neighbor)
                    heapq.heappush(pq, (
                        f_score,
                        tentative_g,
                        neighbor,
                        path + [neighbor],
                        edges_taken + [edge]
                    ))

        return None

    def _build_route_result(self, path: List[str], edges_taken: List[Dict[str, Any]], mode: str, origin: Optional[Dict[str, Any]] = None, dest: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Builds GeoJSON geometry, turn-by-turn steps, distance, and duration with full endpoint connectivity."""
        coordinates = []
        total_distance_m = sum(e["distance_m"] for e in edges_taken)
        
        speed_defaults = {"driving": 40.0, "cycling": 18.0, "walking": 4.5}
        mode_speed = speed_defaults.get(mode, 40.0)
        total_time_sec = 0.0
        for edge in edges_taken:
            speed = edge["max_speed_kmh"] if mode == "driving" else mode_speed
            total_time_sec += edge["distance_m"] / (max(1.0, speed * 1000.0 / 3600.0))

        # First-mile connection from origin point to start node
        if origin and origin.get("lat") is not None and origin.get("lon") is not None:
            o_lat, o_lon = float(origin["lat"]), float(origin["lon"])
            first_node = self.nodes[path[0]]
            d_start = haversine_distance_meters(o_lat, o_lon, first_node["lat"], first_node["lon"])
            if d_start > 0.01:
                coordinates.append([o_lon, o_lat])
                total_distance_m += d_start
                total_time_sec += d_start / (max(1.0, mode_speed * 1000.0 / 3600.0))

        # Road intersection nodes
        for i in range(len(path)):
            node = self.nodes[path[i]]
            coordinates.append([node["lon"], node["lat"]])

        # Last-mile connection from end node to destination point
        if dest and dest.get("lat") is not None and dest.get("lon") is not None:
            d_lat, d_lon = float(dest["lat"]), float(dest["lon"])
            last_node = self.nodes[path[-1]]
            d_end = haversine_distance_meters(last_node["lat"], last_node["lon"], d_lat, d_lon)
            if d_end > 0.01:
                coordinates.append([d_lon, d_lat])
                total_distance_m += d_end
                total_time_sec += d_end / (max(1.0, mode_speed * 1000.0 / 3600.0))

        # Turn-by-turn step generation
        steps = []
        for i in range(len(edges_taken)):
            u_node = self.nodes[path[i]]
            v_node = self.nodes[path[i+1]]
            edge = edges_taken[i]

            bearing = calculate_bearing(u_node["lat"], u_node["lon"], v_node["lat"], v_node["lon"])
            
            instruction = ""
            modifier = "straight"
            if i == 0:
                instruction = f"Head on {edge['street']}"
                modifier = "depart"
            else:
                prev_u = self.nodes[path[i-1]]
                prev_bearing = calculate_bearing(prev_u["lat"], prev_u["lon"], u_node["lat"], u_node["lon"])
                diff = (bearing - prev_bearing + 360.0) % 360.0

                if diff > 180:
                    diff -= 360.0

                if abs(diff) < 25:
                    instruction = f"Continue straight onto {edge['street']}"
                    modifier = "straight"
                elif 25 <= diff < 65:
                    instruction = f"Turn slight right onto {edge['street']}"
                    modifier = "slight-right"
                elif 65 <= diff <= 125:
                    instruction = f"Turn right onto {edge['street']}"
                    modifier = "turn-right"
                elif diff > 125:
                    instruction = f"Sharp right onto {edge['street']}"
                    modifier = "sharp-right"
                elif -65 < diff <= -25:
                    instruction = f"Turn slight left onto {edge['street']}"
                    modifier = "slight-left"
                elif -125 <= diff <= -65:
                    instruction = f"Turn left onto {edge['street']}"
                    modifier = "turn-left"
                else:
                    instruction = f"Sharp left onto {edge['street']}"
                    modifier = "sharp-left"

            steps.append({
                "step_index": i + 1,
                "street": edge["street"],
                "instruction": instruction,
                "modifier": modifier,
                "distance_m": round(edge["distance_m"], 1),
                "duration_sec": round(edge["distance_m"] / (max(1.0, edge["max_speed_kmh"] * 1000.0 / 3600.0)), 1),
                "start_node": path[i],
                "end_node": path[i+1],
                "location": [u_node["lon"], u_node["lat"]]
            })

        # Final arrival step
        dest_node = self.nodes[path[-1]]
        steps.append({
            "step_index": len(steps) + 1,
            "street": edges_taken[-1]["street"] if edges_taken else "Destination",
            "instruction": f"Arrive at {dest_node['name']}",
            "modifier": "arrive",
            "distance_m": 0,
            "duration_sec": 0,
            "start_node": path[-1],
            "end_node": path[-1],
            "location": [dest_node["lon"], dest_node["lat"]]
        })

        return {
            "distance_km": round(total_distance_m / 1000.0, 2),
            "duration_min": round(total_time_sec / 60.0, 1),
            "coordinates": coordinates,
            "steps": steps,
            "path_nodes": path
        }


# ==============================================================================
# REALISTIC REGIONAL DATASETS
# ==============================================================================

def create_sf_downtown() -> RoadGraph:
    """San Francisco Downtown, Financial District, SOMA, and Embarcadero."""
    g = RoadGraph(
        region_id="sf-downtown",
        name="San Francisco Downtown & Waterfront",
        bbox={
            "min_lat": 37.7700,
            "min_lon": -122.4250,
            "max_lat": 37.8080,
            "max_lon": -122.3880
        },
        center={"lat": 37.7900, "lon": -122.4010}
    )

    # Key intersections / street nodes
    nodes_data = [
        ("SF_FERRY", 37.7955, -122.3937, "Ferry Building / Embarcadero"),
        ("SF_EMBARK_MKT", 37.7940, -122.3955, "Market St & Embarcadero"),
        ("SF_MKT_BEALE", 37.7925, -122.3975, "Market St & Beale St"),
        ("SF_MKT_1ST", 37.7900, -122.4000, "Market St & 1st St"),
        ("SF_MKT_2ND", 37.7885, -122.4020, "Market St & 2nd St / Montgomery"),
        ("SF_MKT_3RD", 37.7870, -122.4040, "Market St & 3rd St / Kearny"),
        ("SF_MKT_4TH", 37.7855, -122.4060, "Market St & 4th St / Stockton"),
        ("SF_MKT_5TH", 37.7840, -122.4080, "Market St & 5th St / Powell St"),
        ("SF_MKT_6TH", 37.7818, -122.4110, "Market St & 6th St"),
        ("SF_MKT_7TH", 37.7795, -122.4140, "Market St & 7th St"),
        ("SF_CIVIC_CTR", 37.7790, -122.4175, "Civic Center / City Hall"),
        ("SF_UNION_SQ", 37.7879, -122.4075, "Union Square (Powell & Post)"),
        ("SF_POWELL_GEARY", 37.7869, -122.4082, "Powell St & Geary St"),
        ("SF_CHINATOWN_GATE", 37.7907, -122.4057, "Dragon Gate (Grant & Bush)"),
        ("SF_PORTSMOUTH_SQ", 37.7948, -122.4049, "Portsmouth Square (Kearny & Washington)"),
        ("SF_TRANSAMERICA", 37.7952, -122.4028, "Transamerica Pyramid (Montgomery & Clay)"),
        ("SF_COLUMBUS_BDWY", 37.7981, -122.4061, "Broadway & Columbus Ave (North Beach)"),
        ("SF_PIER_39", 37.8087, -122.4098, "Pier 39 / Fisherman's Wharf"),
        ("SF_EMBARK_BROADWAY", 37.7995, -122.3990, "Embarcadero & Broadway"),
        ("SF_EMBARK_BAY", 37.8060, -122.4045, "Embarcadero & Bay St"),
        ("SF_MOSCONE", 37.7842, -122.4015, "Moscone Convention Center (Howard & 3rd)"),
        ("SF_HOWARD_1ST", 37.7885, -122.3965, "Howard St & 1st St"),
        ("SF_HOWARD_2ND", 37.7865, -122.3990, "Howard St & 2nd St"),
        ("SF_HOWARD_4TH", 37.7825, -122.4035, "Howard St & 4th St"),
        ("SF_FOLSOM_2ND", 37.7850, -122.3975, "Folsom St & 2nd St"),
        ("SF_FOLSOM_3RD", 37.7830, -122.4000, "Folsom St & 3rd St"),
        ("SF_FOLSOM_4TH", 37.7810, -122.4020, "Folsom St & 4th St"),
        ("SF_ORACLE_PARK", 37.7786, -122.3893, "Oracle Park (King & 3rd)"),
        ("SF_KING_4TH", 37.7765, -122.3945, "Caltrain Depot (4th & King)"),
        ("SF_SALESFORCE", 37.7897, -122.3972, "Salesforce Tower (Mission & Fremont)")
    ]

    for nid, lat, lon, name in nodes_data:
        g.add_node(nid, lat, lon, name)

    # Connect streets (Primary grid)
    # Market Street backbone
    g.add_edge("SF_FERRY", "SF_EMBARK_MKT", "The Embarcadero", "primary", 45)
    g.add_edge("SF_EMBARK_MKT", "SF_MKT_BEALE", "Market Street", "primary", 35)
    g.add_edge("SF_MKT_BEALE", "SF_MKT_1ST", "Market Street", "primary", 35)
    g.add_edge("SF_MKT_1ST", "SF_MKT_2ND", "Market Street", "primary", 35)
    g.add_edge("SF_MKT_2ND", "SF_MKT_3RD", "Market Street", "primary", 35)
    g.add_edge("SF_MKT_3RD", "SF_MKT_4TH", "Market Street", "primary", 35)
    g.add_edge("SF_MKT_4TH", "SF_MKT_5TH", "Market Street", "primary", 35)
    g.add_edge("SF_MKT_5TH", "SF_MKT_6TH", "Market Street", "primary", 35)
    g.add_edge("SF_MKT_6TH", "SF_MKT_7TH", "Market Street", "primary", 35)
    g.add_edge("SF_MKT_7TH", "SF_CIVIC_CTR", "Market Street", "primary", 35)

    # Embarcadero waterfront northward
    g.add_edge("SF_FERRY", "SF_EMBARK_BROADWAY", "The Embarcadero", "primary", 45)
    g.add_edge("SF_EMBARK_BROADWAY", "SF_EMBARK_BAY", "The Embarcadero", "primary", 45)
    g.add_edge("SF_EMBARK_BAY", "SF_PIER_39", "The Embarcadero", "primary", 40)

    # Powell & Union Square
    g.add_edge("SF_MKT_5TH", "SF_POWELL_GEARY", "Powell Street", "secondary", 25)
    g.add_edge("SF_POWELL_GEARY", "SF_UNION_SQ", "Powell Street", "secondary", 25)
    g.add_edge("SF_UNION_SQ", "SF_CHINATOWN_GATE", "Post Street", "secondary", 30)

    # Chinatown & North Beach
    g.add_edge("SF_CHINATOWN_GATE", "SF_PORTSMOUTH_SQ", "Grant Avenue", "secondary", 25)
    g.add_edge("SF_PORTSMOUTH_SQ", "SF_TRANSAMERICA", "Washington Street", "secondary", 30)
    g.add_edge("SF_PORTSMOUTH_SQ", "SF_COLUMBUS_BDWY", "Columbus Avenue", "primary", 35)
    g.add_edge("SF_COLUMBUS_BDWY", "SF_PIER_39", "Columbus Ave & Taylor", "primary", 35)
    g.add_edge("SF_TRANSAMERICA", "SF_MKT_1ST", "Montgomery Street", "secondary", 30)
    g.add_edge("SF_TRANSAMERICA", "SF_EMBARK_BROADWAY", "Broadway", "primary", 40)

    # South of Market (SOMA) cross streets
    g.add_edge("SF_MKT_1ST", "SF_SALESFORCE", "Fremont Street", "secondary", 30)
    g.add_edge("SF_SALESFORCE", "SF_HOWARD_1ST", "Fremont & Howard", "secondary", 30)
    g.add_edge("SF_MKT_2ND", "SF_HOWARD_2ND", "2nd Street", "secondary", 30)
    g.add_edge("SF_HOWARD_2ND", "SF_FOLSOM_2ND", "2nd Street", "secondary", 30)

    g.add_edge("SF_MKT_3RD", "SF_MOSCONE", "3rd Street", "primary", 35)
    g.add_edge("SF_MOSCONE", "SF_FOLSOM_3RD", "3rd Street", "primary", 35)
    g.add_edge("SF_FOLSOM_3RD", "SF_ORACLE_PARK", "3rd Street South", "primary", 40)

    g.add_edge("SF_MKT_4TH", "SF_HOWARD_4TH", "4th Street", "secondary", 30)
    g.add_edge("SF_HOWARD_4TH", "SF_FOLSOM_4TH", "4th Street", "secondary", 30)
    g.add_edge("SF_FOLSOM_4TH", "SF_KING_4TH", "4th Street", "secondary", 35)
    g.add_edge("SF_KING_4TH", "SF_ORACLE_PARK", "King Street", "primary", 40)

    # SOMA parallel avenues
    g.add_edge("SF_HOWARD_1ST", "SF_HOWARD_2ND", "Howard Street", "secondary", 35)
    g.add_edge("SF_HOWARD_2ND", "SF_MOSCONE", "Howard Street", "secondary", 35)
    g.add_edge("SF_MOSCONE", "SF_HOWARD_4TH", "Howard Street", "secondary", 35)

    g.add_edge("SF_FOLSOM_2ND", "SF_FOLSOM_3RD", "Folsom Street", "secondary", 35)
    g.add_edge("SF_FOLSOM_3RD", "SF_FOLSOM_4TH", "Folsom Street", "secondary", 35)

    # Key destinations
    g.add_destination("sf_ferry", "Ferry Building Marketplace", "Attraction", 37.7955, -122.3937, 98)
    g.add_destination("sf_union_sq", "Union Square Shopping", "Shopping", 37.7879, -122.4075, 95)
    g.add_destination("sf_pier39", "Pier 39 Sea Lions", "Attraction", 37.8087, -122.4098, 99)
    g.add_destination("sf_salesforce", "Salesforce Tower & Park", "Landmark", 37.7897, -122.3972, 92)
    g.add_destination("sf_oracle", "Oracle Park (SF Giants)", "Sports", 37.7786, -122.3893, 90)
    g.add_destination("sf_chinatown", "Chinatown Dragon Gate", "Culture", 37.7907, -122.4057, 88)
    g.add_destination("sf_moscone", "Moscone Convention Center", "Business", 37.7842, -122.4015, 87)
    g.add_destination("sf_civic", "San Francisco City Hall", "Civic", 37.7790, -122.4175, 85)

    return g


def create_ny_midtown() -> RoadGraph:
    """New York Manhattan Midtown & Central Park."""
    g = RoadGraph(
        region_id="ny-midtown",
        name="New York Manhattan Midtown",
        bbox={
            "min_lat": 40.7450,
            "min_lon": -74.0050,
            "max_lat": 40.7850,
            "max_lon": -73.9650
        },
        center={"lat": 40.7600, "lon": -73.9820}
    )

    nodes_data = [
        ("NY_TIMES_SQ", 40.7580, -73.9855, "Times Square (42nd & Broadway)"),
        ("NY_GRAND_CENTRAL", 40.7527, -73.9772, "Grand Central Terminal (42nd & Park)"),
        ("NY_BRYANT_PARK", 40.7536, -73.9832, "Bryant Park (42nd & 6th Ave)"),
        ("NY_EMPIRE_STATE", 40.7484, -73.9857, "Empire State Building (34th & 5th)"),
        ("NY_HERALD_SQ", 40.7497, -73.9878, "Herald Square / Macy's (34th & 6th)"),
        ("NY_PENN_STATION", 40.7505, -73.9934, "Penn Station / MSG (33rd & 8th)"),
        ("NY_ROCKEFELLER", 40.7587, -73.9787, "Rockefeller Center (50th & 5th)"),
        ("NY_RADIO_CITY", 40.7599, -73.9799, "Radio City Music Hall (50th & 6th)"),
        ("NY_MOMA", 40.7614, -73.9776, "Museum of Modern Art (53rd & 5th)"),
        ("NY_CARNEGIE_HALL", 40.7651, -73.9799, "Carnegie Hall (57th & 7th)"),
        ("NY_COLUMBUS_CIRCLE", 40.7681, -73.9819, "Columbus Circle / Central Park SW"),
        ("NY_CP_SOUTH_5TH", 40.7648, -73.9738, "Central Park South & 5th Ave (Plaza)"),
        ("NY_CP_ZOO", 40.7678, -73.9718, "Central Park Zoo"),
        ("NY_CP_SHEEP_MEADOW", 40.7715, -73.9745, "Central Park Sheep Meadow"),
        ("NY_CP_BETHESDA", 40.7738, -73.9708, "Bethesda Terrace / The Lake"),
        ("NY_5TH_42ND", 40.7532, -73.9815, "5th Ave & 42nd St (NY Public Library)"),
        ("NY_7TH_42ND", 40.7562, -73.9875, "7th Ave & 42nd St"),
        ("NY_BROADWAY_50TH", 40.7618, -73.9845, "Broadway & 50th St Theater District")
    ]

    for nid, lat, lon, name in nodes_data:
        g.add_node(nid, lat, lon, name)

    # 42nd Street Corridor
    g.add_edge("NY_GRAND_CENTRAL", "NY_5TH_42ND", "East 42nd Street", "primary", 35)
    g.add_edge("NY_5TH_42ND", "NY_BRYANT_PARK", "West 42nd Street", "primary", 35)
    g.add_edge("NY_BRYANT_PARK", "NY_TIMES_SQ", "West 42nd Street", "primary", 35)
    g.add_edge("NY_TIMES_SQ", "NY_7TH_42ND", "7th Avenue & 42nd", "primary", 35)

    # 34th Street Corridor
    g.add_edge("NY_EMPIRE_STATE", "NY_HERALD_SQ", "West 34th Street", "primary", 35)
    g.add_edge("NY_HERALD_SQ", "NY_PENN_STATION", "West 34th Street", "primary", 35)

    # Avenues (South to North)
    # 5th Avenue
    g.add_edge("NY_EMPIRE_STATE", "NY_5TH_42ND", "5th Avenue", "primary", 35)
    g.add_edge("NY_5TH_42ND", "NY_ROCKEFELLER", "5th Avenue", "primary", 35)
    g.add_edge("NY_ROCKEFELLER", "NY_MOMA", "5th Avenue", "primary", 35)
    g.add_edge("NY_MOMA", "NY_CP_SOUTH_5TH", "5th Avenue", "primary", 35)
    g.add_edge("NY_CP_SOUTH_5TH", "NY_CP_ZOO", "5th Ave & Central Park", "secondary", 30)

    # 6th Avenue (Avenue of the Americas)
    g.add_edge("NY_HERALD_SQ", "NY_BRYANT_PARK", "6th Avenue", "primary", 35)
    g.add_edge("NY_BRYANT_PARK", "NY_RADIO_CITY", "6th Avenue", "primary", 35)
    g.add_edge("NY_RADIO_CITY", "NY_CARNEGIE_HALL", "6th Avenue to 57th", "primary", 35)

    # Broadway & 7th Ave (Theater District)
    g.add_edge("NY_TIMES_SQ", "NY_BROADWAY_50TH", "Broadway", "primary", 30)
    g.add_edge("NY_BROADWAY_50TH", "NY_CARNEGIE_HALL", "Broadway & 7th", "primary", 35)
    g.add_edge("NY_CARNEGIE_HALL", "NY_COLUMBUS_CIRCLE", "Broadway North", "primary", 35)

    # Cross Streets
    g.add_edge("NY_ROCKEFELLER", "NY_RADIO_CITY", "West 50th Street", "secondary", 30)
    g.add_edge("NY_RADIO_CITY", "NY_BROADWAY_50TH", "West 50th Street", "secondary", 30)
    g.add_edge("NY_COLUMBUS_CIRCLE", "NY_CP_SOUTH_5TH", "Central Park South (59th St)", "primary", 35)

    # Inside Central Park Paths
    g.add_edge("NY_COLUMBUS_CIRCLE", "NY_CP_SHEEP_MEADOW", "Central Park West Drive", "pedestrian", 20)
    g.add_edge("NY_CP_SOUTH_5TH", "NY_CP_ZOO", "East Drive", "pedestrian", 20)
    g.add_edge("NY_CP_ZOO", "NY_CP_BETHESDA", "The Mall & Literary Walk", "pedestrian", 20)
    g.add_edge("NY_CP_SHEEP_MEADOW", "NY_CP_BETHESDA", "Terrace Drive", "pedestrian", 20)

    # Destinations
    g.add_destination("ny_times_sq", "Times Square", "Attraction", 40.7580, -73.9855, 100)
    g.add_destination("ny_empire", "Empire State Building", "Landmark", 40.7484, -73.9857, 98)
    g.add_destination("ny_grand_central", "Grand Central Terminal", "Transit", 40.7527, -73.9772, 96)
    g.add_destination("ny_rockefeller", "Rockefeller Center & Top of the Rock", "Landmark", 40.7587, -73.9787, 94)
    g.add_destination("ny_bethesda", "Bethesda Terrace, Central Park", "Attraction", 40.7738, -73.9708, 92)
    g.add_destination("ny_moma", "MoMA (Museum of Modern Art)", "Museum", 40.7614, -73.9776, 90)

    return g


def create_london_westminster() -> RoadGraph:
    """Central London, Westminster, Covent Garden, and Trafalgar."""
    g = RoadGraph(
        region_id="london-westminster",
        name="Central London & Westminster",
        bbox={
            "min_lat": 51.4950,
            "min_lon": -0.1450,
            "max_lat": 51.5200,
            "max_lon": -0.1100
        },
        center={"lat": 51.5074, "lon": -0.1278}
    )

    nodes_data = [
        ("LDN_BIG_BEN", 51.5007, -0.1246, "Big Ben / Houses of Parliament"),
        ("LDN_WESTMINSTER_ABBEY", 51.4994, -0.1273, "Westminster Abbey"),
        ("LDN_WHITEHALL_MID", 51.5042, -0.1260, "Whitehall / 10 Downing St"),
        ("LDN_TRAFALGAR", 51.5080, -0.1281, "Trafalgar Square / National Gallery"),
        ("LDN_PICCADILLY", 51.5101, -0.1340, "Piccadilly Circus"),
        ("LDN_LEICESTER_SQ", 51.5113, -0.1283, "Leicester Square"),
        ("LDN_COVENT_GARDEN", 51.5117, -0.1240, "Covent Garden Market"),
        ("LDN_STRAND_MID", 51.5098, -0.1225, "The Strand / Charing Cross"),
        ("LDN_WATERLOO_BRG_N", 51.5108, -0.1197, "Waterloo Bridge North / Embankment"),
        ("LDN_WATERLOO_BRG_S", 51.5065, -0.1165, "Southbank / Waterloo Station"),
        ("LDN_LONDON_EYE", 51.5033, -0.1195, "The London Eye"),
        ("LDN_WESTMINSTER_BRG_E", 51.5015, -0.1190, "Westminster Bridge South Bank")
    ]

    for nid, lat, lon, name in nodes_data:
        g.add_node(nid, lat, lon, name)

    # Connect Westminster & Whitehall
    g.add_edge("LDN_WESTMINSTER_ABBEY", "LDN_BIG_BEN", "Broad Sanctuary", "secondary", 30)
    g.add_edge("LDN_BIG_BEN", "LDN_WHITEHALL_MID", "Parliament St / Whitehall", "primary", 35)
    g.add_edge("LDN_WHITEHALL_MID", "LDN_TRAFALGAR", "Whitehall", "primary", 35)

    # Trafalgar & West End
    g.add_edge("LDN_TRAFALGAR", "LDN_PICCADILLY", "Pall Mall / Haymarket", "primary", 30)
    g.add_edge("LDN_PICCADILLY", "LDN_LEICESTER_SQ", "Coventry Street", "pedestrian", 20)
    g.add_edge("LDN_LEICESTER_SQ", "LDN_COVENT_GARDEN", "Cranbourn St & Long Acre", "secondary", 25)
    g.add_edge("LDN_TRAFALGAR", "LDN_STRAND_MID", "The Strand", "primary", 35)
    g.add_edge("LDN_STRAND_MID", "LDN_COVENT_GARDEN", "Bedford Street", "secondary", 25)
    g.add_edge("LDN_STRAND_MID", "LDN_WATERLOO_BRG_N", "The Strand", "primary", 35)

    # Bridges across Thames
    g.add_edge("LDN_BIG_BEN", "LDN_WESTMINSTER_BRG_E", "Westminster Bridge", "primary", 35)
    g.add_edge("LDN_WESTMINSTER_BRG_E", "LDN_LONDON_EYE", "Queen's Walk / Southbank", "pedestrian", 15)
    g.add_edge("LDN_LONDON_EYE", "LDN_WATERLOO_BRG_S", "Belvedere Road", "secondary", 25)
    g.add_edge("LDN_WATERLOO_BRG_S", "LDN_WATERLOO_BRG_N", "Waterloo Bridge", "primary", 40)

    # Destinations
    g.add_destination("ldn_bigben", "Big Ben & Elizabeth Tower", "Landmark", 51.5007, -0.1246, 100)
    g.add_destination("ldn_eye", "The London Eye", "Attraction", 51.5033, -0.1195, 98)
    g.add_destination("ldn_trafalgar", "Trafalgar Square & National Gallery", "Culture", 51.5080, -0.1281, 95)
    g.add_destination("ldn_covent", "Covent Garden Piazza", "Shopping", 51.5117, -0.1240, 93)
    g.add_destination("ldn_abbey", "Westminster Abbey", "Heritage", 51.4994, -0.1273, 91)

    return g


def create_bengaluru_tech() -> RoadGraph:
    """Bengaluru Central Business District & Indiranagar."""
    g = RoadGraph(
        region_id="blr-tech",
        name="Bengaluru Central & Indiranagar",
        bbox={
            "min_lat": 12.9450,
            "min_lon": 77.5850,
            "max_lat": 12.9850,
            "max_lon": 77.6550
        },
        center={"lat": 12.9716, "lon": 77.6200}
    )

    nodes_data = [
        ("BLR_MG_ROAD", 12.9756, 77.6066, "MG Road Metro Station"),
        ("BLR_BRIGADE_RD", 12.9738, 77.6080, "Brigade Road Junction"),
        ("BLR_TRINITY", 12.9729, 77.6174, "Trinity Circle"),
        ("BLR_ADIGAS_DICKENSON", 12.9763, 77.6147, "Adigas Junction / Dickenson Rd"),
        ("BLR_CUBBON_KAMARAJ", 12.9780, 77.6095, "Cubbon Road / Kamaraj Rd"),
        ("BLR_HALASURU", 12.9760, 77.6267, "Halasuru Lake / Old Madras Rd"),
        ("BLR_INDIRANAGAR_100FT", 12.9784, 77.6408, "Indiranagar 100ft Rd / CMH Rd"),
        ("BLR_INDIRANAGAR_12TH_MAIN", 12.9698, 77.6415, "Indiranagar 12th Main Food Street"),
        ("BLR_DOMLUR_FLYOVER", 12.9610, 77.6385, "Domlur Intermediate Ring Rd Flyover"),
        ("BLR_EGL", 12.9555, 77.6480, "Embassy GolfLinks Business Park (EGL)"),
        ("BLR_KORAMANGALA_SONY", 12.9352, 77.6245, "Sony World Signal, Koramangala"),
        ("BLR_KORAMANGALA_80FT", 12.9485, 77.6275, "Koramangala 80 Feet Road"),
        ("BLR_RESIDENCY_RD", 12.9690, 77.6050, "Residency Road Junction"),
        ("BLR_COMMERCIAL_ST", 12.9815, 77.6110, "Commercial Street Junction")
    ]

    for nid, lat, lon, name in nodes_data:
        g.add_node(nid, lat, lon, name)

    # Connect Central & Indiranagar
    g.add_edge("BLR_MG_ROAD", "BLR_BRIGADE_RD", "MG Road & Brigade Rd", "primary", 40)
    g.add_edge("BLR_BRIGADE_RD", "BLR_TRINITY", "MG Road", "primary", 45)
    g.add_edge("BLR_TRINITY", "BLR_HALASURU", "Old Madras Road", "primary", 45)
    g.add_edge("BLR_MG_ROAD", "BLR_CUBBON_KAMARAJ", "Kamaraj Road", "primary", 40)
    g.add_edge("BLR_CUBBON_KAMARAJ", "BLR_ADIGAS_DICKENSON", "Cubbon Road", "primary", 40)
    g.add_edge("BLR_ADIGAS_DICKENSON", "BLR_TRINITY", "Dickenson Road", "primary", 40)
    g.add_edge("BLR_ADIGAS_DICKENSON", "BLR_HALASURU", "Ulsoor Road", "primary", 40)
    g.add_edge("BLR_CUBBON_KAMARAJ", "BLR_COMMERCIAL_ST", "Commercial Street", "secondary", 35)
    g.add_edge("BLR_BRIGADE_RD", "BLR_RESIDENCY_RD", "Brigade Road", "secondary", 35)
    g.add_edge("BLR_HALASURU", "BLR_INDIRANAGAR_100FT", "CMH Road", "secondary", 35)
    g.add_edge("BLR_INDIRANAGAR_100FT", "BLR_INDIRANAGAR_12TH_MAIN", "100 Feet Road Indiranagar", "primary", 40)
    g.add_edge("BLR_INDIRANAGAR_12TH_MAIN", "BLR_DOMLUR_FLYOVER", "100 Feet Road towards Domlur", "primary", 45)
    g.add_edge("BLR_DOMLUR_FLYOVER", "BLR_EGL", "Intermediate Ring Road", "primary", 50)
    g.add_edge("BLR_DOMLUR_FLYOVER", "BLR_KORAMANGALA_80FT", "Intermediate Ring Road South", "primary", 50)
    g.add_edge("BLR_KORAMANGALA_80FT", "BLR_KORAMANGALA_SONY", "80 Feet Road Koramangala", "primary", 40)

    # Destinations
    g.add_destination("blr_mg", "MG Road Boulevard & Metro", "Transit", 12.9756, 77.6066, 96)
    g.add_destination("blr_indiranagar", "Indiranagar 100ft Food & Pubs", "Lifestyle", 12.9784, 77.6408, 98)
    g.add_destination("blr_adigas", "Adigas Junction", "Junction", 12.9763, 77.6147, 95)
    g.add_destination("blr_commercial", "Commercial Street", "Shopping", 12.9815, 77.6110, 93)
    g.add_destination("blr_egl", "Embassy GolfLinks (EGL Tech Park)", "Business", 12.9555, 77.6480, 94)
    g.add_destination("blr_koramangala", "Koramangala Sony World Junction", "Hub", 12.9352, 77.6245, 92)

    return g

ALL_REGIONS = {
    "sf-downtown": create_sf_downtown,
    "ny-midtown": create_ny_midtown,
    "london-westminster": create_london_westminster,
    "blr-tech": create_bengaluru_tech
}

def get_region_graph(region_id: str) -> Optional[RoadGraph]:
    factory = ALL_REGIONS.get(region_id)
    if factory:
        return factory()
    # Check SQLite database for dynamically downloaded custom regions
    try:
        from database import get_db
        import json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM regions WHERE id = ?", (region_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            bbox = {
                "min_lat": row["bbox_min_lat"],
                "min_lon": row["bbox_min_lon"],
                "max_lat": row["bbox_max_lat"],
                "max_lon": row["bbox_max_lon"]
            }
            center = {"lat": row["center_lat"], "lon": row["center_lon"]}
            g = RoadGraph(region_id=row["id"], name=row["name"], bbox=bbox, center=center)
            network_dict = json.loads(row["road_network_json"])
            for nid, ndata in network_dict.get("nodes", {}).items():
                g.add_node(nid, ndata["lat"], ndata["lon"], ndata.get("name", nid), ndata.get("type", "intersection"))
            for e in network_dict.get("edges", []):
                g.add_edge(e["source"], e["target"], e["street"], e.get("road_type", "primary"), e.get("max_speed_kmh", 40.0), bidirectional=False)
            try:
                dest_list = json.loads(row["destinations_json"])
                for d in dest_list:
                    g.add_destination(d["id"], d["name"], d.get("category", "Landmark"), d["lat"], d["lon"], d.get("popularity", 90))
            except Exception:
                pass
            return g
    except Exception as ex:
        print("[RoadNetwork] Failed to load custom region from DB:", ex)
    return None

def build_osm_road_network(name: str, city: str, country: str, bbox: Dict[str, Any], center: Dict[str, Any], origin: Optional[Dict[str, Any]] = None, destination: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Downloads and constructs real OpenStreetMap road-network nodes and edges for any geographical region.
    Integrates OSRM corridor routing and OSM API 0.6 data extraction.
    """
    import requests
    import xml.etree.ElementTree as ET

    min_lat = float(bbox["min_lat"])
    min_lon = float(bbox["min_lon"])
    max_lat = float(bbox["max_lat"])
    max_lon = float(bbox["max_lon"])

    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []
    destinations: List[Dict[str, Any]] = []
    headers = {"User-Agent": "OfflineRouteApp/1.0"}

    # 1. If specific origin and destination are given, fetch the OSRM connecting highway corridor
    if origin and destination:
        try:
            o_lat, o_lon = float(origin["lat"]), float(origin["lon"])
            d_lat, d_lon = float(destination["lat"]), float(destination["lon"])
            osrm_url = f"https://router.project-osrm.org/route/v1/driving/{o_lon:.5f},{o_lat:.5f};{d_lon:.5f},{d_lat:.5f}?overview=full&geometries=geojson&steps=true"
            r = requests.get(osrm_url, headers=headers, timeout=12)
            if r.status_code == 200:
                osrm_data = r.json()
                if osrm_data.get("routes"):
                    route = osrm_data["routes"][0]
                    coords = route["geometry"]["coordinates"]
                    prev_id = None
                    for i, (lon, lat) in enumerate(coords):
                        curr_id = f"corridor_{i}"
                        nodes[curr_id] = {
                            "id": curr_id,
                            "lat": lat,
                            "lon": lon,
                            "name": f"Road Node {i+1}",
                            "type": "intersection"
                        }
                        if prev_id:
                            d = haversine_distance_meters(nodes[prev_id]["lat"], nodes[prev_id]["lon"], lat, lon)
                            edges.append({"source": prev_id, "target": curr_id, "street": "Main Road", "road_type": "primary", "distance_m": round(d, 1), "max_speed_kmh": 50.0})
                            edges.append({"source": curr_id, "target": prev_id, "street": "Main Road", "road_type": "primary", "distance_m": round(d, 1), "max_speed_kmh": 50.0})
                        prev_id = curr_id
        except Exception as e:
            print("[OSM Builder] OSRM corridor warning:", e)

    # 2. Fetch local detailed OpenStreetMap street networks around center and endpoints
    subboxes = []
    lat_span = max_lat - min_lat
    lon_span = max_lon - min_lon

    if lat_span <= 0.05 and lon_span <= 0.05:
        subboxes.append((min_lat, min_lon, max_lat, max_lon))
    else:
        c_lat = float(center["lat"])
        c_lon = float(center["lon"])
        subboxes.append((max(min_lat, c_lat - 0.015), max(min_lon, c_lon - 0.015), min(max_lat, c_lat + 0.015), min(max_lon, c_lon + 0.015)))
        if origin:
            o_lat, o_lon = float(origin["lat"]), float(origin["lon"])
            subboxes.append((o_lat - 0.012, o_lon - 0.012, o_lat + 0.012, o_lon + 0.012))
        if destination:
            d_lat, d_lon = float(destination["lat"]), float(destination["lon"])
            subboxes.append((d_lat - 0.012, d_lon - 0.012, d_lat + 0.012, d_lon + 0.012))

    for s_min_lat, s_min_lon, s_max_lat, s_max_lon in subboxes:
        try:
            osm_url = f"https://api.openstreetmap.org/api/0.6/map?bbox={s_min_lon:.4f},{s_min_lat:.4f},{s_max_lon:.4f},{s_max_lat:.4f}"
            r = requests.get(osm_url, headers=headers, timeout=12)
            if r.status_code == 200:
                root = ET.fromstring(r.content)
                sub_nodes: Dict[str, Dict[str, Any]] = {}
                for node in root.findall("node"):
                    nid = node.attrib["id"]
                    lat = float(node.attrib["lat"])
                    lon = float(node.attrib["lon"])
                    tags = {tag.attrib["k"]: tag.attrib["v"] for tag in node.findall("tag")}
                    sub_nodes[nid] = {"id": nid, "lat": lat, "lon": lon, "name": tags.get("name", f"Node_{nid}"), "type": "intersection"}
                    if "name" in tags and any(k in tags for k in ("amenity", "railway", "tourism", "public_transport", "shop")):
                        destinations.append({
                            "id": f"dest_{nid}",
                            "name": tags["name"],
                            "category": (tags.get("railway") or tags.get("amenity") or "Landmark").title(),
                            "lat": lat,
                            "lon": lon,
                            "popularity": 90
                        })

                for way in root.findall("way"):
                    tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
                    if "highway" in tags:
                        hw = tags["highway"]
                        if hw in ("motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service"):
                            street = tags.get("name", "Road")
                            oneway = tags.get("oneway") in ("yes", "1", "true")
                            speed = 50.0 if hw in ("motorway", "trunk", "primary") else (40.0 if hw in ("secondary", "tertiary") else 30.0)
                            nd_refs = [nd.attrib["ref"] for nd in way.findall("nd")]
                            for i in range(len(nd_refs) - 1):
                                u, v = nd_refs[i], nd_refs[i+1]
                                if u in sub_nodes and v in sub_nodes:
                                    nodes[u] = sub_nodes[u]
                                    nodes[v] = sub_nodes[v]
                                    d = haversine_distance_meters(sub_nodes[u]["lat"], sub_nodes[u]["lon"], sub_nodes[v]["lat"], sub_nodes[v]["lon"])
                                    edges.append({"source": u, "target": v, "street": street, "road_type": hw, "distance_m": round(d, 1), "max_speed_kmh": speed})
                                    if not oneway:
                                        edges.append({"source": v, "target": u, "street": street, "road_type": hw, "distance_m": round(d, 1), "max_speed_kmh": speed})
        except Exception as e:
            print("[OSM Builder] Subbox warning:", e)

    # 3. Ensure endpoints are explicitly connected into the road network graph
    if origin and nodes:
        orig_id = f"origin_{int(float(origin['lat'])*1000)}_{int(float(origin['lon'])*1000)}"
        nodes[orig_id] = {"id": orig_id, "lat": float(origin["lat"]), "lon": float(origin["lon"]), "name": origin.get("name", "Origin"), "type": "origin"}
        closest_id = min(nodes.keys(), key=lambda k: haversine_distance_meters(nodes[k]["lat"], nodes[k]["lon"], nodes[orig_id]["lat"], nodes[orig_id]["lon"]) if k != orig_id else float("inf"))
        cd = haversine_distance_meters(nodes[orig_id]["lat"], nodes[orig_id]["lon"], nodes[closest_id]["lat"], nodes[closest_id]["lon"])
        edges.append({"source": orig_id, "target": closest_id, "street": "Connecting Road", "road_type": "primary", "distance_m": round(cd, 1), "max_speed_kmh": 40.0})
        edges.append({"source": closest_id, "target": orig_id, "street": "Connecting Road", "road_type": "primary", "distance_m": round(cd, 1), "max_speed_kmh": 40.0})
        orig_name = origin.get("name") or "Origin"
        if not any(d.get("name") == orig_name for d in destinations):
            destinations.append({
                "id": orig_id,
                "name": orig_name,
                "category": "Selected Location",
                "lat": float(origin["lat"]),
                "lon": float(origin["lon"]),
                "popularity": 100
            })

    if destination and nodes:
        dest_id = f"dest_{int(float(destination['lat'])*1000)}_{int(float(destination['lon'])*1000)}"
        nodes[dest_id] = {"id": dest_id, "lat": float(destination["lat"]), "lon": float(destination["lon"]), "name": destination.get("name", "Destination"), "type": "destination"}
        closest_id = min(nodes.keys(), key=lambda k: haversine_distance_meters(nodes[k]["lat"], nodes[k]["lon"], nodes[dest_id]["lat"], nodes[dest_id]["lon"]) if k != dest_id else float("inf"))
        cd = haversine_distance_meters(nodes[dest_id]["lat"], nodes[dest_id]["lon"], nodes[closest_id]["lat"], nodes[closest_id]["lon"])
        edges.append({"source": dest_id, "target": closest_id, "street": "Connecting Road", "road_type": "primary", "distance_m": round(cd, 1), "max_speed_kmh": 40.0})
        edges.append({"source": closest_id, "target": dest_id, "street": "Connecting Road", "road_type": "primary", "distance_m": round(cd, 1), "max_speed_kmh": 40.0})
        dest_name = destination.get("name") or "Destination"
        if not any(d.get("name") == dest_name for d in destinations):
            destinations.append({
                "id": dest_id,
                "name": dest_name,
                "category": "Selected Location",
                "lat": float(destination["lat"]),
                "lon": float(destination["lon"]),
                "popularity": 100
            })

    return {
        "nodes": nodes,
        "edges": edges,
        "destinations": destinations[:30]
    }
