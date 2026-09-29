#!/bin/bash
# RUBENS — the pages on port 8766 and the board on USB, one program (rubens.py)
cd "$(dirname "$0")"
(sleep 1; open http://localhost:8766) &
exec python3 rubens.py
