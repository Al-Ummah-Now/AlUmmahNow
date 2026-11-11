"""Research prototype (2026-11-11), not production code.

Finds Quran quotations in Arabic ASR text and replaces them with the official
Tanzil text. Used for the measurements in ../TRANSCRIPTION-TRANSLATION-RESEARCH.md.

Inputs (download from https://tanzil.net/download/, CC BY 3.0, verbatim, credit
"Tanzil Project"): dl/quran-simple-clean.txt, dl/quran-simple.txt and
dl/quran-uthmani.txt in "sura|aya|text" format.

    from quran_detect import detect, merge, replace_merged
    h, spans = detect(asr_text)   # spans: from/to (surah, ayah), conf, words
"""
import re,json,sys
from difflib import SequenceMatcher
D=re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')
def norm(s):
    s=D.sub('',s)
    s=re.sub('[إأآٱا]','ا',s); s=s.replace('ى','ي').replace('ة','ه').replace('ؤ','و').replace('ئ','ي').replace('ء','')
    s=re.sub('[^ء-ي\\s]',' ',s)
    return s.split()
def load(p):
    out={}
    for l in open(p,encoding='utf-8'):
        p_=l.rstrip('\n').split('|')
        if len(p_)==3 and p_[0].isdigit(): out[(int(p_[0]),int(p_[1]))]=p_[2]
    return out
CLEAN=load('dl/quran-simple-clean.txt'); UTH=load('dl/quran-uthmani.txt'); SIMPLE=load('dl/quran-simple.txt')
W=[];POS=[]
for k in sorted(CLEAN):
    for i,w in enumerate(norm(CLEAN[k])): W.append(w);POS.append((k,i))
N=3; IDX={}
for i in range(len(W)-N+1): IDX.setdefault(tuple(W[i:i+N]),[]).append(i)
def wsim(a,b): return 1.0 if a==b else SequenceMatcher(None,a,b).ratio()
def extend(h,i,q):
    # greedy alignment allowing 1-word insert/delete, fuzzy word match >=0.7
    hi,qi=i,q; m=0; last=(i,q); miss=0
    while hi<len(h) and qi<len(W):
        if wsim(h[hi],W[qi])>=0.7: m+=1;hi+=1;qi+=1;last=(hi,qi);miss=0;continue
        if hi+1<len(h) and wsim(h[hi+1],W[qi])>=0.7: hi+=1;miss+=1
        elif qi+1<len(W) and wsim(h[hi],W[qi+1])>=0.7: qi+=1;miss+=1
        else: hi+=1;qi+=1;miss+=1
        if miss>2: break
    return last,m
def detect(text,minw=5,minr=0.75):
    h=norm(text); spans=[]; i=0
    while i<=len(h)-N:
        best=None
        for q in IDX.get(tuple(h[i:i+N]),[])[:200]:
            (he,qe),m=extend(h,i,q)
            L=he-i
            if L>=minw and m/L>=minr and (not best or m>best[2]): best=(he,(q,qe),m,L)
        if best:
            he,(qs,qe),m,L=best
            spans.append({'h':(i,he),'q':(qs,qe),'from':POS[qs][0],'to':POS[qe-1][0],'conf':round(m/L,2),'words':L}); i=he
        else: i+=1
    return h,spans
def official(span,src=None):
    (s1,a1),(s2,a2)=span['from'],span['to']
    keys=[k for k in sorted(UTH) if (s1,a1)<=k<=(s2,a2)]
    # partial first/last ayah -> slice diacritised Simple text by word index (same tokenisation as Clean)
    qs,qe=span['q']; parts=[]
    for k in keys:
        words=SIMPLE[k].split(); n=len(words)
        st=POS[qs][1] if k==keys[0] else 0
        en=POS[qe-1][1]+1 if k==keys[-1] else n
        parts.append((src or UTH)[k] if (st==0 and en==n) else ' '.join((CLEAN[k].split() if src else words)[st:en]))
    return ' '.join(parts),keys
def wer(ref,hyp):
    r,hh=ref,hyp; d=list(range(len(hh)+1))
    for i in range(1,len(r)+1):
        p=d[:]; d[0]=i
        for j in range(1,len(hh)+1): d[j]=min(p[j]+1,d[j-1]+1,p[j-1]+(r[i-1]!=hh[j-1]))
    return d[len(hh)]/max(1,len(r))
def replace(text, src=None):
    h,spans=detect(text); out=[];i=0
    for s in spans:
        out+=h[i:s['h'][0]]; t,_=official(s,src); out.append('⟦'+t+'⟧'); i=s['h'][1]
    out+=h[i:]; return ' '.join(out),spans
def merge(spans,maxgap_ayah=2,maxgap_words=25):
    out=[]
    for s in spans:
        if out:
            p=out[-1]
            if p['to'][0]==s['from'][0] and 0<=s['from'][1]-p['to'][1]<=maxgap_ayah and s['h'][0]-p['h'][1]<=maxgap_words:
                # extend to cover whole ayat in between (gap fill), keep min conf
                qe=s['q'][1]; p.update(h=(p['h'][0],s['h'][1]),q=(p['q'][0],qe),to=s['to'],conf=min(p['conf'],s['conf']),words=p['words']+s['words'],merged=True); continue
        out.append(dict(s))
    return out
def replace_merged(text,src=None):
    h,spans=detect(text); spans=merge(spans); out=[];i=0
    for s in spans:
        out+=h[i:s['h'][0]]; t,_=official(s,src); out.append('⟦'+t+'⟧'); i=s['h'][1]
    out+=h[i:]; return ' '.join(out),spans
