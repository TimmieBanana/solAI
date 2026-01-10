import http.server
import socketserver
import webbrowser
import os
import json
from regulations import RegulationsFinder
from energy import predict_solar_production
from solar_viability import analyze_solar_viability

PORT = 8000
reg_finder = RegulationsFinder()


# --- FIX: ENABLE MULTI-THREADING ---
class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True


class SolarRequestHandler(http.server.SimpleHTTPRequestHandler):

    def do_POST(self):
        # 1. API: Get Regulations (AI)
        if self.path == '/api/get-regulations':
            self.handle_api(self.get_regulations)

        # 2. API: Get Energy (NASA Math)
        elif self.path == '/api/get-energy':
            self.handle_api(self.get_energy)

        # 3. API: Predict Future (ML Model)
        elif self.path == '/api/predict-energy':
            self.handle_api(self.run_prediction)

        # 4. API: Analyze Viability (Python Script)
        elif self.path == '/api/analyze-viability':
            self.handle_api(self.run_viability_check)

        else:
            self.send_error(404, "Route not found")

    def handle_api(self, func):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            result = func(data)

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode('utf-8'))
        except Exception as e:
            print(f"Server Error: {e}")
            self.send_response(500)
            self.end_headers()

    # --- LOGIC HANDLERS ---
    def get_regulations(self, data):
        print(f"🤖 AI Fetching Regulations...")
        return reg_finder.find_regulations(data.get('lat'), data.get('lon'))

    def run_prediction(self, data):
        print(f"🔮 Training ML Model...")
        return predict_solar_production(data.get('lat'), data.get('lon'))

    def get_energy(self, data):
        # Simple Math (Very Fast)
        return {"success": True}

    def run_viability_check(self, data):
        print(f"📡 Downloading 3D Map Data...")
        return analyze_solar_viability(data.get('lat'), data.get('lon'))

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    try:
        # Use ThreadingHTTPServer instead of TCPServer
        ThreadingHTTPServer.allow_reuse_address = True
        with ThreadingHTTPServer(("", PORT), SolarRequestHandler) as httpd:
            print(f"🚀 SolarPro Enterprise Active at http://localhost:{PORT}")
            print(f"⚡ Multi-Threading Enabled (Parallel Processing)")
            # webbrowser.open(f"http://localhost:{PORT}/index.html")
            httpd.serve_forever()
    except OSError:
        print(f"⚠️ Port {PORT} is busy. Stop other python processes.")