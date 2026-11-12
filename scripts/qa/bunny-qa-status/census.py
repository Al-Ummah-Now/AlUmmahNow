"""Per-run census of the Bunny test library (#929), from the probe's /list.

Usage: python3 census.py listing.json runs.json [repo] [owners.json] > summary.md
listing.json: {"rows": [[guid, title, dateUploaded, status, progress], ...]}
runs.json: GitHub workflow runs [{id, name, event, run_started_at, updated_at, run_attempt, head_branch}]

A video is attributed to the run of its owner's run account
(e2e+<run>-<attempt>-…, from owners.json: the probe's /owners), else when its title carries "<run id>-<attempt>"
(builders' ns()); otherwise to the only run that was in progress when it was
created (videos created by several overlapping runs are "ambiguous"), else
"unattributed". Titles of the stage env start with "[stage] ".
"""
import collections, datetime, json, re, sys

listing = json.load(open(sys.argv[1]))
runs = json.load(open(sys.argv[2]))
owners = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else {}
STATUS = {0: 'created', 1: 'uploaded', 2: 'processing', 3: 'transcoding', 4: 'finished', 5: 'error', 6: 'upload-failed'}


def ts(s):
    if not s:
        return None
    s = s.rstrip('Z').split('.')[0]
    return datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc)


by_id = {str(r['id']): r for r in runs}
spans = [(ts(r['run_started_at']), ts(r['updated_at']) + datetime.timedelta(minutes=2), r) for r in runs if r.get('run_started_at')]
RUN_RE = re.compile(r'(?<!\d)(\d{10,12})-(\d{1,2})(?!\d)')

groups = collections.defaultdict(lambda: {'count': 0, 'first': None, 'statuses': collections.Counter(), 'how': set(), 'env': collections.Counter(), 'shapes': collections.Counter(), 'records': collections.Counter()})
for guid, title, uploaded, status, _ in listing['rows']:
    env = 'stage' if title.startswith('[stage] ') else ('qa' if not re.match(r'^\[[^\]]{1,32}\]\s', title) else 'other')
    at = ts(uploaded)
    m = RUN_RE.search(title)
    key, how = None, None
    o = owners.get(guid) or {}
    if o.get('kind') == 'run':
        key, how = o['runId'], 'owner'
    elif o.get('kind') in ('seed', 'demo'):
        key, how = f"{o['kind']}:{o.get('account')}", 'owner'
    elif m and m.group(1) in by_id:
        key, how = m.group(1), 'title'
    elif m:
        key, how = m.group(1), 'title (run not in window)'
    elif at:
        live = [r for (a, b, r) in spans if a <= at <= b]
        e2e = [r for r in live if re.search(r'e2e|regression|release|seed|proof|upload|cleanup', r['name'], re.I)]
        cand = e2e or live
        if len(cand) == 1:
            key, how = str(cand[0]['id']), 'time'
        elif cand:
            key, how = 'ambiguous:' + '+'.join(sorted({r['name'] for r in cand})), 'time (overlap)'
        else:
            key, how = 'unattributed', 'none'
    else:
        key, how = 'unattributed', 'none'
    g = groups[key]
    g['count'] += 1
    g['records'][('deleted' if o.get('deleted') else 'live') if o.get('kind') in ('run', 'seed', 'demo', 'e2e-other', 'other-user', 'no-owner', 'no-profile') else o.get('kind', '?')] += 1
    g['how'].add(how)
    g['env'][env] += 1
    g['statuses'][STATUS.get(status, str(status))] += 1
    g['shapes'][re.sub(r'\d+', '#', RUN_RE.sub('<run>', title))[:40]] += 1
    if at and (g['first'] is None or at < g['first']):
        g['first'] = at


def wf(key):
    r = by_id.get(key)
    if r:
        return r['name'], r['event'] + (f" ({r.get('head_branch')})" if r.get('head_branch') else '')
    if key.startswith(('seed:', 'demo:')):
        return key, 'fixture'
    if key.startswith('ambiguous:'):
        return key[len('ambiguous:'):], 'overlapping runs'
    return ('?' if key != 'unattributed' else 'unattributed'), ''


total = sum(g['count'] for g in groups.values())
print(f"### Bunny test library census ({listing.get('at')}): {total} videos\n")
print('| run | workflow | trigger | start hour (UTC) | videos | env | statuses | record | attributed by | top title |')
print('|---|---|---|---|---:|---|---|---|---|---|')
for key, g in sorted(groups.items(), key=lambda kv: -kv[1]['count']):
    name, trig = wf(key)
    run = f"[{key}](https://github.com/{sys.argv[3] if len(sys.argv) > 3 else 'Al-Ummah-Now/AlUmmahNow'}/actions/runs/{key})" if key in by_id else key if not key.startswith('ambiguous:') else 'ambiguous'
    print(f"| {run} | {name} | {trig} | {g['first'].strftime('%m-%d %H:00') if g['first'] else ''} | {g['count']} | {dict(g['env'])} | {dict(g['statuses'])} | {dict(g['records'])} | {', '.join(sorted(g['how']))} | {g['shapes'].most_common(1)[0][0] if g['shapes'] else ''} |")

print('\n### Totals by workflow\n')
print('| workflow | trigger | runs | videos | per run (avg) | per run (max) |')
print('|---|---|---:|---:|---:|---:|')
agg = collections.defaultdict(list)
for key, g in groups.items():
    name, trig = wf(key)
    agg[(name, trig.split(' (')[0])].append(g['count'])
for (name, trig), counts in sorted(agg.items(), key=lambda kv: -sum(kv[1])):
    print(f"| {name} | {trig} | {len(counts)} | {sum(counts)} | {sum(counts) / len(counts):.0f} | {max(counts)} |")
