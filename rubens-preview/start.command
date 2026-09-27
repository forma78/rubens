#!/bin/bash
# RUBENS · Brush Preview — локальный сервер на 8766
cd "$(dirname "$0")"
(sleep 1; open http://localhost:8766) &
python3 -m http.server 8766
