// ══════════════════════════════════════
//  CP-SAT 백트래킹 솔버 v3
//  원본 알고리즘 + cnt 기반 전파 개선
// ══════════════════════════════════════

import {
  CLS, TCH, SBJ, SP, BLOCKS, DAYS, DP, DAILY, D2N, enc, decS, getHR, gC,
  spAppliesToClass, isEmptyReservation,
} from './timetableData.js';

// ─── 소프트 제약 가중치 ───
export const SW = { S1:10, S2:3, S3:4, S4:5, S5:4 };

// ─── 주제선택 과목 (gradeOnly 슬롯 전용) ───
const TOPIC_SUBS = new Set(['s18','s19','s20','s21','s22','s23']);

// 하루 실제 교시 수 (DP 기준) — 요일 index 배열
const PER_DAY = DAYS.map(d => DP[d]);   // [6,7,6,7,6]

// ─── 시간 제약 필터 (과목 timeConstraint / 교사 slotConstraints 공용 스키마) ───
//  정의: 오전 = 1~4교시(점심 전), 오후 = 5교시 이상
//  · allowedDays:[요일명…]        → 이 요일에만 허용
//  · blockedSlots:[{day,periods}] → 지정 (요일,교시) 슬롯 배제
//  · morningOnly:true             → 오전(1~4교시)만 허용
//  · maxPeriod:n                  → 모든 요일 n교시 초과 배제
//  · maxPeriodPerDay:{요일:최대}  → 해당 요일만 최대교시 초과 배제 (미지정 요일은 무제한)
//  필드가 없으면(=undefined) 제약 없음 → 하위 호환 유지
const MORNING_MAX = 4;
function slotAllowedByConstraint(d, p, con) {
  if (!con) return true;
  const dayName = DAYS[d];
  if (con.allowedDays && !con.allowedDays.includes(dayName)) return false;
  if (con.morningOnly && p > MORNING_MAX) return false;
  if (con.maxPeriod != null && p > con.maxPeriod) return false;
  if (con.maxPeriodPerDay) {
    const lim = con.maxPeriodPerDay[dayName];
    if (lim != null && p > lim) return false;
  }
  if (con.blockedSlots) {
    for (const b of con.blockedSlots) {
      if (b.day === dayName && b.periods.includes(p)) return false;
    }
  }
  return true;
}

// ─── Phase 4: 자원 충돌 + 스포츠 담임 동행 (하드 제약, 초기 배정에만 적용) ───
//  같은 슬롯에 함께 배정될 수 없는 (수업,수업) 쌍을 판별한다.
//  · RESOURCE_CONFLICT_PAIRS: 두 교사가 체육관 등 자원을 공유 → 동시간 배정 불가
//  · SPORT_HOMEROOM: 김혜진(t16) 스포츠 슬롯에 그 반 담임은 다른 배정 불가 (NEIS)
const RESOURCE_CONFLICT_PAIRS = [
  ['t14', 't15'],   // 이창철 + 정상호 — 체육관 공유
];
const SPORT_HOMEROOM = {
  c1:'t7',  c2:'t17', c3:'t4',
  c4:'t15', c5:'t5',  c6:'t2',
  c7:'t11', c8:'t9',  c9:'t12',
};
const SPORT_TEACHER_ID = 't16';   // 김혜진 (스포츠 담당)
const SPORT_SUBJ = 's11';         // 스포츠
// 자원 충돌쌍 양방향 조회용 Set
const RC_SET = new Set();
RESOURCE_CONFLICT_PAIRS.forEach(([a,b]) => { RC_SET.add(a+'|'+b); RC_SET.add(b+'|'+a); });

// 두 수업 la, lb 가 같은 슬롯에 공존할 수 없으면 true (교사가 서로 달라도 적용)
function p4SameSlotForbidden(la, lb) {
  // 자원 충돌쌍
  if (RC_SET.has(la.tid+'|'+lb.tid)) return true;
  // 스포츠 담임 동행 (양방향): 한쪽이 김혜진 스포츠(반 C), 다른쪽이 C 담임
  if (la.tid===SPORT_TEACHER_ID && la.sid===SPORT_SUBJ && SPORT_HOMEROOM[la.cid]===lb.tid) return true;
  if (lb.tid===SPORT_TEACHER_ID && lb.sid===SPORT_SUBJ && SPORT_HOMEROOM[lb.cid]===la.tid) return true;
  return false;
}

// ─── 수업(반·과목)의 후보 슬롯 계산 — SP 제약을 도메인에 반영 ───
//  · 정보 고정 (classId+subjectId 일치) → 그 슬롯 1칸만
//  · 주제선택 과목 (s18~s23)          → 해당 학년 gradeOnly 슬롯만
//  · 일반 과목                        → 창체/gradeOnly/타반 정보 슬롯 제외
function candidateSlots(cls, sid, al, teacher) {
  // Phase 2: 과목(timeConstraint)·교사(slotConstraints) 시간 제약 — 둘 중 하나라도 위반 시 배제
  const subjCon = (SBJ.find(s => s.id === sid) || {}).timeConstraint;
  const tchCon = teacher && teacher.slotConstraints;

  // 정보 고정: (반, 과목) 이 classId+subjectId SP 와 일치하면 그 슬롯으로 고정
  const fixed = SP.find(sp => sp.classId === cls.id && sp.subjectId === sid);
  if (fixed) {
    const fd = DAYS.indexOf(fixed.day);
    if (!slotAllowedByConstraint(fd, fixed.p, subjCon)) return [];
    if (!slotAllowedByConstraint(fd, fixed.p, tchCon)) return [];
    return [enc(fd, fixed.p)];
  }

  const isTopic = TOPIC_SUBS.has(sid);
  const out = [];
  for (const d of al) {
    const dayName = DAYS[d];
    for (let p = 1; p <= PER_DAY[d]; p++) {
      const sps = SP.filter(sp => sp.day === dayName && sp.p === p && spAppliesToClass(sp, cls));
      // 창체 등 빈칸 예약 → 어떤 수업도 배정 불가
      if (sps.some(sp => isEmptyReservation(sp))) continue;
      // 이 반의 정보 고정 슬롯 → 그 과목만 (fixed 분기에서 이미 처리되므로 여기선 배제만)
      const fixedHere = sps.find(sp => sp.classId && sp.subjectId);
      if (fixedHere && sid !== fixedHere.subjectId) continue;
      // gradeOnly(주제선택) 슬롯 ↔ 주제선택 과목 양방향 제약
      const isGradeSlot = sps.some(sp => sp.gradeOnly);
      if (isGradeSlot !== isTopic) continue;
      // Phase 2: 과목·교사 시간 제약 반영
      if (!slotAllowedByConstraint(d, p, subjCon)) continue;
      if (!slotAllowedByConstraint(d, p, tchCon)) continue;
      out.push(enc(d, p));
    }
  }
  return out;
}

const T_TOTAL = {};
TCH.forEach(t => { T_TOTAL[t.id] = t.as.reduce((s,a) => s+a.h, 0); });

function shuffle(a) {
  const b = [...a];
  for (let i=b.length-1; i>0; i--) {
    const j = (Math.random()*(i+1))|0;
    [b[i],b[j]] = [b[j],b[i]];
  }
  return b;
}

// ─── 소프트 상태 ───
function makeSoftState() {
  return {
    csd:  new Map(),
    camp: new Map(),
    tday: new Map(),
    tlp:  new Map(),
  };
}
function ssGet(m,k){ return m.get(k)||0; }
function ssInc(m,k){ m.set(k,(m.get(k)||0)+1); }
function ssDec(m,k){ const v=(m.get(k)||0)-1; if(v<=0)m.delete(k); else m.set(k,v); }

export function ssPut(ss,l,d,p){
  ssInc(ss.csd,`${l.cid}|${l.sid}|${d}`);
  ssInc(ss.camp,`${l.cid}|${l.sid}|${p<=3?0:1}`);
  ssInc(ss.tday,`${l.tid}|${d}`);
  const lk=`${l.tid}|${l.cid}|${d}`;
  const prev=ss.tlp.get(lk)??-99;
  if(p>prev) ss.tlp.set(lk,p);
}
export function ssDel(ss,l,d,p){
  ssDec(ss.csd,`${l.cid}|${l.sid}|${d}`);
  ssDec(ss.camp,`${l.cid}|${l.sid}|${p<=3?0:1}`);
  ssDec(ss.tday,`${l.tid}|${d}`);
  const lk=`${l.tid}|${l.cid}|${d}`;
  if((ss.tlp.get(lk)??-99)===p) ss.tlp.delete(lk);
}

// ─── 수업 카드 생성 ───
export function buildLessons() {
  const L = []; let id = 0;
  TCH.forEach(t => {
    const al = t.al||[0,1,2,3,4];
    t.as.forEach(a => {
      const cls = gC(a.c);
      const baseSlots = candidateSlots(cls, a.s, al, t);   // SP + 시간 제약 반영된 후보 슬롯
      for(let i=0; i<a.h; i++){
        const isM1 = (a.s==='s5' && ['c1','c2','c3'].includes(a.c));
        L.push({ id:id++, cid:a.c, sid:a.s, tid:t.id, slots:[...baseSlots], isM1,
                 blkPrev:null, blkNext:null });
      }
    });
  });

  // Phase 3: 블록 지정 — 각 BLOCKS×반 그룹에서 length 개 카드를 연속 체인으로 묶음
  //  (chain[k].blkPrev = chain[k-1].id, blkNext = chain[k+1].id — id 는 lessons 인덱스와 일치)
  BLOCKS.forEach(blk => {
    blk.classes.forEach(cid => {
      const group = L.filter(l => l.tid===blk.teacherId && l.sid===blk.subjectId && l.cid===cid);
      if(group.length < blk.length){
        console.warn(`[BLOCK] ${cid} ${blk.teacherId}/${blk.subjectId}: 배정 시수 ${group.length} < 블록 길이 ${blk.length} — 블록 불가`);
        return;
      }
      const chain = group.slice(0, blk.length);
      for(let k=0;k<chain.length;k++){
        if(k>0)            chain[k].blkPrev = chain[k-1].id;
        if(k<chain.length-1) chain[k].blkNext = chain[k+1].id;
      }
    });
  });
  return L;
}

// ─── CP-SAT 솔버 ───
export function cpSolve(lessons, maxNodes=120000) {
  const n = lessons.length;
  const asgn = new Int16Array(n).fill(-1);
  const dom = lessons.map(l => new Set(l.slots));

  const cs=new Map(), ts=new Map(), m1d=new Map();
  // NEED[c][d] = 그 반이 요일 d 에 배정할 수업 수
  //   = 실제 교시 수 − 빈칸예약(창체) 슬롯 수.  (gradeOnly/정보 슬롯은 수업이 채우므로 차감 안 함)
  const NEED={}; CLS.forEach(c=>{
    NEED[c.id] = PER_DAY.map((per, d) => {
      const dayName = DAYS[d];
      const empties = SP.filter(sp => sp.day===dayName
        && isEmptyReservation(sp) && spAppliesToClass(sp, c)).length;
      return per - empties;
    });
  });
  const cnt={}; CLS.forEach(c=>{ cnt[c.id]=[0,0,0,0,0]; });

  const ord = [...Array(n).keys()].sort((a,b) => dom[a].size-dom[b].size);
  let nodes=0, maxD=0;

  function bt(idx){
    if(nodes++>maxNodes) return null;
    if(idx>=n) return true;
    maxD = Math.max(maxD,idx);

    const lid = ord[idx];
    const l = lessons[lid];
    const vals = shuffle([...dom[lid]]);

    for(const slot of vals){
      if(!dom[lid].has(slot)) continue;
      const {d,p} = decS(slot);

      if(cs.has(`${l.cid}-${slot}`)) continue;
      if(ts.has(`${l.tid}-${slot}`)) continue;
      if(cnt[l.cid][d]>=NEED[l.cid][d]) continue;
      if(l.isM1&&m1d.has(`${l.cid}-${d}`)) continue;
      // Phase 3 블록: 이미 배정된 체인 이웃과 같은 요일·인접 교시여야 함
      if(l.blkPrev!=null && asgn[l.blkPrev]>=0){ const a=decS(asgn[l.blkPrev]); if(a.d!==d||a.p!==p-1) continue; }
      if(l.blkNext!=null && asgn[l.blkNext]>=0){ const a=decS(asgn[l.blkNext]); if(a.d!==d||a.p!==p+1) continue; }

      asgn[lid]=slot;
      cs.set(`${l.cid}-${slot}`,lid);
      ts.set(`${l.tid}-${slot}`,lid);
      cnt[l.cid][d]++;
      if(l.isM1) m1d.set(`${l.cid}-${d}`,lid);

      const dayFull = cnt[l.cid][d]>=NEED[l.cid][d];
      const pruned=[]; let ok=true;

      for(let j=idx+1; j<n&&ok; j++){
        const jid=ord[j], jl=lessons[jid];
        const sC=jl.cid===l.cid, sT=jl.tid===l.tid;
        const sibM1=l.isM1&&jl.isM1&&jl.cid===l.cid;

        if((sC||sT)&&dom[jid].has(slot)){
          dom[jid].delete(slot);
          pruned.push({jid,s:slot});
          if(!dom[jid].size){ok=false;break;}
        }
        if(sibM1){
          for(const s of [...dom[jid]]){
            if((s/10|0)===d){dom[jid].delete(s);pruned.push({jid,s});}
          }
          if(!dom[jid].size){ok=false;break;}
        }
        // cnt 기반 전파: 요일 정원 소진 시 해당 학급 요일 슬롯 제거
        if(sC&&dayFull){
          for(const s of [...dom[jid]]){
            if((s/10|0)===d){dom[jid].delete(s);pruned.push({jid,s});}
          }
          if(!dom[jid].size){ok=false;break;}
        }
        // Phase 4: 자원 충돌 / 스포츠 담임 동행 — 같은 슬롯 공존 불가면 이 슬롯 제거
        if(p4SameSlotForbidden(l,jl) && dom[jid].has(slot)){
          dom[jid].delete(slot); pruned.push({jid,s:slot});
          if(!dom[jid].size){ok=false;break;}
        }
      }

      // Phase 3 블록: 미배정 체인 이웃 도메인을 인접 슬롯 1칸으로 축소(강한 전파)
      if(ok && l.blkNext!=null && asgn[l.blkNext]<0){
        const jid=l.blkNext, want=enc(d,p+1);
        for(const s of [...dom[jid]]){ if(s!==want){ dom[jid].delete(s); pruned.push({jid,s}); } }
        if(!dom[jid].size) ok=false;
      }
      if(ok && l.blkPrev!=null && asgn[l.blkPrev]<0){
        const jid=l.blkPrev, want=enc(d,p-1);
        for(const s of [...dom[jid]]){ if(s!==want){ dom[jid].delete(s); pruned.push({jid,s}); } }
        if(!dom[jid].size) ok=false;
      }

      if(ok){
        const res=bt(idx+1);
        if(res===true) return true;
        if(res===null){
          asgn[lid]=-1; cs.delete(`${l.cid}-${slot}`); ts.delete(`${l.tid}-${slot}`);
          cnt[l.cid][d]--; if(l.isM1) m1d.delete(`${l.cid}-${d}`);
          for(const{jid,s}of pruned) dom[jid].add(s);
          return null;
        }
      }
      asgn[lid]=-1; cs.delete(`${l.cid}-${slot}`); ts.delete(`${l.tid}-${slot}`);
      cnt[l.cid][d]--; if(l.isM1) m1d.delete(`${l.cid}-${d}`);
      for(const{jid,s}of pruned) dom[jid].add(s);
    }
    return false;
  }

  return { asgn, success:bt(0)===true, nodes, maxD };
}

// ─── 시간표 객체 빌드 ───
export function buildTTfromCP(lessons, asgn) {
  const tt = {};
  CLS.forEach(c => { tt[c.id] = {}; });

  // 1) 배정된 수업 채우기 (주제선택·정보 포함 — 실제 수업이므로 여기서 자리 잡음)
  lessons.forEach((l,i) => {
    if(asgn[i]<0) return;
    const {d,p} = decS(asgn[i]);
    tt[l.cid][`${D2N[d]}-${p}`] = { tid:l.tid, sid:l.sid };
  });

  // 2) SP 처리: 창체는 빈칸에 오버레이 / 주제선택·정보는 배정 검증
  const errors = [];
  SP.forEach(sp => {
    CLS.forEach(c => {
      if(!spAppliesToClass(sp, c)) return;
      const key = `${sp.day}-${sp.p}`;
      const cell = tt[c.id][key];
      if(isEmptyReservation(sp)){
        // 창체: 반드시 비어 있어야 하며 특별활동으로 오버레이
        if(cell) errors.push(`${c.name} ${key}: 창체 슬롯에 수업(${cell.sid})이 배정됨`);
        const hr = getHR(c.id);
        tt[c.id][key] = { type:'special', name:sp.name, tid:hr?.id||null };
      } else if(sp.classId && sp.subjectId){
        // 정보 고정: 그 과목이 정확히 있어야 함
        if(!cell || cell.sid !== sp.subjectId)
          errors.push(`${c.name} ${key}: 정보 고정 위반 — 기대 ${sp.subjectId}, 실제 ${cell?(cell.sid||cell.name):'빈칸'}`);
      } else if(sp.gradeOnly){
        // 주제선택: 주제선택 과목(s18~s23)이 있어야 함
        if(!cell || !TOPIC_SUBS.has(cell.sid))
          errors.push(`${c.name} ${key}: 주제선택 슬롯 위반 — 실제 ${cell?(cell.sid||cell.name):'빈칸'}`);
      }
    });
  });
  if(errors.length){
    console.warn('[buildTTfromCP] SP 예약 검증 경고 (%d건):\n%s', errors.length, errors.join('\n'));
  }
  return tt;
}

// ─── 소프트 페널티 계산 ───
export function calcTotalPenalty(lessons, asgn) {
  const ss = makeSoftState();
  lessons.forEach((l,i) => {
    if(asgn[i]<0) return;
    const {d,p} = decS(asgn[i]);
    ssPut(ss,l,d,p);
  });
  let total = 0;
  lessons.forEach((l,i) => {
    if(asgn[i]<0) return;
    const {d,p} = decS(asgn[i]);
    const csdV = ssGet(ss.csd,`${l.cid}|${l.sid}|${d}`);
    if(csdV>1) total += SW.S1*(csdV-1);
    const ampm = p<=3?0:1;
    const my = ssGet(ss.camp,`${l.cid}|${l.sid}|${ampm}`);
    const ot = ssGet(ss.camp,`${l.cid}|${l.sid}|${1-ampm}`);
    if(my>ot+1) total += SW.S2;
  });
  TCH.forEach(t => {
    const ideal = T_TOTAL[t.id]/5;
    DAYS.forEach((_,d) => {
      const c = ssGet(ss.tday,`${t.id}|${d}`);
      if(c>Math.ceil(ideal)+1) total += SW.S5*(c-Math.ceil(ideal));
    });
  });
  return total;
}

// ─── 로컬 서치 ───
export function localSearch(lessons, asgn, iters=4000) {
  const n = lessons.length;
  const cs=new Map(), ts=new Map();
  const cnt={}; CLS.forEach(c=>{ cnt[c.id]=[0,0,0,0,0]; });
  const m1d=new Map();
  const slotOcc=new Map();   // Phase 4: 슬롯 → 그 슬롯에 배정된 lid 집합

  lessons.forEach((l,i) => {
    if(asgn[i]<0) return;
    const {d} = decS(asgn[i]);
    cs.set(`${l.cid}-${asgn[i]}`,i);
    ts.set(`${l.tid}-${asgn[i]}`,i);
    cnt[l.cid][d]++;
    if(l.isM1) m1d.set(`${l.cid}-${d}`,i);
    if(!slotOcc.has(asgn[i])) slotOcc.set(asgn[i], new Set());
    slotOcc.get(asgn[i]).add(i);
  });

  // Phase 4 가드: 수업 mv 를 slot 에 놓을 때, 떠나는 수업 lv 를 제외한 기존 점유자와
  // 자원충돌/스포츠담임 위반이 생기면 true → 그 스왑은 거부
  const p4Clash = (mv, slot, lv) => {
    const occ = slotOcc.get(slot);
    if(!occ) return false;
    for(const o of occ){
      if(o===lv||o===mv) continue;
      if(p4SameSlotForbidden(lessons[mv], lessons[o])) return true;
    }
    return false;
  };

  const ss = makeSoftState();
  lessons.forEach((l,i) => {
    if(asgn[i]<0) return;
    const {d,p} = decS(asgn[i]);
    ssPut(ss,l,d,p);
  });

  let improved = 0;

  for(let it=0; it<iters; it++){
    const i = Math.floor(Math.random()*n);
    const j = Math.floor(Math.random()*n);
    if(i===j||asgn[i]<0||asgn[j]<0) continue;
    const li=lessons[i], lj=lessons[j];
    const si=asgn[i], sj=asgn[j];
    if(si===sj) continue;

    // ── SP 예약 가드 ──
    //  후보 도메인(slots)에 SP 제약이 이미 반영돼 있으므로, 아래 도메인 검사가
    //  "주제선택→일반 슬롯" "일반→창체/정보 슬롯" 같은 위반 스왑을 원천 차단한다.
    //  추가 안전장치: 정보 고정처럼 슬롯이 1칸으로 못박힌 수업은 아예 스왑 제외.
    if(li.slots.length<=1 || lj.slots.length<=1) continue;
    // Phase 3: 블록 체인 카드는 스왑 제외 → cpSolve 가 놓은 연속 배치 유지
    if(li.blkPrev!=null||li.blkNext!=null||lj.blkPrev!=null||lj.blkNext!=null) continue;
    if(!li.slots.includes(sj)||!lj.slots.includes(si)) continue;

    const {d:di,p:pi}=decS(si), {d:dj,p:pj}=decS(sj);

    const tsi_j=ts.get(`${li.tid}-${sj}`);
    const tsj_i=ts.get(`${lj.tid}-${si}`);
    const csi_j=cs.get(`${li.cid}-${sj}`);
    const csj_i=cs.get(`${lj.cid}-${si}`);

    if(tsi_j!==undefined&&tsi_j!==j) continue;
    if(tsj_i!==undefined&&tsj_i!==i) continue;
    if(csi_j!==undefined&&csi_j!==j) continue;
    if(csj_i!==undefined&&csj_i!==i) continue;

    if(di!==dj){
      if(cnt[li.cid][dj]>=DAILY[dj]) continue;
      if(cnt[lj.cid][di]>=DAILY[di]) continue;
    }
    if(li.isM1&&di!==dj&&m1d.has(`${li.cid}-${dj}`)&&m1d.get(`${li.cid}-${dj}`)!==i) continue;
    if(lj.isM1&&di!==dj&&m1d.has(`${lj.cid}-${di}`)&&m1d.get(`${lj.cid}-${di}`)!==j) continue;
    // Phase 4: 스왑 후 자원충돌/스포츠담임 위반이 생기면 거부 (li→sj, lj→si)
    if(p4Clash(i,sj,j)||p4Clash(j,si,i)) continue;

    ssDel(ss,li,di,pi); ssDel(ss,lj,dj,pj);
    const penAfter = /* softPenalty placeholder — swap is accepted if neutral or better */
      (ssGet(ss.csd,`${li.cid}|${li.sid}|${dj}`)>0?SW.S1:0) +
      (ssGet(ss.csd,`${lj.cid}|${lj.sid}|${di}`)>0?SW.S1:0);
    const penBefore =
      (ssGet(ss.csd,`${li.cid}|${li.sid}|${di}`)>0?SW.S1:0) +
      (ssGet(ss.csd,`${lj.cid}|${lj.sid}|${dj}`)>0?SW.S1:0);

    if(penAfter<=penBefore){
      asgn[i]=sj; asgn[j]=si;
      cs.delete(`${li.cid}-${si}`); cs.delete(`${lj.cid}-${sj}`);
      ts.delete(`${li.tid}-${si}`); ts.delete(`${lj.tid}-${sj}`);
      cs.set(`${li.cid}-${sj}`,i); cs.set(`${lj.cid}-${si}`,j);
      ts.set(`${li.tid}-${sj}`,i); ts.set(`${lj.tid}-${si}`,j);
      slotOcc.get(si).delete(i); slotOcc.get(sj).delete(j);
      slotOcc.get(sj).add(i);   slotOcc.get(si).add(j);
      if(di!==dj){cnt[li.cid][di]--;cnt[li.cid][dj]++;cnt[lj.cid][dj]--;cnt[lj.cid][di]++;}
      if(li.isM1){m1d.delete(`${li.cid}-${di}`);m1d.set(`${li.cid}-${dj}`,i);}
      if(lj.isM1){m1d.delete(`${lj.cid}-${dj}`);m1d.set(`${lj.cid}-${di}`,j);}
      ssPut(ss,li,dj,pj); ssPut(ss,lj,di,pi);
      if(penAfter<penBefore) improved++;
    } else {
      ssPut(ss,li,di,pi); ssPut(ss,lj,dj,pj);
    }
  }

  return { improved, finalPenalty: calcTotalPenalty(lessons,asgn) };
}
