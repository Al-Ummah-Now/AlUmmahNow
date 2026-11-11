"""Research prototype (2026-11-11): zero-mistake Quran identification (official text only). Imports quran_detect as quran."""
"""Zero-mistake Quran pipeline evaluation: ASR words -> identification -> official text only."""
import json,re,sys,statistics as st
sys.path.insert(0,'.')
import quran_detect as Q
from quran_detect import CLEAN,W,POS,IDX,wsim
D=re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')
def norm1(w):
    w=D.sub('',w); w=re.sub('[إأآٱا]','ا',w); w=w.replace('ى','ي').replace('ة','ه')
    w=re.sub('[ؤئء]','',w); w=re.sub('[^ء-ي]','',w); return w
# rebuild index with hamza-stripping normalisation
QW=[];QP=[]
for k in sorted(CLEAN):
    for i,w in enumerate(CLEAN[k].split()):
        n=norm1(w)
        if n: QW.append(n);QP.append((k,i))
N=3;IX={}
for i in range(len(QW)-N+1): IX.setdefault(tuple(QW[i:i+N]),[]).append(i)
AYAH_LEN={k:len([w for w in CLEAN[k].split() if norm1(w)]) for k in CLEAN}
def asr_words(path):
    r=json.load(open(path)); r=r.get('result',r)
    out=[]
    for s in r.get('segments',[]):
        for w in s.get('words',[]):
            n=norm1(w['word'])
            if n: out.append((n,w['start'],w['end']))
    return out
def ws(a,b): return 1.0 if a==b else Q.SequenceMatcher(None,a,b).ratio()
def extend(h,i,q):
    hi,qi,m,miss,last=i,q,0,0,(i,q)
    while hi<len(h) and qi<len(QW):
        if ws(h[hi],QW[qi])>=0.7: m+=1;hi+=1;qi+=1;last=(hi,qi);miss=0;continue
        if hi+1<len(h) and ws(h[hi+1],QW[qi])>=0.7: hi+=1;miss+=1
        elif qi+1<len(QW) and ws(h[hi],QW[qi+1])>=0.7: qi+=1;miss+=1
        else: hi+=1;qi+=1;miss+=1
        if miss>2: break
    return last,m
def occurrences(seq):
    """how many places in the Quran contain this normalised word sequence (exact)"""
    if len(seq)<N: return 99
    c=0
    for q in IX.get(tuple(seq[:N]),[]):
        if QW[q:q+len(seq)]==seq: c+=1
    return c
def detect(words):
    h=[w for w,_,_ in words]; spans=[];i=0
    while i<=len(h)-N:
        best=None
        for q in IX.get(tuple(h[i:i+N]),[])[:300]:
            (he,qe),m=extend(h,i,q); L=he-i
            if L>=4 and m/L>=0.75 and (not best or m>best['m']): best=dict(h=(i,he),q=(q,qe),m=m,L=L)
        if best:
            qs,qe=best['q']; seq=QW[qs:qe]
            best['occ']=occurrences(seq); best['conf']=round(best['m']/best['L'],2)
            best['t']=(words[best['h'][0]][1],words[best['h'][1]-1][2])
            spans.append(best); i=best['h'][1]
        else: i+=1
    return spans
def classify(s):
    nq=s['q'][1]-s['q'][0]
    if s['occ']>1: return 'ambiguous'
    if nq>=6 and s['conf']>=0.9: return 'confirmed'
    if nq>=5 and s['conf']>=0.8: return 'possible'
    return 'possible' if nq>=4 else 'drop'
def shown_words(s):
    """(key, word index) pairs that would be displayed as official text"""
    qs,qe=s['q']; return [QP[j] for j in range(qs,qe)]

# --- v2: muqatta'at, left extension, basmala, context disambiguation, length-scaled threshold
MUQ=[(['يا','سين'],'يس'),(['ياسين'],'يس'),(['الف','لام','ميم'],'الم'),(['الف','لام','ميم','صاد'],'المص'),(['الف','لام','را'],'الر'),(['الف','لام','ميم','را'],'المر'),
     (['حا','ميم'],'حم'),(['طا','ها'],'طه'),(['طا','سين','ميم'],'طسم'),(['طا','سين'],'طس'),(['كاف','ها','يا','عين','صاد'],'كهيعص'),(['عين','سين','قاف'],'عسق'),(['قاف'],'ق'),(['نون'],'ن'),(['صاد'],'ص')]
MUQ=[([norm1(x) for x in a],b) for a,b in MUQ]; MUQ.sort(key=lambda x:-len(x[0]))
def preprocess(words):
    out=[];i=0
    while i<len(words):
        for seq,rep in MUQ:
            if len(seq)>1 and [w for w,_,_ in words[i:i+len(seq)]]==seq:
                out.append((rep,words[i][1],words[i+len(seq)-1][2])); i+=len(seq); break
        else: out.append(words[i]); i+=1
    return out
def positions(seq):
    if len(seq)<N: return []
    return [q for q in IX.get(tuple(seq[:N]),[]) if QW[q:q+len(seq)]==seq]
def detect2(words):
    words=preprocess(words); h=[w for w,_,_ in words]; spans=detect(words)
    for s in spans:  # extend left over garbled/omitted words
        i,_=s['h']; q,qe=s['q']
        while i>0 and q>0 and ws(h[i-1],QW[q-1])>=0.7: i-=1;q-=1;s['m']+=1;s['L']+=1
        s['h']=(i,s['h'][1]); s['q']=(q,qe); s['t']=(words[i][1],s['t'][1])
        s['cands']=positions(QW[q:qe]); s['occ']=len(s['cands']) or 1
    return spans,words
BASMALA=[norm1(w) for w in 'بسم الله الرحمن الرحيم'.split()]
def classify2(s):
    nq=s['q'][1]-s['q'][0]
    if QW[s['q'][0]:s['q'][1]]==BASMALA: return 'basmala'
    if s['occ']>1: return 'ambiguous'
    if (nq>=6 and s['conf']>=0.9) or (nq>=20 and s['conf']>=0.75): return 'confirmed'
    return 'possible' if nq>=4 else 'drop'
def resolve(spans):
    cls=[classify2(s) for s in spans]
    conf_keys=[(QP[s['q'][0]][0],QP[s['q'][1]-1][0]) for s in spans]
    for j,s in enumerate(spans):
        if cls[j]!='ambiguous': continue
        prev=next((conf_keys[k][1] for k in range(j-1,-1,-1) if cls[k] in('confirmed','context')),None)
        nxt=next((conf_keys[k][0] for k in range(j+1,len(spans)) if cls[k] in('confirmed',)),None)
        ok=[]
        for q in s['cands']:
            k=QP[q][0]
            if prev and k[0]==prev[0] and 0<=k[1]-prev[1]<=2: ok.append(q)
            elif nxt and k[0]==nxt[0] and 0<=nxt[1]-k[1]<=2: ok.append(q)
        if len(ok)==1:
            L=s['q'][1]-s['q'][0]; s['q']=(ok[0],ok[0]+L); cls[j]='context'; conf_keys[j]=(QP[ok[0]][0],QP[ok[0]+L-1][0])
    # basmala: shown only when it directly precedes a confirmed span starting at ayah 1 of a surah
    for j,s in enumerate(spans):
        if cls[j]=='basmala':
            nx=next((spans[k] for k in range(j+1,len(spans)) if cls[k] in('confirmed','context')),None)
            cls[j]='basmala_ok' if nx and QP[nx['q'][0]][0][1] in (1,2) and QP[nx['q'][0]][1]==0 else 'possible'
    return cls
