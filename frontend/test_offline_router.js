/**
 * Node.js Test script to verify the client-side offline routing engine.
 * Tests A*, snapping, bearing calculation, turn instructions, and boundary checks.
 */
import {
  haversineDistanceMeters,
  calculateBearing,
  snapToNearestNode,
  aStarRouting,
  isPointInsideBBox
} from './src/services/offlineRouter.js';

console.log('--- TESTING CLIENT-SIDE OFFLINE ROUTING ENGINE ---');

// 1. Test Haversine Distance
const d = haversineDistanceMeters(37.7955, -122.3937, 37.7842, -122.4015);
console.log(`[PASS] Haversine Distance (Ferry Bldg to Moscone): ${Math.round(d)} meters (~1400m expected)`);
if (d < 1000 || d > 2000) throw new Error('Haversine distance calculation error');

// 2. Test Bearing Calculation
const bearing = calculateBearing(37.7940, -122.3955, 37.7885, -122.4020);
console.log(`[PASS] Bearing calculation: ${Math.round(bearing)} deg (Southwest expected ~220-240 deg)`);
if (bearing < 200 || bearing > 260) throw new Error('Bearing calculation error');

// 3. Test Road Graph & A* Pathfinding
const testNodes = {
  'A': { id: 'A', lat: 37.7955, lon: -122.3937, name: 'Ferry Building' },
  'B': { id: 'B', lat: 37.7925, lon: -122.3975, name: 'Market & Beale' },
  'C': { id: 'C', lat: 37.7885, lon: -122.4020, name: 'Market & 2nd' },
  'D': { id: 'D', lat: 37.7842, lon: -122.4015, name: 'Moscone Center' }
};

const testEdges = [
  { source: 'A', target: 'B', street: 'Market Street', distance_m: 450, max_speed_kmh: 35 },
  { source: 'B', target: 'A', street: 'Market Street', distance_m: 450, max_speed_kmh: 35 },
  { source: 'B', target: 'C', street: 'Market Street', distance_m: 550, max_speed_kmh: 35 },
  { source: 'C', target: 'B', street: 'Market Street', distance_m: 550, max_speed_kmh: 35 },
  { source: 'C', target: 'D', street: '3rd Street', distance_m: 480, max_speed_kmh: 35 },
  { source: 'D', target: 'C', street: '3rd Street', distance_m: 480, max_speed_kmh: 35 }
];

// Snapping test
const snap = snapToNearestNode(37.7954, -122.3936, testNodes);
console.log(`[PASS] Snapping coordinate to nearest node: Snapped to ${snap.nodeId} (${Math.round(snap.distanceMeters)}m)`);
if (snap.nodeId !== 'A') throw new Error('Snapping failed');

// Route test A -> D
const route = aStarRouting(testNodes, testEdges, 'A', 'D', 'driving');
console.log(`[PASS] A* Route Calculated: Distance = ${route.distance_km} km, Time = ${route.duration_min} min, Steps = ${route.steps.length}`);
if (!route || route.distance_km !== 1.48 || route.steps.length !== 4) {
  throw new Error('A* routing result mismatch');
}
console.log('Turn Instructions generated:');
route.steps.forEach(s => console.log(`   Step ${s.step_index}: ${s.instruction} (${s.distance_m}m)`));

// 4. Test Bounding Box Coverage Check
const sfBbox = { min_lat: 37.77, min_lon: -122.425, max_lat: 37.808, max_lon: -122.388 };
const inside = isPointInsideBBox(37.79, -122.40, sfBbox);
const outside = isPointInsideBBox(40.75, -73.98, sfBbox); // NYC point
console.log(`[PASS] Coverage check inside: ${inside}, outside: ${!outside}`);
if (!inside || outside) throw new Error('Bounding box coverage check failed');

console.log('--- ALL CLIENT-SIDE ROUTING ENGINE TESTS PASSED ---');
