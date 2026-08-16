#!/usr/bin/env bash
# todo.sh — agents/CLI update Jake's per-project running to-dos (Mission Control → Projects).
#   todo.sh add  "<project name>" "<to-do text>"      # creates the project if new
#   todo.sh done "<project name>" "<substring of the to-do>"
#   todo.sh note "<project name>" "<progress note>"
#   todo.sh list ["<project name>"]
# Talks to the dashboard API on :3080; store = ~/services/projects/projects.json.
set -uo pipefail
API=${MC_API:-http://127.0.0.1:3080}
cmd="${1:-list}"; proj="${2:-}"; arg="${3:-}"
slug() { curl -s "$API/api/projects/slug/$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1")" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])'; }
case "$cmd" in
  add)  [ -n "$proj" ] && [ -n "$arg" ] || { echo "usage: todo.sh add <project> <text>"; exit 2; }
        id=$(slug "$proj"); curl -s -X POST "$API/api/projects/$id/todos" -H 'Content-Type: application/json' \
          -d "$(python3 -c 'import json,sys;print(json.dumps({"text":sys.argv[1],"name":sys.argv[2],"by":"cli"}))' "$arg" "$proj")" | python3 -c 'import sys,json;t=json.load(sys.stdin);print("added:",t.get("text",t))' ;;
  done) [ -n "$proj" ] && [ -n "$arg" ] || { echo "usage: todo.sh done <project> <substring>"; exit 2; }
        id=$(slug "$proj"); python3 - "$id" "$arg" "$API" <<'PY'
import sys,json,urllib.request
pid,sub,api=sys.argv[1],sys.argv[2].lower(),sys.argv[3]
d=json.load(urllib.request.urlopen(f"{api}/api/projects")); p=next((x for x in d["projects"] if x["id"]==pid),None)
if not p: sys.exit(f"no project {pid}")
t=next((t for t in p["todos"] if sub in t["text"].lower() and not t.get("readOnly") and not t["done"]),None)
if not t: sys.exit("no matching open to-do")
r=urllib.request.Request(f"{api}/api/projects/{pid}/todos/{t['id']}",data=json.dumps({"done":True}).encode(),headers={"Content-Type":"application/json"},method="PATCH")
print("done:",json.load(urllib.request.urlopen(r))["text"])
PY
        ;;
  note) [ -n "$proj" ] && [ -n "$arg" ] || { echo "usage: todo.sh note <project> <note>"; exit 2; }
        id=$(slug "$proj"); curl -s -X PATCH "$API/api/projects/$id" -H 'Content-Type: application/json' \
          -d "$(python3 -c 'import json,sys;print(json.dumps({"progressNote":sys.argv[1],"name":sys.argv[2]}))' "$arg" "$proj")" >/dev/null && echo "note saved" ;;
  list) python3 - "$proj" "$API" <<'PY'
import sys,json,urllib.request
want=sys.argv[1].lower(); d=json.load(urllib.request.urlopen(f"{sys.argv[2]}/api/projects"))
for p in d["projects"]:
    if want and want not in p["name"].lower(): continue
    todos=[t for t in p.get("todos",[]) if not t["done"]]
    if not want and not todos and p.get("source")!="manual": continue
    print(f"[{p['status']}] {p['name']}  (last {str(p.get('lastTouched'))[:10]})")
    for t in todos: print("   ○", t["text"][:110])
PY
        ;;
  *) echo "usage: todo.sh add|done|note|list …"; exit 2 ;;
esac
