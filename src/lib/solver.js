// ══════════════════════════════════════
//  CP-SAT 백트래킹 솔버 v3
//  원본 알고리즘 + cnt 기반 전파 개선
// ══════════════════════════════════════

import {
  CLS, TCH, SBJ, SP, DAYS, DP, DAILY, D2N, enc, decS, getHR, gC,
  spAppliesToClass, isEmptyReservation,
} from './timetableData.js';

// ─── 소프트 제약 가중치 ───
export const SW = { S1:10, S2:3, S3:4, S4:5, S5:4 };

// ─── 주제선택 과목 (gradeOnly 슬롯 전용) ───
const TOPIC_SUBS = new Set(['s18','s19','s20','s21','s22','s23']);

// 하루 실제 교시 수 (DP 기준) — 요일 index 배열
const PER_DAY = DAYS.map(d => DP[d]);   // [6,7,6,7,6]

// ─── 수업(반·과목)의 후보 슬롯 계산 — SP 제약을 도메인에 반영 ───
//  · 정보 고정 (classId+subjectId 일치) → 그 슬롯 1칸만
//  · 주제선택 과목 (s18~s23)          → 해당 학년 gradeOnly 슬롯만
//  · 일반 과목                        → 창체/gradeOnly/타반 정보 슬롯 제외
function candidateSlots(cls, sid, al) {
  // 정보 고정: (반, 과목) 이 classId+subjectId SP 와 일치하면 그 슬롯으로 고정
  const fixed = SP.find(sp => sp.classId === cls.id && sp.subjectId === sid);
  if (fixed) return [enc(DAYS.indexOf(fixed.day), fixed.p)];

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
      const baseSlots = candidateSlots(cls, a.s, al);   // SP 제약 반영된 후보 슬롯
      for(let i=0; i<a.h; i++){
        const isM1 = (a.s==='s5' && ['c1','c2','c3'].includes(a.c));
        L.push({ id:id++, cid:a.c, sid:a.s, tid:t.id, slots:[...baseSlots], isM1 });
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

  lessons.forEach((l,i) => {
    if(asgn[i]<0) return;
    const {d} = decS(asgn[i]);
    cs.set(`${l.cid}-${asgn[i]}`,i);
    ts.set(`${l.tid}-${asgn[i]}`,i);
    cnt[l.cid][d]++;
    if(l.isM1) m1d.set(`${l.cid}-${d}`,i);
  });

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
