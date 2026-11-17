/**
 * Client-Side Offline Routing Engine.
 * Runs A* and Dijkstra pathfinding locally in the browser on road-network graphs
 * downloaded and stored in IndexedDB. Works 100% offline with ZERO network calls.
 */
import { getAllRegions, saveRoute, enqueueSyncEvent } from './indexedDB.js';

// Haversine formula in JS
export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radius of Earth in meters
  const dLat = (lat2 - lat1) * Math.PI / 180.0;
  const dLon = (lon2 - lon1) * Math.PI / 180.0;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180.0) * Math.cos(lat2 * Math.PI / 180.0) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Bearing calculation in JS (0 to 360 degrees)
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180.0;
  const phi2 = lat2 * Math.PI / 180.0;
  const dLon = (lon2 - lon1) * Math.PI / 180.0;

  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180.0 / Math.PI + 360.0) % 360.0;
  return bearing;
}

// Snapping arbitrary coordinates to closest road network node
export function snapToNearestNode(lat, lon, nodes) {
  let closestNodeId = null;
  let minDistance = Infinity;

  for (const [nodeId, node] of Object.entries(nodes)) {
    const d = haversineDistanceMeters(lat, lon, node.lat, node.lon);
    if (d < minDistance) {
      minDistance = d;
      closestNodeId = nodeId;
    }
  }

  return { nodeId: closestNodeId, distanceMeters: minDistance };
}

// Priority Queue implementation for A* in browser
class PriorityQueue {
  constructor() {
    this.elements = [];
  }
  enqueue(element, priority) {
    this.elements.push({ element, priority });
    this.elements.sort((a, b) => a.priority - b.priority);
  }
  dequeue() {
    return this.elements.shift()?.element;
  }
  isEmpty() {
    return this.elements.length === 0;
  }
}

/**
 * A* Pathfinding Algorithm on client-side graph
 */
export function aStarRouting(nodes, edges, startNodeId, endNodeId, mode = 'driving', origin = null, dest = null) {
  if (!nodes[startNodeId] || !nodes[endNodeId]) {
    return null;
  }

  const speedDefaults = {
    driving: 40.0,
    cycling: 18.0,
    walking: 4.5
  };
  const modeSpeed = speedDefaults[mode] || 40.0;

  // Build adjacency list from edges list
  const adj = {};
  for (const nodeId of Object.keys(nodes)) {
    adj[nodeId] = [];
  }
  for (const edge of edges) {
    if (adj[edge.source]) {
      adj[edge.source].push(edge);
    }
  }

  const targetNode = nodes[endNodeId];
  function heuristic(nodeId) {
    const n = nodes[nodeId];
    const distM = haversineDistanceMeters(n.lat, n.lon, targetNode.lat, targetNode.lon);
    const speedMps = modeSpeed * 1000.0 / 3600.0;
    return distM / speedMps;
  }

  const pq = new PriorityQueue();
  pq.enqueue({
    current: startNodeId,
    path: [startNodeId],
    edgesTaken: [],
    g: 0
  }, heuristic(startNodeId));

  const gScores = { [startNodeId]: 0 };
  const visited = new Set();

  while (!pq.isEmpty()) {
    const item = pq.dequeue();
    const { current, path, edgesTaken, g } = item;

    if (current === endNodeId) {
      return buildRouteDetails(nodes, path, edgesTaken, mode, origin, dest);
    }

    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adj[current] || [];
    for (const edge of neighbors) {
      const neighbor = edge.target;
      const speed = mode === 'driving' ? (edge.max_speed_kmh || modeSpeed) : modeSpeed;
      const speedMps = Math.max(1.0, speed * 1000.0 / 3600.0);
      const travelTimeSec = edge.distance_m / speedMps;

      const tentativeG = g + travelTimeSec;

      if (tentativeG < (gScores[neighbor] ?? Infinity)) {
        gScores[neighbor] = tentativeG;
        const fScore = tentativeG + heuristic(neighbor);
        pq.enqueue({
          current: neighbor,
          path: [...path, neighbor],
          edgesTaken: [...edgesTaken, edge],
          g: tentativeG
        }, fScore);
      }
    }
  }

  return null;
}

function buildRouteDetails(nodes, path, edgesTaken, mode, origin = null, dest = null) {
  const coordinates = [];
  let totalDistanceM = 0;
  let totalDurationSec = 0;

  const speedDefaults = { driving: 40.0, cycling: 18.0, walking: 4.5 };
  const modeSpeed = speedDefaults[mode] || 40.0;

  for (const edge of edgesTaken) {
    totalDistanceM += edge.distance_m;
    const speed = mode === 'driving' ? (edge.max_speed_kmh || modeSpeed) : modeSpeed;
    totalDurationSec += edge.distance_m / Math.max(1.0, speed * 1000.0 / 3600.0);
  }

  // Connect origin point to the start node (first-mile connection)
  if (origin && origin.lat != null && origin.lon != null) {
    const firstNode = nodes[path[0]];
    const startDistM = haversineDistanceMeters(origin.lat, origin.lon, firstNode.lat, firstNode.lon);
    if (startDistM > 0.01) {
      coordinates.push([Number(origin.lon), Number(origin.lat)]);
      totalDistanceM += startDistM;
      totalDurationSec += startDistM / Math.max(1.0, modeSpeed * 1000.0 / 3600.0);
    }
  }

  // Intermediate road network intersection nodes
  for (let i = 0; i < path.length; i++) {
    const node = nodes[path[i]];
    coordinates.push([node.lon, node.lat]);
  }

  // Connect last node to destination point (last-mile connection to Marker B)
  if (dest && dest.lat != null && dest.lon != null) {
    const lastNode = nodes[path[path.length - 1]];
    const endDistM = haversineDistanceMeters(lastNode.lat, lastNode.lon, dest.lat, dest.lon);
    if (endDistM > 0.01) {
      coordinates.push([Number(dest.lon), Number(dest.lat)]);
      totalDistanceM += endDistM;
      totalDurationSec += endDistM / Math.max(1.0, modeSpeed * 1000.0 / 3600.0);
    }
  }

  const steps = [];
  for (let i = 0; i < edgesTaken.length; i++) {
    const uNode = nodes[path[i]];
    const vNode = nodes[path[i + 1]];
    const edge = edgesTaken[i];
    const bearing = calculateBearing(uNode.lat, uNode.lon, vNode.lat, vNode.lon);

    let instruction = '';
    let modifier = 'straight';

    if (i === 0) {
      instruction = `Head on ${edge.street}`;
      modifier = 'depart';
    } else {
      const prevUNode = nodes[path[i - 1]];
      const prevBearing = calculateBearing(prevUNode.lat, prevUNode.lon, uNode.lat, uNode.lon);
      let diff = (bearing - prevBearing + 360.0) % 360.0;
      if (diff > 180) diff -= 360.0;

      if (Math.abs(diff) < 25) {
        instruction = `Continue straight onto ${edge.street}`;
        modifier = 'straight';
      } else if (diff >= 25 && diff < 65) {
        instruction = `Turn slight right onto ${edge.street}`;
        modifier = 'slight-right';
      } else if (diff >= 65 && diff <= 125) {
        instruction = `Turn right onto ${edge.street}`;
        modifier = 'turn-right';
      } else if (diff > 125) {
        instruction = `Sharp right onto ${edge.street}`;
        modifier = 'sharp-right';
      } else if (diff > -65 && diff <= -25) {
        instruction = `Turn slight left onto ${edge.street}`;
        modifier = 'slight-left';
      } else if (diff >= -125 && diff <= -65) {
        instruction = `Turn left onto ${edge.street}`;
        modifier = 'turn-left';
      } else {
        instruction = `Sharp left onto ${edge.street}`;
        modifier = 'sharp-left';
      }
    }

    steps.push({
      step_index: i + 1,
      street: edge.street,
      instruction,
      modifier,
      distance_m: Math.round(edge.distance_m),
      duration_sec: Math.round(edge.distance_m / Math.max(1.0, (edge.max_speed_kmh || modeSpeed) * 1000.0 / 3600.0)),
      location: [uNode.lon, uNode.lat]
    });
  }

  // Arrival step directly at destination point
  const lastNode = nodes[path[path.length - 1]];
  const arrivalLocation = (dest && dest.lat != null && dest.lon != null)
    ? [Number(dest.lon), Number(dest.lat)]
    : [lastNode.lon, lastNode.lat];

  steps.push({
    step_index: steps.length + 1,
    street: edgesTaken[edgesTaken.length - 1]?.street || 'Destination',
    instruction: `Arrive at ${dest?.name || lastNode.name}`,
    modifier: 'arrive',
    distance_m: 0,
    duration_sec: 0,
    location: arrivalLocation
  });

  return {
    distance_km: Number((totalDistanceM / 1000.0).toFixed(2)),
    duration_min: Number((totalDurationSec / 60.0).toFixed(1)),
    coordinates,
    steps,
    path_nodes: path
  };
}

/**
 * Checks if a coordinate falls within any downloaded region's bounding box
 */
export function isPointInsideBBox(lat, lon, bbox) {
  if (!bbox) return false;
  const minLat = bbox.min_lat !== undefined ? bbox.min_lat : bbox.bbox_min_lat;
  const maxLat = bbox.max_lat !== undefined ? bbox.max_lat : bbox.bbox_max_lat;
  const minLon = bbox.min_lon !== undefined ? bbox.min_lon : bbox.bbox_min_lon;
  const maxLon = bbox.max_lon !== undefined ? bbox.max_lon : bbox.bbox_max_lon;
  if (minLat == null || maxLat == null || minLon == null || maxLon == null) return false;
  return (
    lat >= minLat &&
    lat <= maxLat &&
    lon >= minLon &&
    lon <= maxLon
  );
}

/**
 * Finds which downloaded region covers the coordinates and connecting road network
 */
export async function findCoveringDownloadedRegion(origin, dest, regionsList = null) {
  if (!origin || !dest || origin.lat == null || origin.lon == null || dest.lat == null || dest.lon == null) {
    return {
      covered: false,
      reason: 'INVALID_COORDINATES',
      message: 'Destination outside offline coverage. Connect to the internet or download the required region.'
    };
  }

  const downloadedRegions = regionsList || (await getAllRegions());
  if (!downloadedRegions || downloadedRegions.length === 0) {
    return {
      covered: false,
      reason: 'NO_REGIONS_DOWNLOADED',
      message: 'Destination outside offline coverage. Connect to the internet or download the required region.'
    };
  }

  for (const reg of downloadedRegions) {
    const bbox = reg.bbox || {
      min_lat: reg.bbox_min_lat,
      min_lon: reg.bbox_min_lon,
      max_lat: reg.bbox_max_lat,
      max_lon: reg.bbox_max_lon
    };

    const originInside = isPointInsideBBox(origin.lat, origin.lon, bbox);
    const destInside = isPointInsideBBox(dest.lat, dest.lon, bbox);

    if (originInside && destInside) {
      // Validate road network exists and covers the locations
      const roadNetwork = reg.road_network || reg;
      const nodes = roadNetwork?.nodes;
      const edges = roadNetwork?.edges;

      if (!nodes || !edges || Object.keys(nodes).length === 0 || edges.length === 0) {
        continue;
      }

      const startSnap = snapToNearestNode(origin.lat, origin.lon, nodes);
      const endSnap = snapToNearestNode(dest.lat, dest.lon, nodes);

      // Snapping threshold to road intersection (max 5000 meters)
      if (!startSnap?.nodeId || !endSnap?.nodeId || startSnap.distanceMeters > 5000 || endSnap.distanceMeters > 5000) {
        continue;
      }

      return {
        covered: true,
        region: reg,
        startSnap,
        endSnap
      };
    }
  }

  return {
    covered: false,
    reason: 'DESTINATION_OUT_OF_COVERAGE',
    message: 'Destination outside offline coverage. Connect to the internet or download the required region.'
  };
}

export async function validateOfflineCoverage(origin, dest, regionsList = null) {
  return await findCoveringDownloadedRegion(origin, dest, regionsList);
}

/**
 * Master Offline Route Calculation Function.
 * Seamlessly resolves offline pathfinding using IndexedDB road-network data.
 */
export async function calculateOfflineRoute(origin, dest, mode = 'driving', regionsList = null) {
  const coverageCheck = await findCoveringDownloadedRegion(origin, dest, regionsList);
  if (!coverageCheck.covered) {
    return {
      success: false,
      error: 'Destination outside offline coverage. Connect to the internet or download the required region.',
      reason: coverageCheck.reason,
      coverageCheck
    };
  }

  const region = coverageCheck.region;
  const roadNetwork = region.road_network || region;
  const nodes = roadNetwork.nodes;
  const edges = roadNetwork.edges;

  if (!nodes || !edges) {
    return {
      success: false,
      error: 'Destination outside offline coverage. Connect to the internet or download the required region.'
    };
  }

  const startSnap = coverageCheck.startSnap || snapToNearestNode(origin.lat, origin.lon, nodes);
  const endSnap = coverageCheck.endSnap || snapToNearestNode(dest.lat, dest.lon, nodes);

  if (!startSnap?.nodeId || !endSnap?.nodeId) {
    return {
      success: false,
      error: 'Destination outside offline coverage. Connect to the internet or download the required region.'
    };
  }

  const routeResult = aStarRouting(nodes, edges, startSnap.nodeId, endSnap.nodeId, mode, origin, dest);
  if (!routeResult) {
    return {
      success: false,
      error: 'Destination outside offline coverage. Connect to the internet or download the required region.'
    };
  }

  const routePayload = {
    route_id: `offline_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    region_id: region.region_id || region.id,
    origin: {
      name: origin.name || nodes[startSnap.nodeId]?.name || 'Origin',
      lat: origin.lat,
      lon: origin.lon
    },
    destination: {
      name: dest.name || nodes[endSnap.nodeId]?.name || 'Destination',
      lat: dest.lat,
      lon: dest.lon
    },
    mode,
    distance_km: routeResult.distance_km,
    duration_min: routeResult.duration_min,
    geometry: {
      type: 'LineString',
      coordinates: routeResult.coordinates
    },
    steps: routeResult.steps,
    path_nodes: routeResult.path_nodes,
    routing_engine: `Client-Side Offline A* Engine (${region.name})`,
    is_offline: true,
    cache_status: 'OFFLINE_GENERATED',
    created_at: new Date().toISOString()
  };

  // Cache locally if saveRoute is available
  try {
    await saveRoute(routePayload);
    await enqueueSyncEvent('offline_route_calculated', routePayload);
  } catch {
    // Non-blocking in headless / testing environments
  }

  return {
    success: true,
    route: routePayload
  };
}
