#!/bin/bash
# usage: hooklog.sh <fromIndex>  -> prints compact entries after index, ignoring third-party analytics; echoes new length
cd "C:/projects/My stuff/REA Milanote"
node tools/cdp.mjs eval "JSON.stringify(window.__rea.slice($1).filter(x=>!/nr-data|onetrust|cookielaw|awswaf|amplitude|intercom/.test(x.url||'')))" | python -X utf8 -I -c "
import json,sys
raw=sys.stdin.read().strip()
d=json.loads(json.loads(raw))
for x in d:
    x.pop('t',None)
    print(json.dumps(x,ensure_ascii=False)[:${2:-1500}])
"
node tools/cdp.mjs eval "window.__rea.length"
