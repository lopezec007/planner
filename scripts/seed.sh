#!/usr/bin/env bash
# Seed a running planner instance with sample data for development / UAT.
# Usage: scripts/seed.sh [http://localhost:8080]
set -euo pipefail
BASE="${1:-http://localhost:8080}"
post() { curl -sS -f -X POST -H 'Content-Type: application/json' "$BASE$1" -d "$2"; }
patch() { curl -sS -f -X PATCH -H 'Content-Type: application/json' "$BASE$1" -d "$2" >/dev/null; }
id() { python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
today() { python3 -c "import datetime; print((datetime.date.today()+datetime.timedelta(days=$1)).isoformat())"; }

EVAN=$(post /api/users '{"name":"Evan"}' | id)
SAM=$(post /api/users '{"name":"Sam"}' | id)
ALEX=$(post /api/users '{"name":"Alex"}' | id)

MAINT=$(post /api/items "{\"type\":\"ongoing\",\"title\":\"Maintenance\",\"owner_id\":$EVAN,\"description\":\"Recurring **house and yard** upkeep.\\n\\n- gutters\\n- HVAC filters\"}" | id)
FIN=$(post /api/items "{\"type\":\"ongoing\",\"title\":\"Finance\",\"owner_id\":$SAM,\"assignee_id\":$SAM}" | id)

KITCHEN=$(post /api/items "{\"type\":\"project\",\"title\":\"Kitchen remodel\",\"status\":\"in-progress\",\"owner_id\":$EVAN,\"assignee_id\":$EVAN,\"start_date\":\"$(today -20)\",\"start_firm\":true,\"end_date\":\"$(today 45)\",\"description\":\"Full remodel. See [plans](https://example.com).\"}" | id)
GARDEN=$(post /api/items "{\"type\":\"project\",\"title\":\"Spring garden\",\"status\":\"todo\",\"owner_id\":$ALEX,\"assignee_id\":$ALEX,\"start_date\":\"$(today 10)\",\"end_date\":\"$(today 60)\",\"end_firm\":true}" | id)
TAXES=$(post /api/items "{\"type\":\"project\",\"title\":\"File taxes\",\"status\":\"backlog\",\"owner_id\":$SAM,\"end_date\":\"$(today 120)\",\"end_firm\":true}" | id)
SOLAR=$(post /api/items "{\"type\":\"project\",\"title\":\"Solar panels\",\"status\":\"idea\",\"description\":\"Someday. Get three quotes first.\"}" | id)
SHED=$(post /api/items "{\"type\":\"project\",\"title\":\"Repaint shed\",\"status\":\"done\",\"owner_id\":$EVAN,\"start_date\":\"$(today -30)\",\"end_date\":\"$(today -3)\"}" | id)

post /api/items "{\"type\":\"task\",\"parent_id\":$MAINT,\"title\":\"Clean gutters\",\"status\":\"todo\",\"owner_id\":$EVAN,\"assignee_id\":$EVAN,\"end_date\":\"$(today 3)\",\"urgency\":7,\"importance\":4}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$MAINT,\"title\":\"Replace HVAC filter\",\"status\":\"in-progress\",\"end_date\":\"$(today 0)\",\"urgency\":9,\"importance\":6,\"description\":\"Filter size: 20x25x1\"}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$MAINT,\"title\":\"Service lawnmower\",\"status\":\"backlog\",\"urgency\":2,\"importance\":3}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$MAINT,\"title\":\"Fix fence post\",\"status\":\"done\",\"owner_id\":$SAM,\"urgency\":5,\"importance\":5}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$MAINT,\"title\":\"Install smart thermostat\",\"status\":\"idea\",\"urgency\":1,\"importance\":6}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$FIN,\"title\":\"Pay insurance\",\"status\":\"todo\",\"owner_id\":$SAM,\"assignee_id\":$SAM,\"end_date\":\"$(today -2)\",\"end_firm\":true,\"urgency\":10,\"importance\":9,\"blocked\":true,\"description\":\"Waiting on renewal quote.\"}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$FIN,\"title\":\"Review budget\",\"status\":\"in-progress\",\"owner_id\":$SAM,\"start_date\":\"$(today -5)\",\"start_firm\":true,\"urgency\":4,\"importance\":8}" >/dev/null

post /api/items "{\"type\":\"task\",\"parent_id\":$KITCHEN,\"title\":\"Demo old cabinets\",\"status\":\"done\",\"assignee_id\":$EVAN,\"start_date\":\"$(today -20)\",\"start_firm\":true,\"end_date\":\"$(today -15)\",\"end_firm\":true,\"urgency\":8,\"importance\":8}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$KITCHEN,\"title\":\"Order countertops\",\"status\":\"in-progress\",\"assignee_id\":$SAM,\"end_date\":\"$(today 6)\",\"urgency\":8,\"importance\":9,\"description\":\"Quartz, *white with grey veining*.\"}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$KITCHEN,\"title\":\"Electrical rough-in\",\"status\":\"todo\",\"start_date\":\"$(today 2)\",\"end_date\":\"$(today 9)\",\"urgency\":6,\"importance\":7}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$KITCHEN,\"title\":\"Paint walls\",\"status\":\"backlog\",\"start_date\":\"$(today 30)\",\"urgency\":3,\"importance\":4}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$KITCHEN,\"title\":\"Choose backsplash\",\"status\":\"cancelled\",\"urgency\":2,\"importance\":2}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$GARDEN,\"title\":\"Buy seeds\",\"status\":\"todo\",\"assignee_id\":$ALEX,\"end_date\":\"$(today 14)\",\"urgency\":5,\"importance\":5}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$GARDEN,\"title\":\"Build raised beds\",\"status\":\"todo\",\"start_date\":\"$(today 20)\",\"start_firm\":true,\"urgency\":4,\"importance\":7}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$TAXES,\"title\":\"Gather W-2s\",\"status\":\"todo\",\"urgency\":5,\"importance\":9}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$SOLAR,\"title\":\"Get quotes\",\"status\":\"idea\",\"urgency\":1,\"importance\":5}" >/dev/null
post /api/items "{\"type\":\"task\",\"parent_id\":$SHED,\"title\":\"Buy paint\",\"status\":\"done\",\"urgency\":5,\"importance\":5}" >/dev/null

echo "seeded $BASE"
