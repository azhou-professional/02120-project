#!/bin/bash
# Serve the web app at http://localhost:8000 (no caching, so reloads always show the latest code).
cd "$(dirname "$0")"
python3 tools/serve.py 3000
