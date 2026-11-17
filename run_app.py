"""
OfflineRoute - Universal Runner Script
Launches the full-stack Hybrid Offline Navigation System.
Serves both backend APIs and React frontend on http://127.0.0.1:5000.
"""
import os
import sys
import webbrowser
import subprocess
import time

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(PROJECT_DIR, "backend")
FRONTEND_DIST = os.path.join(PROJECT_DIR, "frontend", "dist")

def main():
    print("=" * 70)
    print(" OfflineRoute – Hybrid Offline Navigation System")
    print(" Tech Stack: React.js, Flask, SQLite, Leaflet, OpenStreetMap, IndexedDB")
    print(" Computer Networks Focus: HTTP Caching (ETag/304), TCP, DNS, Offline A*")
    print("=" * 70)

    # 1. Check frontend dist build
    if not os.path.exists(os.path.join(FRONTEND_DIST, "index.html")):
        print("\n[INFO] Building frontend production bundle with Vite...")
        subprocess.run(["npm", "run", "build"], cwd=os.path.join(PROJECT_DIR, "frontend"), shell=True, check=True)

    # 2. Initialize and Seed database if needed
    db_file = os.path.join(BACKEND_DIR, "offlineroute.db")
    if not os.path.exists(db_file):
        print("\n[INFO] Seeding SQLite database with regional road networks...")
        subprocess.run([sys.executable, "seed_data.py"], cwd=BACKEND_DIR, check=True)

    print("\n[INFO] Starting full-stack application server on http://127.0.0.1:5000...")
    print("[INFO] Press Ctrl+C to terminate.")

    # Optional: auto-open browser after 1.5s
    def open_browser():
        time.sleep(1.5)
        webbrowser.open("http://127.0.0.1:5000")

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    # 3. Launch Flask server
    subprocess.run([sys.executable, "app.py"], cwd=BACKEND_DIR)

if __name__ == "__main__":
    main()
