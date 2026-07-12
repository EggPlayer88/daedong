// ═══════════════════════════════════════════════════════════════════
//  timetableData.js — 대동여중 학교 데이터 (정적 상수 + 헬퍼)
// ═══════════════════════════════════════════════════════════════════
//  2026학년도 2학기 시수표 반영 (2026-05-28 갱신).
//
//  Phase 5-A 부터 이 파일의 학교 데이터 상수 (SBJ / CLS / DEPT / TCH) 는
//  DB 의 동일 데이터의 mirror 입니다. 진실의 원천 (source of truth) 은
//  여전히 이 파일.
//
//  · 마이그레이션 008 — subjects / classes / departments / teacher_assignments
//    테이블 생성 + teachers 컬럼 보강 (homeroom_class_id / day_restriction /
//    is_placeholder / is_external).
//  · 마이그레이션 009 — 이 파일의 상수를 직렬화한 INSERT (자동 생성).
//
//  D3 결정 (C-2 = 순수 시드만): 코드 변경 없음. 모든 사용처(16개 파일) 가
//  동기 API 그대로 동작. Phase 5-B 에서 학교 설정 페이지 부활 시
//  진실의 원천을 DB 로 이동 예정.
//
//  코드와 DB 의 양면 일치 검증:
//    import('./schoolDataAPI.js').then(m => m.verifySchoolDataIntegrity())
//
//  운영 규칙·시각 자원 (DAYS / DP / DAILY / SP / D2N / TIMES / CLR) 과
//  순수 함수 (enc / decS / isV / getSP / gS / gC / gT / getHR) 는
//  DB 화 대상 아님 — 학교 차원 거의 불변 + 모듈 로드 시점 동기 사용.
//
//  2026-2학기 갱신 사항:
//   · SBJ: 16개 → 24개 (신규 리터러시, 주제선택 6개, 영원 추가)
//   · TCH: 24명 placeholder → 22명 실명 (담임 미배정, 근무요일 제약 없음)
//   · 외부강사 구분(isExt) 미사용 — 모든 교사 동등 취급
//   · 담임(hr/hc)은 배정 후 별도 반영 예정
// ═══════════════════════════════════════════════════════════════════

export const DAYS = ['월','화','수','목','금'];
export const DP = { 월:6, 화:7, 수:6, 목:7, 금:6 };
export const DAILY = [6,7,6,6,6]; // 창체 제외 정규 수업 정원
// ─── 특별활동·고정 슬롯 (SP) ───
//  3가지 형태를 지원 (하위 호환 유지):
//   a. name 만        → 모든 반에서 그 슬롯을 "빈칸 예약" (창체). 어떤 수업도 배정 불가.
//   b. gradeOnly:g    → 해당 학년 반들의 이 슬롯은 주제선택 과목(s18~s23) 전용.
//   c. classId+subjectId → 해당 반의 그 슬롯에 반드시 그 과목만 배정 (정보 고정).
export const SP = [
  { name:'창체', day:'목', p:7 },
  // 주제선택 슬롯 (1학년 전용, 6슬롯) — s18~s23 만 배정, 다른 과목은 배제
  { name:'주제선택', day:'월', p:5, gradeOnly:1 },
  { name:'주제선택', day:'월', p:6, gradeOnly:1 },
  { name:'주제선택', day:'화', p:6, gradeOnly:1 },
  { name:'주제선택', day:'화', p:7, gradeOnly:1 },
  { name:'주제선택', day:'수', p:5, gradeOnly:1 },
  { name:'주제선택', day:'수', p:6, gradeOnly:1 },
  // 정보 고정 (2학년 특정 반, 목 2/3/4교시) — 해당 반의 s7(정보)이 반드시 이 슬롯
  { name:'정보', day:'목', p:2, classId:'c4', subjectId:'s7' },
  { name:'정보', day:'목', p:3, classId:'c5', subjectId:'s7' },
  { name:'정보', day:'목', p:4, classId:'c6', subjectId:'s7' },
];
export const D2N = { 0:'월', 1:'화', 2:'수', 3:'목', 4:'금' };
export const TIMES = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00'];

export const enc = (d,p) => d*10+p;
export const decS = s => ({ d:(s/10)|0, p:s%10 });
export const isV = (d,p) => p<=(DP[d]||0);

// SP 항목이 특정 반에 적용되는가?
//  classId → 그 반만 / gradeOnly → 그 학년만 / 둘 다 없으면 → 모든 반(창체)
export const spAppliesToClass = (sp, cls) => {
  if (sp.classId)  return sp.classId === cls.id;
  if (sp.gradeOnly) return sp.gradeOnly === cls.g;
  return true;
};
// "빈칸 예약" (창체류) — 수업이 채우지 않고 비워두는 슬롯인가?
export const isEmptyReservation = sp => !sp.gradeOnly && !sp.classId;

// getSP(d, p [, classId] [, grade]) — 하위 호환 확장.
//  · 인자 2개(기존 호출)  → 창체(범용 빈칸예약)만 반환 (없으면 null)
//  · classId / grade 지정 → 그 반/학년에 적용되는 SP 반환 (여러 개면 배열)
export const getSP = (d, p, classId = null, grade = null) => {
  const hits = SP.filter(s => s.day === d && s.p === p);
  if (!hits.length) return null;
  if (classId == null && grade == null) {
    return hits.find(s => isEmptyReservation(s)) || null;
  }
  const cls = classId != null ? gC(classId) : null;
  const g = grade != null ? grade : cls?.g;
  const matched = hits.filter(s => {
    if (s.classId)  return s.classId === classId;
    if (s.gradeOnly) return s.gradeOnly === g;
    return true;
  });
  if (!matched.length) return null;
  return matched.length === 1 ? matched[0] : matched;
};

export const CLR = [
  {bg:'#B5D4F4',tx:'#042C53'},{bg:'#CECBF6',tx:'#26215C'},{bg:'#9FE1CB',tx:'#04342C'},
  {bg:'#FAC775',tx:'#412402'},{bg:'#F4C0D1',tx:'#4B1528'},{bg:'#C0DD97',tx:'#173404'},
  {bg:'#F0997B',tx:'#4A1B0C'},{bg:'#D3D1C7',tx:'#2C2C2A'},{bg:'#E1F5EE',tx:'#085041'},
  {bg:'#FFF3CD',tx:'#856404'},{bg:'#EEEDFE',tx:'#3C3489'},
];

export const SBJ = [
  {id:'s1', name:'국어',    ci:1, gh:{1:4,2:4,3:4}},
  {id:'s2', name:'사회',    ci:3, gh:{1:2,2:0,3:2}},
  {id:'s3', name:'역사',    ci:3, gh:{1:0,2:3,3:2}},
  {id:'s4', name:'도덕',    ci:7, gh:{1:1,2:0,3:2}},
  {id:'s5', name:'수학',    ci:0, gh:{1:4,2:4,3:4}},
  {id:'s6', name:'리터러시',ci:10,gh:{1:2,2:0,3:0}},
  {id:'s7', name:'정보',    ci:8, gh:{1:0,2:1,3:0}},
  {id:'s8', name:'기술가정',ci:6, gh:{1:0,2:4,3:2}},
  {id:'s9', name:'과학',    ci:5, gh:{1:2,2:3,3:4}},
  {id:'s10',name:'체육',    ci:10,gh:{1:3,2:3,3:3}},
  {id:'s11',name:'스포츠',  ci:9, gh:{1:1,2:1,3:1}},
  {id:'s12',name:'음악',    ci:2, gh:{1:1,2:1,3:2}},
  {id:'s13',name:'미술',    ci:4, gh:{1:2,2:2,3:0}},
  {id:'s14',name:'진로',    ci:6, gh:{1:0,2:1,3:0}},
  {id:'s15',name:'영어',    ci:2, gh:{1:2,2:2,3:3}},
  {id:'s16',name:'보건',    ci:7, gh:{1:0,2:0,3:1}},
  {id:'s17',name:'한문',    ci:9, gh:{1:0,2:1,3:0}},
  // ─── 주제선택 (1학년 전용) ───
  {id:'s18',name:'국어㈜',  ci:1, gh:{1:1,2:0,3:0}},
  {id:'s19',name:'사회㈜',  ci:3, gh:{1:1,2:0,3:0}},
  {id:'s20',name:'도덕㈜',  ci:7, gh:{1:1,2:0,3:0}},
  {id:'s21',name:'수학㈜',  ci:0, gh:{1:1,2:0,3:0}},
  {id:'s22',name:'과학㈜',  ci:5, gh:{1:1,2:0,3:0}},
  {id:'s23',name:'진로㈜',  ci:6, gh:{1:1,2:0,3:0}},
  // ─── 영어 원어민 (표시용, 배정된 교사는 정은화/고민희) ───
  {id:'s24',name:'영원',    ci:2, gh:{1:1,2:1,3:1},
   timeConstraint:{ allowedDays:['월','화','수'] }},
];

export const CLS = [
  {id:'c1',name:'1-1반',g:1},{id:'c2',name:'1-2반',g:1},{id:'c3',name:'1-3반',g:1},
  {id:'c4',name:'2-1반',g:2},{id:'c5',name:'2-2반',g:2},{id:'c6',name:'2-3반',g:2},
  {id:'c7',name:'3-1반',g:3},{id:'c8',name:'3-2반',g:3},{id:'c9',name:'3-3반',g:3},
];

// 학교 부서 목록 — Phase 5+ 에서 DB 화 예정 (SBJ/TCH/CLS 와 함께)
export const DEPT = ['교무부','연구부','학생안전부','학생생활부','진로부','정보부'];

export const TCH = [
  {id:'t1', name:'최주혜', hr:false, hc:null, al:null,
   as:[{s:'s1',c:'c3',h:4},{s:'s1',c:'c7',h:4},{s:'s1',c:'c8',h:4},{s:'s1',c:'c9',h:4}]},
  {id:'t2', name:'심원영', hr:false, hc:null, al:null,
   as:[{s:'s1',c:'c1',h:4},{s:'s1',c:'c2',h:4},{s:'s1',c:'c4',h:3},{s:'s1',c:'c5',h:3},{s:'s1',c:'c6',h:3}]},
  {id:'t3', name:'이연숙', hr:false, hc:null, al:null,
   slotConstraints:{ blockedSlots:[
     {day:'월', periods:[1,2,3,4]},
     {day:'수', periods:[1,2,3,4]},
     {day:'목', periods:[1,2,3,4]},
   ]},
   as:[{s:'s1',c:'c4',h:1},{s:'s1',c:'c5',h:1},{s:'s1',c:'c6',h:1},{s:'s18',c:'c1',h:1},{s:'s18',c:'c2',h:1},{s:'s18',c:'c3',h:1},{s:'s17',c:'c4',h:1},{s:'s17',c:'c5',h:1},{s:'s17',c:'c6',h:1}]},
  {id:'t4', name:'최민희', hr:false, hc:null, al:null,
   as:[{s:'s2',c:'c1',h:2},{s:'s2',c:'c2',h:2},{s:'s2',c:'c3',h:2},{s:'s2',c:'c7',h:2},{s:'s2',c:'c8',h:2},{s:'s2',c:'c9',h:2},{s:'s19',c:'c1',h:1},{s:'s19',c:'c2',h:1},{s:'s19',c:'c3',h:1}]},
  {id:'t5', name:'오겸',   hr:false, hc:null, al:null,
   as:[{s:'s3',c:'c4',h:3},{s:'s3',c:'c5',h:3},{s:'s3',c:'c6',h:3},{s:'s3',c:'c7',h:2},{s:'s3',c:'c8',h:2},{s:'s3',c:'c9',h:2}]},
  {id:'t6', name:'이미숙', hr:false, hc:null, al:null,
   as:[{s:'s4',c:'c1',h:1},{s:'s4',c:'c2',h:1},{s:'s4',c:'c3',h:1},{s:'s4',c:'c7',h:2},{s:'s4',c:'c8',h:2},{s:'s4',c:'c9',h:2},{s:'s20',c:'c1',h:1},{s:'s20',c:'c2',h:1},{s:'s20',c:'c3',h:1}]},
  {id:'t7', name:'안수정', hr:false, hc:null, al:null,
   as:[{s:'s5',c:'c1',h:4},{s:'s5',c:'c2',h:4},{s:'s5',c:'c3',h:4},{s:'s21',c:'c1',h:1},{s:'s21',c:'c2',h:1},{s:'s21',c:'c3',h:1}]},
  {id:'t8', name:'윤경선', hr:false, hc:null, al:null,
   as:[{s:'s5',c:'c4',h:4},{s:'s5',c:'c5',h:4},{s:'s5',c:'c6',h:4},{s:'s5',c:'c7',h:1},{s:'s5',c:'c8',h:1},{s:'s5',c:'c9',h:1}]},
  {id:'t9', name:'임영진', hr:false, hc:null, al:null,
   as:[{s:'s5',c:'c7',h:3},{s:'s5',c:'c8',h:3},{s:'s5',c:'c9',h:3},{s:'s6',c:'c1',h:2},{s:'s6',c:'c2',h:2},{s:'s6',c:'c3',h:2}]},
  {id:'t10',name:'고순옥', hr:false, hc:null, al:null,
   as:[{s:'s7',c:'c4',h:1},{s:'s7',c:'c5',h:1},{s:'s7',c:'c6',h:1}]},
  {id:'t11',name:'이이현', hr:false, hc:null, al:null,
   as:[{s:'s8',c:'c4',h:4},{s:'s8',c:'c5',h:4},{s:'s8',c:'c6',h:4},{s:'s8',c:'c7',h:2},{s:'s8',c:'c8',h:2},{s:'s8',c:'c9',h:2}]},
  {id:'t12',name:'장원혁', hr:false, hc:null, al:null,
   as:[{s:'s9',c:'c1',h:1},{s:'s9',c:'c2',h:1},{s:'s9',c:'c3',h:1},{s:'s9',c:'c7',h:4},{s:'s9',c:'c8',h:4},{s:'s9',c:'c9',h:4}]},
  {id:'t13',name:'선수영', hr:false, hc:null, al:null,
   as:[{s:'s9',c:'c1',h:1},{s:'s9',c:'c2',h:1},{s:'s9',c:'c3',h:1},{s:'s9',c:'c4',h:3},{s:'s9',c:'c5',h:3},{s:'s9',c:'c6',h:3},{s:'s22',c:'c1',h:1},{s:'s22',c:'c2',h:1},{s:'s22',c:'c3',h:1}]},
  {id:'t14',name:'이창철', hr:false, hc:null, al:null,
   as:[{s:'s10',c:'c1',h:1},{s:'s10',c:'c2',h:1},{s:'s10',c:'c3',h:1},{s:'s10',c:'c6',h:1},{s:'s10',c:'c7',h:3},{s:'s10',c:'c8',h:3},{s:'s10',c:'c9',h:3}]},
  {id:'t15',name:'정상호', hr:false, hc:null, al:null,
   as:[{s:'s10',c:'c1',h:2},{s:'s10',c:'c2',h:2},{s:'s10',c:'c3',h:2},{s:'s10',c:'c4',h:3},{s:'s10',c:'c5',h:3},{s:'s10',c:'c6',h:2}]},
  {id:'t16',name:'김혜진', hr:false, hc:null, al:null,
   slotConstraints:{ maxPeriod:3 },
   as:[{s:'s11',c:'c1',h:1},{s:'s11',c:'c2',h:1},{s:'s11',c:'c3',h:1},{s:'s11',c:'c4',h:1},{s:'s11',c:'c5',h:1},{s:'s11',c:'c6',h:1},{s:'s11',c:'c7',h:1},{s:'s11',c:'c8',h:1},{s:'s11',c:'c9',h:1}]},
  {id:'t17',name:'서상은', hr:false, hc:null, al:null,
   as:[{s:'s12',c:'c1',h:1},{s:'s12',c:'c2',h:1},{s:'s12',c:'c3',h:1},{s:'s12',c:'c4',h:1},{s:'s12',c:'c5',h:1},{s:'s12',c:'c6',h:1},{s:'s12',c:'c7',h:2},{s:'s12',c:'c8',h:2},{s:'s12',c:'c9',h:2}]},
  {id:'t18',name:'변주안', hr:false, hc:null, al:null,
   slotConstraints:{ maxPeriodPerDay:{ 화:5, 목:5 } },
   as:[{s:'s13',c:'c1',h:2},{s:'s13',c:'c2',h:2},{s:'s13',c:'c3',h:2},{s:'s13',c:'c4',h:2},{s:'s13',c:'c5',h:2},{s:'s13',c:'c6',h:2}]},
  {id:'t19',name:'이은경', hr:false, hc:null, al:null,
   as:[{s:'s14',c:'c4',h:1},{s:'s14',c:'c5',h:1},{s:'s14',c:'c6',h:1},{s:'s23',c:'c1',h:1},{s:'s23',c:'c2',h:1},{s:'s23',c:'c3',h:1}]},
  {id:'t20',name:'정은화', hr:false, hc:null, al:null,
   as:[{s:'s15',c:'c2',h:2},{s:'s15',c:'c3',h:2},{s:'s15',c:'c4',h:2},{s:'s15',c:'c5',h:2},{s:'s15',c:'c6',h:2},{s:'s24',c:'c2',h:1},{s:'s24',c:'c3',h:1},{s:'s24',c:'c4',h:1},{s:'s24',c:'c5',h:1},{s:'s24',c:'c6',h:1}]},
  {id:'t21',name:'고민희', hr:false, hc:null, al:null,
   as:[{s:'s15',c:'c1',h:2},{s:'s15',c:'c7',h:3},{s:'s15',c:'c8',h:3},{s:'s15',c:'c9',h:3},{s:'s24',c:'c1',h:1},{s:'s24',c:'c7',h:1},{s:'s24',c:'c8',h:1},{s:'s24',c:'c9',h:1}]},
  {id:'t22',name:'정지현', hr:false, hc:null, al:null,
   slotConstraints:{ morningOnly:true },
   as:[{s:'s16',c:'c7',h:1},{s:'s16',c:'c8',h:1},{s:'s16',c:'c9',h:1}]},
];

export const gS = id => SBJ.find(s=>s.id===id);
export const gC = id => CLS.find(c=>c.id===id);
export const gT = id => TCH.find(t=>t.id===id);
export const getHR = cid => TCH.find(t=>t.hr&&t.hc===cid)||null;
