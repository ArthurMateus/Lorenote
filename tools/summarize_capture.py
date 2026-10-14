import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
n = d['normalized_result']
print('evidence', d['evidence_id'])
print('completeness', n['completeness']['status'], [ (e['section'], e['reason'], e['count']) for e in n['completeness']['excluded'] if 'network' in e['section'] or 'websocket' in e['section'] or 'json' in e['section'] or e['reason']=='disallowed_origin'])
nw = n['network']
print('requests', len(nw['requests']), 'ws conns', len(nw['websocket_connections']))
for r in nw['requests']:
    print(json.dumps(r)[:700])
for w in nw['websocket_connections']:
    print('WS', json.dumps(w)[:2500])
