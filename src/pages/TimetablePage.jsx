// ⚠️ DEPRECATED — 정리 작업 2-C 에서 폐지됨 (2026-05-21).
// ═══════════════════════════════════════════════════════════════════
//  이 파일은 git history 보존 + 향후 참조용으로만 남깁니다.
//  실제로 import 되거나 라우팅되는 곳이 없으니 안전하게 무시해도 됩니다.
//
//  이전에 이 파일에 있던 기능들의 현재 위치:
//   - 솔버 (CP-SAT 시간표 생성)
//       → src/components/timetable/SolverModal.jsx 의 Step 2
//   - 초기설정 (과목·학급·교사 조회)
//       → src/components/timetable/InitSettingsView.jsx (read-only 미리보기)
//         · SolverModal Step 1 에서 임베드
//   - 통계 (교사별·학급별 시수 검증)
//       → SolverModal Step 2 의 접이식 "📊 상세 통계" 섹션 (저장 직전 검증용)
//   - 시간표 보기 / 교체 요청 / 교체 관리 (데모용 로컬 state 였음)
//       → 정식 구현은 TimetableViewer 에 모두 있음. 데모용 탭은 폐지.
//
//  진입 경로:
//   - 새 드래프트 생성 → 사이드바 "🗂️ 시간표 관리" → "+ 새 드래프트 만들기" 버튼
//   - 활성 시간표 조회 / 변동 요청 → 사이드바 "📅 시간표"
//
//  App.jsx 의 라우팅에서 case "timetable" 제거됨 — 직접 URL 접근 시 대시보드로 fallback.
//
//  완전 삭제 시점: Phase 5 (임시교사) 또는 Phase 7 (영구 변경) 정리 시.
// ═══════════════════════════════════════════════════════════════════

export default function TimetablePage() {
  return null;
}
