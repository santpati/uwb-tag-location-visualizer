#!/usr/bin/env python3
"""
CORS Proxy Server for Cisco Spaces Firehose API
Allows browser-based apps to access the Firehose API
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import json

# Firehose API configuration
FIREHOSE_ENDPOINT = "https://partner.qa-dnaspaces.io/api/partners/v1/firehose/events"
FIREHOSE_API_KEY = "9981B867E2B0456CB1F1909BD617982C"

class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/firehose':
            self.proxy_firehose()
        else:
            self.send_error(404, "Not Found")

    def proxy_firehose(self):
        """Proxy requests to Firehose API with streaming support"""
        try:
            # Create request to Firehose API
            req = urllib.request.Request(
                FIREHOSE_ENDPOINT,
                headers={
                    'X-API-Key': FIREHOSE_API_KEY,
                    'Accept': 'application/json'
                }
            )

            # Open connection to Firehose API
            print(f"Connecting to Firehose API...")
            response = urllib.request.urlopen(req)

            # Send headers to client
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')  # Enable CORS
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()

            print("Connected! Streaming data...")

            # Stream data from Firehose API to client
            event_count = 0
            try:
                while True:
                    chunk = response.read(1024)  # Read in chunks
                    if not chunk:
                        break

                    self.wfile.write(chunk)
                    self.wfile.flush()

                    # Count events for logging
                    event_count += chunk.count(b'\n')
                    if event_count % 10 == 0:
                        print(f"Streamed {event_count} events...")

            except BrokenPipeError:
                print("Client disconnected")
            except Exception as e:
                print(f"Streaming error: {e}")

        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            print(f"Firehose API error: {e.code} - {error_body}")
            self.send_error(e.code, f"Firehose API error: {error_body}")
        except Exception as e:
            print(f"Proxy error: {e}")
            self.send_error(500, f"Proxy error: {str(e)}")

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        """Custom logging to reduce noise"""
        if '200' in str(args):
            return  # Skip success logs to reduce clutter
        print(f"[{self.log_date_time_string()}] {format % args}")

if __name__ == '__main__':
    PORT = 8081
    server = HTTPServer(('localhost', PORT), ProxyHandler)
    print(f"")
    print(f"=" * 60)
    print(f"CORS Proxy Server for Cisco Spaces Firehose API")
    print(f"=" * 60)
    print(f"")
    print(f"Proxy running at: http://localhost:{PORT}/firehose")
    print(f"Firehose endpoint: {FIREHOSE_ENDPOINT}")
    print(f"API Key: {FIREHOSE_API_KEY[:8]}...")
    print(f"")
    print(f"Press Ctrl+C to stop")
    print(f"")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\nShutting down proxy server...")
        server.shutdown()
