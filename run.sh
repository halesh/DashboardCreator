#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
source venv/bin/activate 2>/dev/null || source ../venv/bin/activate 2>/dev/null || true
pip install -q -r requirements.txt
echo "Starting Flask + AngularJS DashboardCreator on http://localhost:5000 ..."
python app.py
