// ══════════════════════════════════════
//  시간표 엑셀(.xlsx) 내보내기 — SheetJS 기반
//  data 형식: { c1: { '월-1': {sid,tid} | {type:'special',name,tid}, ... }, ... }
//    · 일반 수업  → '국어(심원영)'   (과목명(교사명))
//    · 주제선택   → '국어(주)(이연숙)' (name 에 (주) 포함)
//    · 영원       → '영원(정은화)'
//    · 스포츠     → '스포츠(김혜진)'  (일반 규칙과 동일)
//    · 창체       → '창체'           (교사명 없음, type:'special')
//    · 빈 슬롯    → ''               (완전 공백)
//  시트 33개: 학급별 종합 → 교사별 종합 → 반 9개(c1~c9) → 교사 22개(t1~t22)
// ══════════════════════════════════════
import * as XLSX from 'xlsx';
import { CLS, TCH, DAYS, DP, gS, gT } from './timetableData.js';

// 시간표 그리드 헤더 (빈칸 + 요일)
const HEADER = ['', ...DAYS];
const MAX_PERIOD = 7;   // 최대 교시 (목·화 = 7교시)

// 학급 관점 셀 텍스트 — data[cid][slot] 엔트리를 사람이 읽는 문자열로
export function classCellText(entry) {
  if (!entry) return '';
  if (entry.type) return entry.name || '창체';   // 특별활동(창체 등): 교사명 없음
  const subj = gS(entry.sid);
  const tch = gT(entry.tid);
  const sname = subj?.name ?? entry.sid;
  const tname = tch?.name;
  return tname ? `${sname}(${tname})` : sname;
}

// 반 이름에서 접미사 '반' 제거 — 교사 시트 셀을 '1-1 국어' 형태로 (예시 형식 준수)
const shortClass = (name) => name.replace(/반$/, '');

// 학급 그리드 [7행 x 5열] — 각 셀은 classCellText
export function buildClassGrid(cid, data) {
  const grid = [];
  for (let p = 1; p <= MAX_PERIOD; p++) {
    const row = [`${p}교시`];
    for (const day of DAYS) {
      if (p > DP[day]) { row.push(''); continue; }   // 존재하지 않는 교시 → 공백
      row.push(classCellText(data?.[cid]?.[`${day}-${p}`]));
    }
    grid.push(row);
  }
  return grid;
}

// 교사 그리드 [7행 x 5열] — 그 교사가 그 슬롯에 배정된 '반명 과목명' (없으면 공백)
export function buildTeacherGrid(tid, data) {
  const grid = [];
  for (let p = 1; p <= MAX_PERIOD; p++) {
    const row = [`${p}교시`];
    for (const day of DAYS) {
      if (p > DP[day]) { row.push(''); continue; }
      const key = `${day}-${p}`;
      let text = '';
      for (const c of CLS) {
        const e = data?.[c.id]?.[key];
        if (e && !e.type && e.tid === tid) {
          const subj = gS(e.sid);
          text = `${shortClass(c.name)} ${subj?.name ?? e.sid}`;
          break;   // 한 교사는 한 슬롯에 한 반만 (교사 중복 배정 불가)
        }
      }
      row.push(text);
    }
    grid.push(row);
  }
  return grid;
}

// AOA(2차원 배열)를 시트로 만들고 열 너비를 지정해 워크북에 추가
function appendAoaSheet(wb, sheetName, aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 첫 열(교시/제목) 좁게, 요일 5열 넓게
  ws['!cols'] = [{ wch: 10 }, ...DAYS.map(() => ({ wch: 18 }))];
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

// 순수 워크북 생성 (브라우저 의존 없음 — node 테스트 가능)
export function buildWorkbook(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('시간표 데이터가 비어있습니다');
  }
  const wb = XLSX.utils.book_new();

  // 1) 학급별 종합 — 9개 반 세로 나열 (제목 + 헤더 + 그리드 + 빈 줄)
  const classAll = [];
  CLS.forEach(c => {
    classAll.push([`[${c.name}]`]);
    classAll.push(HEADER);
    buildClassGrid(c.id, data).forEach(r => classAll.push(r));
    classAll.push([]);
  });
  appendAoaSheet(wb, '학급별 종합', classAll);

  // 2) 교사별 종합 — 22명 교사 세로 나열
  const teacherAll = [];
  TCH.forEach(t => {
    teacherAll.push([`[${t.name}]`]);
    teacherAll.push(HEADER);
    buildTeacherGrid(t.id, data).forEach(r => teacherAll.push(r));
    teacherAll.push([]);
  });
  appendAoaSheet(wb, '교사별 종합', teacherAll);

  // 3) 반별 개별 시트 9개 (c1~c9)
  CLS.forEach(c => {
    appendAoaSheet(wb, c.name, [HEADER, ...buildClassGrid(c.id, data)]);
  });

  // 4) 교사별 개별 시트 22개 (t1~t22 순)
  TCH.forEach(t => {
    appendAoaSheet(wb, t.name, [HEADER, ...buildTeacherGrid(t.id, data)]);
  });

  return wb;
}

// 오늘 날짜 기반 기본 파일명: 대동여중_시간표_YYYY-MM-DD.xlsx
export function defaultExportFilename(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `대동여중_시간표_${yyyy}-${mm}-${dd}.xlsx`;
}

// 브라우저 다운로드 트리거 (Blob + createObjectURL — 로컬 저장 API 미사용)
export function exportTimetableToExcel(data, filename = defaultExportFilename()) {
  const wb = buildWorkbook(data);
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
