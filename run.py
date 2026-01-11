import http.server
import socketserver
import os
import json
import sys
from pathlib import Path

# Add src directory to path for imports
BASE_DIR = Path(__file__).parent
sys.path.insert(0, str(BASE_DIR / "src"))

from src.regulations import RegulationsFinder
from src.energy import predict_solar_production
from src.solar_viability import analyze_solar_viability

PORT = 8000
reg_finder = RegulationsFinder()
WEB_DIR = BASE_DIR / "web"


class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True


class SolarRequestHandler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.serve_file('index.html', 'text/html')
        elif self.path.startswith('/api/'):
            self.send_error(404, "Route not found")
        else:
            filename = self.path.lstrip('/')
            filepath = WEB_DIR / filename
            if filepath.exists() and filepath.is_file() and filepath.parent == WEB_DIR:
                content_type = self.guess_content_type(filename)
                self.serve_file(filename, content_type)
            else:
                self.send_error(404, "File not found")

    def serve_file(self, filename, content_type):
        try:
            filepath = WEB_DIR / filename
            with open(filepath, 'rb') as f:
                content = f.read()
            
            self.send_response(200)
            self.send_header('Content-type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            print(f"Error serving file {filename}: {e}", flush=True)
            self.send_error(500, "Internal server error")

    def guess_content_type(self, filename):
        if filename.endswith('.html'):
            return 'text/html'
        elif filename.endswith('.css'):
            return 'text/css'
        elif filename.endswith('.js'):
            return 'application/javascript'
        elif filename.endswith('.json'):
            return 'application/json'
        elif filename.endswith('.png'):
            return 'image/png'
        elif filename.endswith('.jpg') or filename.endswith('.jpeg'):
            return 'image/jpeg'
        elif filename.endswith('.svg'):
            return 'image/svg+xml'
        else:
            return 'application/octet-stream'

    def do_POST(self):
        if self.path == '/api/get-regulations':
            self.handle_api(self.get_regulations)
        elif self.path == '/api/get-energy':
            self.handle_api(self.get_energy)
        elif self.path == '/api/predict-energy':
            self.handle_api(self.run_prediction)
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
            print(f"Server Error: {e}", flush=True)
            self.send_response(500)
            self.end_headers()

    def get_regulations(self, data):
        print(f"Fetching regulations for location...", flush=True)
        return reg_finder.find_regulations(data.get('lat'), data.get('lon'))

    def run_prediction(self, data):
        lat = data.get('lat')
        lon = data.get('lon')
        capacity = data.get('capacity_kw', 5.0)
        score = data.get('score', "MODERATE")
        cost = data.get('system_cost', 0)
        maint = data.get('maintenance', 0)
        rate = data.get('rate', 0.14)

        print(f"Predicting energy production: {lat}, {lon} | Size: {capacity}kW | Cost: {cost}", flush=True)
        return predict_solar_production(lat, lon, capacity, score, cost, maint, rate)

    def get_energy(self, data):
        return {"success": True}

    def run_viability_check(self, data):
        print(f"Analyzing solar viability...", flush=True)
        return analyze_solar_viability(data.get('lat'), data.get('lon'))

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    try:
        ThreadingHTTPServer.allow_reuse_address = True
        with ThreadingHTTPServer(("", PORT), SolarRequestHandler) as httpd:
            print(f"SolAI Engine Active at http://localhost:{PORT}", flush=True)
            print(f"Multi-threading enabled", flush=True)
            httpd.serve_forever()
    except OSError:
        print(f"Port {PORT} is busy. Stop other python processes.", flush=True)
