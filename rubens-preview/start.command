#!/bin/bash
# RUBENS — the pages on port 8766 (rubens.py; machine commands go to the bridge on 8765)
cd "$(dirname "$0")"
(sleep 1; open http://localhost:8766) &
exec python3 rubens.py
