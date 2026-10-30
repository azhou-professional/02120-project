#!/bin/bash

. /home/ship/CMU/02-120_ProgrammingForScientists/Python/.venv/bin/activate

echo "Link: localhost:8000"
python3 -m http.server 8000 -d web



