import http.server
import socketserver
import webbrowser
import os
import json
from regulations import RegulationsFinder
from energy import calculate_energy_for_panels
from solar_viability import analyze_solar_viability

PORT = 8000
reg_finder = RegulationsFinder()


class SolarRequestHandler(http.server.SimpleHTTPRequestHandler):

    def do_POST(self):
        # 1. API: Get Regulations (AI)
        if self.path == '/api/get-regulations':
            self.handle_api(self.get_regulations)

        # 2. API: Get Energy (NASA Math)
        elif self.path == '/api/get-energy':
            self.handle_api(self.get_energy)

        # 3. API: Analyze Viability (Python Script)
        elif self.path == '/api/analyze-viability':
            # FIX 1: Correct Indentation here
            self.handle_api(self.run_viability_check)

        else:
            self.send_error(404, "Route not found")

    def handle_api(self, func):
        """Helper to handle JSON inputs and outputs"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)

            # FIX 3: Decode bytes to string before parsing JSON
            data = json.loads(post_data.decode('utf-8'))

            # Run the specific function
            result = func(data)

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            # FIX 2: Removed manual 'Access-Control-Allow-Origin' here
            # because end_headers() handles it automatically below.
            self.end_headers()
            self.wfile.write(json.dumps(result).encode('utf-8'))
        except Exception as e:
            print(f"Server Error: {e}")
            self.send_response(500)
            self.end_headers()

    # --- LOGIC HANDLERS ---
    def get_regulations(self, data):
        print(f"🤖 AI Fetching Regulations for {data.get('lat')}, {data.get('lon')}")
        return reg_finder.find_regulations(data.get('lat'), data.get('lon'))

    def get_energy(self, data):
        lat = data.get('lat')
        lon = data.get('lon')
        # FIX 4: Safety default if area is missing
        area = data.get('area', 10)

        print(f"☀️ NASA Calculating Energy for {lat}, {lon} (Area: {area}m²)")

        panel_types = {
            "Standard (Poly)": 0.16,
            "Premium (Mono)": 0.21,
            "Next-Gen (Perc)": 0.24
        }

        return calculate_energy_for_panels(lat, lon, panel_types, area)

    def run_viability_check(self, data):
        lat = data.get('lat')
        lon = data.get('lon')
        print(f"📡 Running Solar Viability Scan for {lat}, {lon}...")
        return analyze_solar_viability(lat, lon)

    def end_headers(self):
        # This handles CORS globally for all responses
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    try:
        # Allow reusing the address to prevent "Port already in use" errors during restarts
        socketserver.TCPServer.allow_reuse_address = True
        with socketserver.TCPServer(("", PORT), SolarRequestHandler) as httpd:
            print(f"🚀 SolarPro Engine Active at http://localhost:{PORT}")
            # Optional: Open browser automatically
            # webbrowser.open(f"http://localhost:{PORT}/index.html")
            httpd.serve_forever()
    except OSError:
        print(f"⚠️ Port {PORT} is busy. Please stop the other python process.")