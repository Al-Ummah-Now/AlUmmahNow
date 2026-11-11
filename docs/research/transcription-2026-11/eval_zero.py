import json,sys;sys.path.insert(0,'.')
from quran_zero import *
T1=json.load(open('q2_truth.json')); T3=json.load(open('q3_truth.json'))
T1['q_mulk']={'ayat':[{'key':[67,a]} for a in range(1,14)]}
T1['q_rahman_mujawwad']={'ayat':[{'key':[55,a]} for a in range(1,26)]}
files={k:f'out_{k}_wai.json' for k in list(T1)+list(T3)}
files['q_mulk']='out_q_mulk_novad.json'; files['q_rahman_mujawwad']='out_q_rahman_mujawwad_novad.json'
lect={'ar_duat3':{(3,166),(3,167),(5,82)},'ar_tahinu':{(3,139)},'en_gooddeeds1':{(35,7)},'x_ashura2':set(),'ar_gaza16':set(),'x_shahrour1':set()}
for k in lect: files[k]=f'out_{k}_whisper-large-v3-turbo.json'
rows=[];timing=[]
for clip,f in files.items():
    words=asr_words(f); spans,words=detect2(words)
    cls=list(zip(spans,resolve(spans)))
    conf=[s for s,c in cls if c in ('confirmed','context')]; ctx=sum(1 for s,c in cls if c=='context'); bas=sum(1 for s,c in cls if c=='basmala_ok'); rev=[s for s,c in cls if c in('possible','ambiguous')]
    shown=set(); 
    for s in conf: shown|=set(shown_words(s))
    if clip in T1:
        truth_ay={tuple(a['key']) for a in T1[clip]['ayat']}
        truth_words={(k,i) for k in truth_ay for i in range(AYAH_LEN[k])}
    elif clip in T3:
        t=T3[clip]; truth_ay={(67,w[0]) for w in t['words']}; truth_words={((67,w[0]),w[1]-1) for w in t['words']}
    else:
        truth_ay=lect[clip]; truth_words=None
    shown_ay={k for k,_ in shown}
    wrong_ay=shown_ay-truth_ay
    # basmala (1:1) recited before a surah is real recitation, not an error
    if (1,1) in wrong_ay and not any(a[0]==1 for a in truth_ay): wrong_ay.discard((1,1))
    if truth_words is not None:
        extra=[w for w in shown if w[0] in truth_ay and w not in truth_words]
        missing=[w for w in truth_words if w not in shown]
    else: extra=missing=[]
    rev_ay=set()
    for s in rev: rev_ay|={k for k,_ in shown_words(s)}
    rows.append(dict(clip=clip,truth=len(truth_ay),ok=len(shown_ay&truth_ay),wrong=sorted(wrong_ay),extra_words=len(extra),missing_words=len(missing),truth_words=len(truth_words) if truth_words else None,review=len(rev),review_true=len(rev_ay&truth_ay),review_false=sorted(rev_ay-truth_ay)[:4],confirmed=len(conf),context=ctx,basmala=bas))
    # timing: partial clips (QF word truth): first/last confirmed word time vs truth
    if clip in T3:
        tw={((67,w[0]),w[1]-1):(w[2],w[3]) for w in T3[clip]['words']}
        for s in conf:
            ws_=shown_words(s); a,b=ws_[0],ws_[-1]
            if a in tw: timing.append(('start',clip,round((s['t'][0]-tw[a][0])*1000)))
            if b in tw: timing.append(('end',clip,round((s['t'][1]-tw[b][1])*1000)))
for r in rows: print(r)
print('timing ms',timing)
json.dump({'rows':rows,'timing':timing},open('zero_eval.json','w'),default=str,indent=1)
