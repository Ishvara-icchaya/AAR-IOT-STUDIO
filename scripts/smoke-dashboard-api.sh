#!/usr/bin/env bash
# Smoke-test dashboard API flows (requires valid credentials for your environment).
# Defaults match docker-compose.yml when BOOTSTRAP_ADMIN_* are unset.
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:8000/api/v1}"
EMAIL="${DASHBOARD_SMOKE_EMAIL:-${BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}}"
PASSWORD="${DASHBOARD_SMOKE_PASSWORD:-${BOOTSTRAP_ADMIN_PASSWORD:-admin123}}"

echo "==> POST $BASE_URL/auth/login"
TOKEN_JSON=$(curl -sS -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}") || true
TOKEN=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('access_token',''))" <<<"$TOKEN_JSON" 2>/dev/null || true)
if [[ -z "${TOKEN:-}" ]]; then
  echo "Login failed. Response:" >&2
  echo "$TOKEN_JSON" >&2
  echo >&2
  echo "Set DASHBOARD_SMOKE_EMAIL / DASHBOARD_SMOKE_PASSWORD (or BOOTSTRAP_ADMIN_*) to match your database." >&2
  exit 1
fi

AUTH=( -H "Authorization: Bearer $TOKEN" )

echo "==> GET $BASE_URL/auth/me"
curl -sS "$BASE_URL/auth/me" "${AUTH[@]}" | python3 -m json.tool | head -24

echo "==> GET $BASE_URL/dashboards"
curl -sS "$BASE_URL/dashboards" "${AUTH[@]}" | python3 - <<'PY'
import json, sys
d = json.load(sys.stdin)
items = d.get("items") or []
print(f"dashboards: {len(items)}")
for it in items[:12]:
    print(f"  - {it['id']}  {it['name'][:72]!r}  site={it.get('site_id')}")
PY

FIRST=$(curl -sS "$BASE_URL/dashboards" "${AUTH[@]}" | python3 -c "import json,sys; d=json.load(sys.stdin); items=d.get('items')or[]; print(items[0]['id'] if items else '')")
if [[ -z "$FIRST" ]]; then
  echo "No dashboards to fetch detail for."
  exit 0
fi

echo "==> GET $BASE_URL/dashboards/$FIRST"
curl -sS "$BASE_URL/dashboards/$FIRST" "${AUTH[@]}" | python3 - <<'PY'
import json, sys
d = json.load(sys.stdin)
layout = d.get("layout") or {}
rows = layout.get("rows") if isinstance(layout, dict) else None
print("name:", d.get("name"))
print("site_id:", d.get("site_id"))
print("layout rows:", len(rows) if isinstance(rows, list) else 0)
PY

SITE=$(curl -sS "$BASE_URL/dashboards/$FIRST" "${AUTH[@]}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('site_id') or '')")
if [[ -n "$SITE" ]]; then
  echo "==> GET $BASE_URL/dashboards/sources/resolved-device-collections?site_id=$SITE"
  curl -sS "$BASE_URL/dashboards/sources/resolved-device-collections?site_id=$SITE" "${AUTH[@]}" | python3 - <<'PY'
import json, sys
d = json.load(sys.stdin)
items = d.get("items") or []
print(f"sources: {len(items)}")
for it in items[:6]:
    print(f"  endpoint={it.get('endpoint_id')} object={it.get('object_name')!r}")
PY
  EP=$(curl -sS "$BASE_URL/dashboards/sources/resolved-device-collections?site_id=$SITE" "${AUTH[@]}" | python3 -c "import json,sys; d=json.load(sys.stdin); it=(d.get('items')or[]); print(it[0]['endpoint_id'] if it else '')")
  ON=$(curl -sS "$BASE_URL/dashboards/sources/resolved-device-collections?site_id=$SITE" "${AUTH[@]}" | python3 -c "import json,sys; d=json.load(sys.stdin); it=(d.get('items')or[]); print(it[0].get('object_name','') if it else '')")
  if [[ -n "$EP" && -n "$ON" ]]; then
    echo "==> GET $BASE_URL/dashboards/runtime/resolved-device-collection (limit=5)"
    curl -sS -G "$BASE_URL/dashboards/runtime/resolved-device-collection" \
      --data-urlencode "site_id=$SITE" \
      --data-urlencode "endpoint_id=$EP" \
      --data-urlencode "object_name=$ON" \
      --data-urlencode "limit=5" \
      "${AUTH[@]}" | python3 - <<'PY'
import json, sys
d = json.load(sys.stdin)
print("items:", len(d.get("items") or []))
print("summary keys:", sorted((d.get("summary") or {}).keys()))
print("next_cursor:", d.get("next_cursor"))
PY
  fi
fi

echo "==> OK smoke complete"
