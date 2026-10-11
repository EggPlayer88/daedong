// @daedong/timetable 공개 API. 최적화는 별도 Python 엔진, 화면은 검증된 JSON 후보를 받는다.
// P8: shared 만 import 가능. main 을 절대 참조하지 않는다.
export { toClassTimetable, compareCandidates } from './candidates.js';
