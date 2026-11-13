"""Orphaned Bunny collections (#1085, #1086): driver for scripts/qa/bunny-collections/worker.js.

Usage: python3 orphans.py <target: test|prod> <mode: dry-run|apply> <out.json>
Env: PROBE_URL, PROBE_TOKEN; GITHUB_STEP_SUMMARY (optional).

A collection is an orphan when no channel or profile record of the target's
environments refers to it (bunnyCollections[library] or the legacy
bunnyCollectionId). Soft-deleted records still count as owners.

test (library 553336, QA + stage records): dry-run stores the orphan ids as a
snapshot; apply deletes only collections that were orphans in a snapshot taken
at least an hour earlier and still are now (Bunny collections carry no creation
date: this keeps anything less than an hour old), then stores a new snapshot.
prod (libraries 400189 and 498994, production records): counts only.
"""
import json, os, sys, time, urllib.request

TARGETS = {
    'test': {'libs': ['553336'], 'buckets': ['channels_qa', 'channels_stage', 'profiles_qa', 'profiles_stage']},
    'prod': {'libs': ['400189', '498994'], 'buckets': ['channels', 'profiles']},
}
MIN_SNAPSHOT_AGE_S = 3600


def call(path, method='GET', body=None):
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(5):
        try:
            req = urllib.request.Request(os.environ['PROBE_URL'] + path, data=data, method=method, headers={
                'Authorization': 'Bearer ' + os.environ['PROBE_TOKEN'],
                'Content-Type': 'application/json',
                # Cloudflare refuses urllib's default User-Agent on workers.dev
                'User-Agent': 'bunny-orphan-collections-ci/1.0',
            })
            return json.load(urllib.request.urlopen(req, timeout=300))
        except Exception as e:
            print(f'{method} {path.split("?")[0]}: {e} (attempt {attempt + 1})', file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f'{method} {path} failed')


def main():
    target, mode, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    cfg = TARGETS[target]
    if target == 'prod' and mode != 'dry-run':
        raise SystemExit('prod is census only')

    refs_by_lib, refs_any, records = {}, set(), {}
    for b in cfg['buckets']:
        cursor, n = '', 0
        while True:
            page = call(f'/refs?bucket={b}' + (f'&cursor={urllib.request.quote(cursor)}' if cursor else ''))
            n += page['records']
            for lib, cid in page['refs']:
                if lib is None:
                    refs_any.add(cid)
                else:
                    refs_by_lib.setdefault(str(lib), set()).add(cid)
            cursor = page.get('cursor')
            if not cursor:
                break
        records[b] = n
        print(f'{b}: {n} records', file=sys.stderr)

    report = {'target': target, 'mode': mode, 'at': int(time.time()), 'records': records, 'libraries': {}}
    for lib in cfg['libs']:
        items = call(f'/collections?lib={lib}')['items']
        owned = refs_by_lib.get(lib, set()) | refs_any
        orphans = [c for c in items if c[0] not in owned]
        report['libraries'][lib] = {
            'collections': len(items),
            'owned': len(items) - len(orphans),
            'orphans': len(orphans),
            'orphansWithVideos': sum(1 for c in orphans if c[2]),
            'orphanVideos': sum(c[2] for c in orphans),
            'orphanBytes': sum(c[3] for c in orphans),
            # Production collection names are real channel names: not printed
            'sample': [{'guid': c[0], 'name': c[1] if target == 'test' else '', 'videos': c[2]} for c in orphans[:10]],
            'orphanIds': [c[0] for c in orphans],
        }

    if target == 'test':
        lib = cfg['libs'][0]
        now_orphans = set(report['libraries'][lib]['orphanIds'])
        if mode == 'apply':
            snap = call('/snapshot') or {}
            age = report['at'] - int(snap.get('at') or 0)
            if snap.get('lib') != lib or age < MIN_SNAPSHOT_AGE_S:
                report['apply'] = {'skipped': f'no dry-run snapshot at least {MIN_SNAPSHOT_AGE_S // 60} min old (age {age} s): run dry-run, then apply an hour later'}
            else:
                ids = sorted(now_orphans & set(snap.get('ids') or []))
                res = {'deleted': 0, 'gone': 0, 'failed': []}
                for i in range(0, len(ids), 200):
                    r = call('/delete', 'POST', {'lib': lib, 'ids': ids[i:i + 200]})
                    res['deleted'] += r['deleted']; res['gone'] += r['gone']; res['failed'] += r['failed']
                res['candidates'] = len(ids)
                res['snapshotAgeMin'] = age // 60
                report['apply'] = res
                now_orphans -= set(ids)
        # Next apply deletes only what is still orphaned an hour from now
        call('/snapshot', 'PUT', {'at': report['at'], 'lib': lib, 'ids': sorted(now_orphans)})

    json.dump(report, open(out_path, 'w'))
    lines = [f'### Orphaned Bunny collections ({target}, {mode})', '', f'Records scanned: {records}', '',
             '| library | collections | owned | orphans | orphans with videos | videos in orphans | GB in orphans |', '|---|---:|---:|---:|---:|---:|---:|']
    for lib, r in report['libraries'].items():
        lines.append(f"| {lib} | {r['collections']} | {r['owned']} | {r['orphans']} | {r['orphansWithVideos']} | {r['orphanVideos']} | {r['orphanBytes'] / 1e9:.2f} |")
    if 'apply' in report:
        lines += ['', f"Apply: {report['apply']}"]
    for lib, r in report['libraries'].items():
        if r['sample']:
            lines += ['', f'Sample orphans in {lib}:'] + [f"- {s['guid']} {s['videos']} videos \"{s['name']}\"" for s in r['sample']]
    text = '\n'.join(lines) + '\n'
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write(text)


main()
