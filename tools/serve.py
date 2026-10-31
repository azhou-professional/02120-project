"""Local development server for the web app.

Same as `python3 -m http.server` in web/, plus a `Cache-Control: no-store` header, so the
browser never reuses an old copy of a JavaScript or Python file after it changed. (Python's
plain server sends no cache instructions, and browsers then keep old JavaScript modules, which
shows up as errors from code you already fixed.)

Run from anywhere:   python3 tools/serve.py [port]        (default port 8000)
"""

import http.server
import sys
from functools import partial
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def make_server(port=8000, directory=WEB):
    """A threaded server for `directory` (the browser makes several requests at once)."""
    handler = partial(NoCacheHandler, directory=str(directory))
    return http.server.ThreadingHTTPServer(("", port), handler)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    with make_server(port) as server:
        print(f"Serving {WEB} at http://localhost:{port}  (no caching; Ctrl+C to stop)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print()
