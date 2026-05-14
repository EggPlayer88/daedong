// ══════════════════════════════════════
//  대동여중 학교 데이터
// ══════════════════════════════════════

export const DAYS = ['월','화','수','목','금'];
export const DP = { 월:6, 화:7, 수:6, 목:7, 금:6 };
export const DAILY = [6,7,6,6,6]; // 창체 제외 정규 수업 정원
export const SP = [{ name:'창체', day:'목', p:7 }];
export const D2N = { 0:'월', 1:'화', 2:'수', 3:'목', 4:'금' };
export const TIMES = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00'];

export const enc = (d,p) => d*10+p;
export const decS = s => ({ d:(s/10)|0, p:s%10 });
export const isV = (d,p) => p<=(DP[d]||0);
export const getSP = (d,p) => SP.find(s=>s.day===d&&s.p===p)||null;

export const CLR = [
  {bg:'#B5D4F4',tx:'#042C53'},{bg:'#CECBF6',tx:'#26215C'},{bg:'#9FE1CB',tx:'#04342C'},
  {bg:'#FAC775',tx:'#412402'},{bg:'#F4C0D1',tx:'#4B1528'},{bg:'#C0DD97',tx:'#173404'},
  {bg:'#F0997B',tx:'#4A1B0C'},{bg:'#D3D1C7',tx:'#2C2C2A'},{bg:'#E1F5EE',tx:'#085041'},
  {bg:'#FFF3CD',tx:'#856404'},{bg:'#EEEDFE',tx:'#3C3489'},
];

export const SBJ = [
  {id:'s1', name:'국어',    ci:1, gh:{1:4,2:4,3:4}},
  {id:'s2', name:'사회',    ci:3, gh:{1:3,2:0,3:2}},
  {id:'s3', name:'역사',    ci:3, gh:{1:0,2:3,3:2}},
  {id:'s4', name:'도덕',    ci:7, gh:{1:3,2:0,3:2}},
  {id:'s5', name:'수학',    ci:0, gh:{1:5,2:4,3:4}},
  {id:'s6', name:'정보',    ci:8, gh:{1:0,2:1,3:0}},
  {id:'s7', name:'기술가정',ci:6, gh:{1:0,2:3,3:3}},
  {id:'s8', name:'과학',    ci:5, gh:{1:3,2:3,3:4}},
  {id:'s9', name:'체육',    ci:10,gh:{1:3,2:3,3:3}},
  {id:'s10',name:'스포츠',  ci:9, gh:{1:1,2:1,3:1}},
  {id:'s11',name:'음악',    ci:2, gh:{1:1,2:1,3:2}},
  {id:'s12',name:'미술',    ci:4, gh:{1:2,2:2,3:0}},
  {id:'s13',name:'진로',    ci:6, gh:{1:1,2:1,3:0}},
  {id:'s14',name:'영어',    ci:2, gh:{1:3,2:3,3:4}},
  {id:'s15',name:'보건',    ci:7, gh:{1:0,2:1,3:0}},
  {id:'s16',name:'한문',    ci:9, gh:{1:2,2:1,3:0}},
];

export const CLS = [
  {id:'c1',name:'1-1반',g:1},{id:'c2',name:'1-2반',g:1},{id:'c3',name:'1-3반',g:1},
  {id:'c4',name:'2-1반',g:2},{id:'c5',name:'2-2반',g:2},{id:'c6',name:'2-3반',g:2},
  {id:'c7',name:'3-1반',g:3},{id:'c8',name:'3-2반',g:3},{id:'c9',name:'3-3반',g:3},
];

// 학교 부서 목록 — Phase 5+ 에서 DB 화 예정 (SBJ/TCH/CLS 와 함께)
export const DEPT = ['교무부','연구부','학생안전부','학생생활부','진로부','정보부'];

export const TCH = [
  {id:'t1', name:'국어T1',   hr:true, hc:'c1', al:null,
   as:[{s:'s1',c:'c3',h:3},{s:'s1',c:'c7',h:4},{s:'s1',c:'c8',h:4},{s:'s1',c:'c9',h:4}]},
  {id:'t2', name:'국어T2',   hr:true, hc:'c7', al:null,
   as:[{s:'s1',c:'c1',h:3},{s:'s1',c:'c2',h:3},{s:'s1',c:'c4',h:3},{s:'s1',c:'c5',h:3},{s:'s1',c:'c6',h:4}]},
  {id:'t3', name:'국어T3',   hr:false,hc:null, al:[1],
   as:[{s:'s1',c:'c1',h:1},{s:'s1',c:'c2',h:1},{s:'s1',c:'c3',h:1},{s:'s1',c:'c4',h:1},{s:'s1',c:'c5',h:1}]},
  {id:'t4', name:'사회',     hr:true, hc:'c5', al:null,
   as:[{s:'s2',c:'c1',h:3},{s:'s2',c:'c2',h:3},{s:'s2',c:'c3',h:3},{s:'s2',c:'c7',h:2},{s:'s2',c:'c8',h:2},{s:'s2',c:'c9',h:2}]},
  {id:'t5', name:'역사',     hr:true, hc:'c6', al:null,
   as:[{s:'s3',c:'c4',h:3},{s:'s3',c:'c5',h:3},{s:'s3',c:'c6',h:3},{s:'s3',c:'c7',h:2},{s:'s3',c:'c8',h:2},{s:'s3',c:'c9',h:2}]},
  {id:'t6', name:'도덕',     hr:true, hc:'c3', al:null,
   as:[{s:'s4',c:'c1',h:3},{s:'s4',c:'c2',h:3},{s:'s4',c:'c3',h:3},{s:'s4',c:'c7',h:2},{s:'s4',c:'c8',h:2},{s:'s4',c:'c9',h:2}]},
  {id:'t7', name:'수학T1',   hr:true, hc:'c2', al:null,
   as:[{s:'s5',c:'c1',h:5},{s:'s5',c:'c2',h:5},{s:'s5',c:'c3',h:5}]},
  {id:'t8', name:'수학T2',   hr:true, hc:'c4', al:null,
   as:[{s:'s5',c:'c4',h:4},{s:'s5',c:'c5',h:4},{s:'s5',c:'c6',h:4}]},
  {id:'t9', name:'수학T3',   hr:true, hc:'c9', al:null,
   as:[{s:'s5',c:'c7',h:4},{s:'s5',c:'c8',h:4},{s:'s5',c:'c9',h:4}]},
  {id:'t10',name:'기술가정', hr:true, hc:'c8', al:null,
   as:[{s:'s7',c:'c4',h:3},{s:'s7',c:'c5',h:3},{s:'s7',c:'c6',h:3},{s:'s7',c:'c7',h:3},{s:'s7',c:'c8',h:3},{s:'s7',c:'c9',h:3}]},
  {id:'ti', name:'정보',     hr:false,hc:null, al:[3],
   as:[{s:'s6',c:'c4',h:1},{s:'s6',c:'c5',h:1},{s:'s6',c:'c6',h:1}]},
  {id:'t11',name:'과학T1',   hr:false,hc:null, al:null,
   as:[{s:'s8',c:'c7',h:4},{s:'s8',c:'c8',h:4},{s:'s8',c:'c9',h:4}]},
  {id:'t12',name:'과학T2',   hr:false,hc:null, al:null,
   as:[{s:'s8',c:'c1',h:2},{s:'s8',c:'c2',h:2},{s:'s8',c:'c3',h:2},{s:'s8',c:'c4',h:3},{s:'s8',c:'c5',h:3},{s:'s8',c:'c6',h:3}]},
  {id:'ts3',name:'과학T3',   hr:false,hc:null, al:null,
   as:[{s:'s8',c:'c1',h:1},{s:'s8',c:'c2',h:1},{s:'s8',c:'c3',h:1}]},
  {id:'t13',name:'체육T1',   hr:false,hc:null, al:null,
   as:[{s:'s9',c:'c1',h:1},{s:'s9',c:'c2',h:1},{s:'s9',c:'c3',h:1},{s:'s9',c:'c4',h:1},{s:'s9',c:'c7',h:3},{s:'s9',c:'c8',h:3},{s:'s9',c:'c9',h:3}]},
  {id:'t14',name:'체육T2',   hr:false,hc:null, al:null,
   as:[{s:'s9',c:'c1',h:2},{s:'s9',c:'c2',h:2},{s:'s9',c:'c3',h:2},{s:'s9',c:'c4',h:2},{s:'s9',c:'c5',h:3},{s:'s9',c:'c6',h:3}]},
  {id:'t15',name:'스포츠강사',hr:false,hc:null,al:null,isExt:true,
   as:[{s:'s10',c:'c1',h:1},{s:'s10',c:'c2',h:1},{s:'s10',c:'c3',h:1},{s:'s10',c:'c4',h:1},{s:'s10',c:'c5',h:1},{s:'s10',c:'c6',h:1},{s:'s10',c:'c7',h:1},{s:'s10',c:'c8',h:1},{s:'s10',c:'c9',h:1}]},
  {id:'t16',name:'음악',     hr:false,hc:null, al:null,
   as:[{s:'s11',c:'c1',h:1},{s:'s11',c:'c2',h:1},{s:'s11',c:'c3',h:1},{s:'s11',c:'c4',h:1},{s:'s11',c:'c5',h:1},{s:'s11',c:'c6',h:1},{s:'s11',c:'c7',h:2},{s:'s11',c:'c8',h:2},{s:'s11',c:'c9',h:2}]},
  {id:'t17',name:'미술',     hr:false,hc:null, al:null,
   as:[{s:'s12',c:'c1',h:2},{s:'s12',c:'c2',h:2},{s:'s12',c:'c3',h:2},{s:'s12',c:'c4',h:2},{s:'s12',c:'c5',h:2},{s:'s12',c:'c6',h:2}]},
  {id:'t18',name:'진로',     hr:false,hc:null, al:null,
   as:[{s:'s13',c:'c1',h:1},{s:'s13',c:'c2',h:1},{s:'s13',c:'c3',h:1},{s:'s13',c:'c4',h:1},{s:'s13',c:'c5',h:1},{s:'s13',c:'c6',h:1}]},
  {id:'t19',name:'영어T1',   hr:false,hc:null, al:null,
   as:[{s:'s14',c:'c2',h:3},{s:'s14',c:'c3',h:3},{s:'s14',c:'c4',h:3},{s:'s14',c:'c5',h:3},{s:'s14',c:'c6',h:3}]},
  {id:'t20',name:'영어T2',   hr:false,hc:null, al:null,
   as:[{s:'s14',c:'c1',h:3},{s:'s14',c:'c7',h:4},{s:'s14',c:'c8',h:4},{s:'s14',c:'c9',h:4}]},
  {id:'t21',name:'보건',     hr:false,hc:null, al:null,
   as:[{s:'s15',c:'c4',h:1},{s:'s15',c:'c5',h:1},{s:'s15',c:'c6',h:1}]},
  {id:'t22',name:'한문',     hr:false,hc:null, al:[0,2],
   as:[{s:'s16',c:'c1',h:2},{s:'s16',c:'c2',h:2},{s:'s16',c:'c3',h:2},{s:'s16',c:'c4',h:1},{s:'s16',c:'c5',h:1},{s:'s16',c:'c6',h:1}]},
];

export const gS = id => SBJ.find(s=>s.id===id);
export const gC = id => CLS.find(c=>c.id===id);
export const gT = id => TCH.find(t=>t.id===id);
export const getHR = cid => TCH.find(t=>t.hr&&t.hc===cid)||null;
