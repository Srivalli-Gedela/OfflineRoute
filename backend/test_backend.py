"""
Verification test suite for OfflineRoute Backend APIs:
Tests HTTP Caching, Conditional GET (304), Road Network Routing, Offline Sync, and ETag revalidation.
"""
import unittest
import json
from app import app
from database import init_db

class TestOfflineRouteBackend(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_health_check(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "online")
        self.assertIn("X-Response-Time", resp.headers)

    def test_regions_and_conditional_get(self):
        # Initial request: should be 200 OK with ETag
        resp1 = self.client.get("/api/regions")
        self.assertEqual(resp1.status_code, 200)
        etag = resp1.headers.get("ETag")
        self.assertIsNotNone(etag)
        data = resp1.get_json()
        self.assertGreaterEqual(len(data), 4)

        # Conditional GET with If-None-Match: should return 304 Not Modified!
        resp2 = self.client.get("/api/regions", headers={"If-None-Match": etag})
        self.assertEqual(resp2.status_code, 304)
        self.assertEqual(resp2.headers.get("X-Cache-Status"), "REVALIDATED_304")
        self.assertEqual(len(resp2.data), 0)

    def test_region_download_and_etag(self):
        resp1 = self.client.get("/api/regions/sf-downtown")
        self.assertEqual(resp1.status_code, 200)
        etag = resp1.headers.get("ETag")
        data = resp1.get_json()
        self.assertEqual(data["region_id"], "sf-downtown")
        self.assertIn("road_network", data)
        self.assertIn("nodes", data["road_network"])

        # Re-fetch with ETag
        resp2 = self.client.get("/api/regions/sf-downtown", headers={"If-None-Match": etag})
        self.assertEqual(resp2.status_code, 304)

    def test_route_calculation_and_caching(self):
        payload = {
            "origin": {"name": "Ferry Building", "lat": 37.7955, "lon": -122.3937},
            "destination": {"name": "Moscone Center", "lat": 37.7842, "lon": -122.4015},
            "mode": "driving"
        }
        resp1 = self.client.post("/api/route", json=payload)
        self.assertEqual(resp1.status_code, 200)
        data = resp1.get_json()
        self.assertIn("geometry", data)
        self.assertIn("steps", data)
        self.assertGreater(data["distance_km"], 0)
        etag = resp1.headers.get("ETag")
        self.assertIsNotNone(etag)

        # Re-request with ETag -> should return 304 Not Modified
        resp2 = self.client.post("/api/route", json=payload, headers={"If-None-Match": etag})
        self.assertEqual(resp2.status_code, 304)

    def test_offline_sync(self):
        sync_payload = {
            "client_id": "test_device_1",
            "events": [
                {
                    "type": "offline_route_calculated",
                    "payload": {
                        "route_id": "offline_route_999",
                        "origin": {"name": "Union Square", "lat": 37.7879, "lon": -122.4075},
                        "destination": {"name": "Dragon Gate", "lat": 37.7907, "lon": -122.4057},
                        "distance_km": 0.45,
                        "duration_min": 1.5,
                        "geometry": {"type": "LineString", "coordinates": [[-122.4075, 37.7879], [-122.4057, 37.7907]]},
                        "steps": []
                    }
                }
            ]
        }
        resp = self.client.post("/api/sync", json=sync_payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "synchronized")
        self.assertEqual(data["synced_events_count"], 1)

    def test_network_stats(self):
        resp = self.client.get("/api/network/stats")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("http_caching", data)
        self.assertIn("transport_layer", data)

if __name__ == "__main__":
    unittest.main()
