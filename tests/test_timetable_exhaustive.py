"""고정 시드의 작은 48문제를 전수열거하여 하드조건·목적함수·최적성 보고를 대조한다."""
import sys,json,copy,itertools,random
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'packages/timetable'))
from engine.solver import solve_timetable
from engine.model import normalize,inspect_schedule,expand_cells,legal_start
from engine.quality import read_quality,evaluate_quality,morning_baselines
rng=random.Random(20261011)
summary={'cases':0,'adaptiveCases':0,'feasible':0,'infeasible':0,'previousCases':0,'provedOptimal':0,'oracleAssignments':0,'violations':[]}
def oracle(raw,opts):
    q=read_quality(opts.get('quality'));p=normalize(raw,q);fixed=p['fixed']+opts.get('locks',[])
    choices={u['id']:[(d['id'],s) for d in p['days'] for s in range(1,d['periods']+1) if legal_start(p,u,d['id'],s,fixed)] for u in p['units']}
    if any(not v for v in choices.values()):return p,q,[],None
    baselines=morning_baselines(p,choices);valid=[];ids=list(choices)
    for locations in itertools.product(*(choices[u] for u in ids)):
        summary['oracleAssignments']+=1
        places=[{'unitId':u,'day':d,'start':s} for u,(d,s) in zip(ids,locations)]
        if inspect_schedule(p,places,fixed)['valid']:
            pen=evaluate_quality(p,places,q,baselines)['totalPenalty'];cells=expand_cells(p,places)
            changed=None
            if opts.get('previous') is not None:
                old=expand_cells(p,opts['previous']);changed=sum(cells[k]!=old[k] for k in cells)
            valid.append((places,pen,changed))
    best=min(((x[2],x[1]) if opts.get('previous') is not None and opts.get('changeMode','minimize')=='minimize' else x[1]) for x in valid) if valid else None
    return p,q,valid,best
for index in range(48):
    mode=index%4
    ds=([1,1] if mode==0 else [2,2] if mode==1 else [1,1,1] if mode==2 else [3])
    classes=1 if mode==1 else 2
    raw={'version':1,'morningEnd':1,'days':[{'id':f'd{i}','periods':n,**({'breaksAfter':[1]} if n>1 else {})} for i,n in enumerate(ds)],'classes':[{'id':f'c{i}'} for i in range(classes)],'teachers':[{'id':f't{i}'} for i in range(3)]+[{'id':f'h{i}'} for i in range(classes)],'subjects':[{'id':'s0'},{'id':'s1'}],'resources':[{'id':'room','capacity':classes}],'lessons':[],'reservations':[]}
    grouped={}
    for ci in range(classes):
        for di,n in enumerate(ds):
            for slot in range(1,n+1):
                if index%11==0 and ci==0 and di==0 and slot==1:
                    raw['reservations'].append({'classId':f'c{ci}','day':f'd{di}','period':slot,'teacherIds':[f'h{ci}'],'resourceIds':['room']});continue
                sid=f's{(di+slot+ci)%2}';tid=f't{(di+slot+ci)%3}'
                if mode==1 and index%8==1:sid=f's{di}';tid=f't{di}'
                key=(ci,sid,tid)
                if key not in grouped:
                    grouped[key]={'id':f'l{len(grouped)}','classId':f'c{ci}','subjectId':sid,'teacherIds':[tid]+([f'h{ci}'] if index%5==0 else []),'hours':0,'resourceIds':['room']}
                grouped[key]['hours']+=1
    raw['lessons']=list(grouped.values())
    if mode==1 and index%8==1:
        for l in raw['lessons']:
            if l['hours']==2:l['blocks']=[2];l['allowAcrossBreak']=bool(index%3)
    options={'timeLimitSeconds':1,'workers':1,'maxCandidates':1,'seed':index+1,'quality':{'preferredMaxConsecutive':rng.randint(1,2),'consecutiveAcrossBreak':bool(index%2),'weights':{k:rng.randint(0,4) for k in ['subjectDaily','subjectAdjacency','teacherDailyLoad','teacherGaps','teacherConsecutive','morningBalance','lateSpread','teacherFairness','blockBreakCrossing']}}}
    p,q,old_valid,_=oracle(raw,options)
    if index%3==0 and old_valid:
        options['previous']=old_valid[rng.randrange(len(old_valid))][0];summary['previousCases']+=1
        if index%2==0:
            old=expand_cells(p,options['previous']);key=next(iter(old));sid,teachers=old[key]
            options['locks']=[{'classId':key[0],'day':key[1],'period':key[2],'subjectId':sid,'teacherIds':list(teachers)}]
    kind=index%9
    if kind==0:raw['hardConstraints']=[{'type':'maxDailyLoad','teacherId':'t0','max':rng.randint(0,max(ds))}]
    elif kind==1:raw['hardConstraints']=[{'type':'maxConsecutive','teacherId':'t1','max':rng.randint(0,max(ds)),'acrossBreak':bool(index%2)}]
    elif kind==2:raw['hardConstraints']=[{'type':'subjectDailyLimit','classId':'c0','subjectId':'s0','max':rng.randint(0,2)}]
    elif kind==3:
        selected=[l['id'] for l in raw['lessons'] if l['hours']==1 or l.get('blocks')==[l['hours']]][:2]
        if len(selected)==2:raw['hardConstraints']=[{'type':'sameTime','lessonIds':selected}]
    elif kind==4:raw['hardConstraints']=[{'type':'differentDays','lessonIds':[l['id'] for l in raw['lessons']][:2]}]
    elif kind==5:raw['teachers'][0]['availability']={'blockedSlots':[{'day':'d0','period':1}]}
    elif kind==6:raw['resources'][0]['capacity']=1
    elif kind==7:raw['fixed']=[{'classId':'c0','day':'d0','period':ds[0],'subjectId':'s0'}]
    elif kind==8:raw['subjects'][0]['availability']={'allowedDays':['d0']}
    try:
        p,q,valid,best=oracle(raw,options);r=solve_timetable(raw,options);summary['cases']+=1
        if not valid:
            summary['infeasible']+=1
            assert r['status']=='infeasible' and not r['candidates'],(index,'false feasibility',r)
        else:
            summary['feasible']+=1
            assert r['status']=='feasible' and r['candidates'],(index,'missed feasible',r)
            c=r['candidates'][0];assert inspect_schedule(p,c['placements'],p['fixed']+options.get('locks',[]))['valid'],(index,'invalid returned placement')
            actual=(c['changedCells'],c['evaluation']['totalPenalty']) if options.get('previous') is not None else c['evaluation']['totalPenalty']
            assert actual==best,(index,'non-optimal result',actual,best)
            assert c['optimality']['provenOptimal'],(index,'optimum not proved',c['optimality'])
            assert c['optimality']['lowerBound']==c['evaluation']['totalPenalty'] and c['optimality']['absoluteGap']==0,(index,'incorrect quality proof',c['optimality'])
            if options.get('previous') is not None:
                assert r['changeOptimality']['provenMinimumChanges'] and r['changeOptimality']['bestChangedCells']==best[0],(index,'incorrect change proof',r['changeOptimality'],best)
            summary['provedOptimal']+=1
        alternate=solve_timetable(raw,{**options,'searchStrategy':'adaptive'})
        assert alternate['status']==r['status'],(index,'adaptive status mismatch',alternate)
        if valid:
            c=alternate['candidates'][0]
            actual=(c['changedCells'],c['evaluation']['totalPenalty']) if options.get('previous') is not None else c['evaluation']['totalPenalty']
            assert actual==best and inspect_schedule(p,c['placements'],p['fixed']+options.get('locks',[]))['valid'],(index,'adaptive optimum mismatch',actual,best)
            assert c['optimality']['provenOptimal'] and c['optimality']['lowerBound']==c['evaluation']['totalPenalty'],(index,'adaptive proof mismatch',c['optimality'])
        else:
            assert not alternate['candidates']
        summary['adaptiveCases']+=1
        print(f'  ✓ 전수열거 사례 {index+1}: 두 탐색 모드의 하드조건·품질·최적성 일치')
    except Exception as e:
        summary['violations'].append({'case':index,'error':str(e),'problem':raw,'options':options})
print(json.dumps(summary,ensure_ascii=True))
if summary['violations']:
    raise SystemExit(1)
