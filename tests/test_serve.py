"""The local development server must serve web/ and forbid caching."""

import threading
import urllib.request

import serve


def test_server_serves_web_files_and_forbids_caching():
    server = serve.make_server(port=0)                      # port 0: pick any free port
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        for path, expect in (("/", b"GPS DOP Simulator"), ("/pyloader.js", b"PY_FILES"), ("/sim/presets.py", b"def galileo")):
            response = urllib.request.urlopen(f"http://127.0.0.1:{port}{path}")
            assert response.status == 200
            assert response.headers["Cache-Control"] == "no-store"
            assert expect in response.read()
    finally:
        server.shutdown()
        server.server_close()
