# 시간표 최적화 엔진

정확성과 입력된 하드조건을 모두 충족한 완전한 시간표만 반환한다. 품질은 정수 페널티를 최소화하며, 서로 다른 우수안 최대 3개와 항목별 약점을 제공한다. 운영 DB·인증·메뉴·라우트에는 연결하지 않은 로컬 알고리즘 패키지다. 담당자가 후보를 채택하는 화면을 붙일 때 JSON 결과와 `src/index.js`의 변환 API를 사용한다.

## 실행

Python 3.12 이상, `requirements.txt`의 고정된 OR-Tools 버전을 사용한다.

```powershell
python -m venv packages/timetable/.venv
packages/timetable/.venv/Scripts/python.exe -m pip install -r packages/timetable/requirements.txt
packages/timetable/.venv/Scripts/python.exe packages/timetable/solve.py --input packages/timetable/_assets/school-2026-2.json --output result.json --progress
```

Linux에서는 같은 가상환경의 실행 파일이 `.venv/bin/python`이다. `--input`을 생략하면 표준입력 JSON, `--options`는 옵션 JSON 파일, `--output`을 생략하면 표준출력 JSON이다. 진행 이벤트는 표준에러로 나간다. 성공 종료코드는 0, 불가능·미발견·입력 오류는 2, 엔진 내부 오류는 1이다.

## 알고리즘과 정확성

- 각 수업의 주간 시수를 단일 활동과 필수 블록으로 나눈다. 블록은 같은 날의 연속 교시를 점유하는 하나의 원자적 활동이다.
- 후보 시작 위치는 학급·과목·모든 참여 교사·공유 자원의 가용시간, 고정·잠금, 예약, 전용 시간대, 블록 휴식 경계를 함께 검사해 만든다.
- CP-SAT 제약식은 학급 교시를 정확히 한 번 채우고, 모든 활동을 정확히 한 번 배정하며, 교사 중복과 자원 용량 초과를 금지한다. 하드조건을 목적함수의 큰 벌점으로 처리하거나 탐색 중 완화하지 않는다.
- 동일 수업의 카드 번호만 바꾸는 대칭을 제거한다. 수업 카드 ID가 아니라 **학급·교시의 과목과 참여 교사**로 변경량과 후보 차이를 계산한다.
- 결과를 `inspect_schedule`로 다시 검사한다. 후보 도메인이나 솔버 변수 대신 원래 조건으로 시수·교시·블록·전체 점유·입력된 하드조건을 재집계한다. 하나라도 위반하면 후보 반환이 아니라 내부 오류로 종료한다.
- 품질 점수도 Python에서 별도로 재계산하여 CP-SAT 목적값과 일치해야 반환한다.
- 탐색 중 찾은 서로 다른 우수 배치도 최대 50개 보존하고 독립 검증한다. 최종 최고안을 고정한 뒤 대안 쌍을 전수 비교해, 품질·배치 차이 조건을 유지하면서 가능한 후보 수를 최대화하고 대안의 합산 패널티를 최소화한다.

`feasible`은 모든 하드조건을 만족하는 후보가 있다는 뜻이다. `infeasible`은 빈 도메인 등의 직접적인 모순 또는 CP-SAT의 불가능 증명이 있는 경우다. 제한 시간에 해를 못 찾았으면 `unknown`이다. 알 수 없는 필드·하드조건, 깨진 입력, 중복 참조, 시수 불일치·부족한 블록은 `invalid_input`으로 거부한다.

## 입력 계약 v1

최상위 필드: `version:1`, `morningEnd`, `days`, `classes`, `teachers`, `subjects`, `lessons`, 선택적으로 `resources`, `reservations`, `fixed`, `subjectWindows`, `hardConstraints`, `metadata`.

| 항목 | 필드·의미 |
|---|---|
| days | `{id, periods, breaksAfter?}`. 배열 순서가 주간 요일 순서. 휴식 경계는 `breaksAfter:[4]`처럼 지정 |
| classes | `{id, name?, grade?, availability?}` |
| teachers / subjects | `{id, name?, availability?}` |
| resources | `{id, name?, capacity, availability?}`. 교실·체육관·장비 등의 동시간 용량 |
| lessons | `{id, classId, subjectId, teacherIds, hours, blocks?, resourceIds?, allowAcrossBreak?}`. 주 담당 교사는 `teacherIds[0]`, 나머지는 반드시 동행하는 교사 |
| blocks | 필수 블록 길이 목록. 예: 시수 5, `[2,2]`이면 2연속 두 번과 단일 활동 한 번. 시수가 모자라면 오류 |
| reservations | `{classId, day, period, name?, teacherIds?, resourceIds?}`. 일반 수업을 비워 두는 활동. 지정한 교사는 실제 점유·수업 부담에 포함 |
| fixed / locks | `{classId, day, period, subjectId?, teacherIds?, lessonId?}`. 적어도 하나의 정체성 필드 필요. 여러 고정 교시나 블록 중간 교시도 가능 |
| subjectWindows | `{classIds, subjectIds, slots:[{day,period}]}`. 해당 학급의 해당 과목은 이 시간에만, 이 시간은 해당 과목만 배정 |
| metadata | `{source?, notes?:string[]}`. 입력 근거와 미확정 확인 사항 |

`availability`는 `allowedDays`, `blockedSlots:[{day,period}]`, `morningOnly`, `maxPeriod`, `maxPeriodPerDay`를 지원한다. `allowedDays:[]`는 근무 가능한 요일이 없다는 뜻이며 무제한으로 해석하지 않는다. `morningOnly`의 경계는 문제 입력의 `morningEnd`다. 품질 가중치를 바꾸어 하드 허용시간을 바꿀 수 없다.

입력 가능한 추가 하드조건:

| type | 필드·의미 |
|---|---|
| maxDailyLoad | `teacherId, max`: 동행·예약을 포함한 하루 실제 점유 교시 상한 |
| maxConsecutive | `teacherId, max, acrossBreak?`: 연속 점유 상한. `acrossBreak:false`는 지정된 휴식 경계에서 연속을 끊음 |
| subjectDailyLimit | `classId, subjectId, max`: 하루 **시수** 상한. 필수 블록도 포함 |
| sameTime | `lessonIds`: 단일 활동인 수업들의 시작 시간을 일치시킴. 각 활동의 교사는 중복되면 안 됨 |
| differentDays | `lessonIds`: 지정한 수업들의 모든 활동을 서로 다른 날로 배정 |

한 활동이 여러 학급을 함께 가르치는 합반, 격주 수업, 이동·준비 시간은 현재 계약에서 직접 지원하지 않는다. 이런 조건을 지원하는 것으로 추정하거나 일반 수업들로 조용히 변환하지 않는다. 합반은 여러 학급을 점유하는 활동 모델 확장이 필요하다. 회의·외부 원어민·보조교사는 참여 교사 또는 예약 점유로 명시할 수 있다.

## 품질 평가표

기본값은 `_assets/quality-defaults.json`이다. **학교 규정이 아닌 조정 가능한 선호**이며 `options.quality.weights`로 바꿀 수 있다.

| 항목 | 계산 |
|---|---|
| subjectDaily | 같은 학급·과목의 하루 활동 쌍 수. 필수 블록은 한 활동이므로 블록 자체에는 벌점 없음 |
| subjectAdjacency | 같은 과목이 연이은 수업일에 있는 횟수 |
| teacherDailyLoad | 근무 가능한 요일 수와 실제 주간 의무를 고려한 일일 균형 목표의 초과분 제곱 |
| teacherGaps | 첫·마지막 의무 사이의 근무 가능한 빈 교시 수 |
| teacherConsecutive | 선호 연속 교시 수를 초과하는 구간 수. 기본은 휴식 경계에서 분리 |
| morningBalance | 오전·오후 시수 차이에서, 활동별 가능한 오전 시수 집합으로 계산한 불가피한 차이를 제외 |
| lateSpread | 교사의 마지막 교시 배정이 가용시간 비율로 계산한 목표를 초과하는 정도 |
| teacherFairness | 교사별 부담 페널티 중 최댓값. 한 교사에게 부담이 몰리는 것을 억제 |
| blockBreakCrossing | 블록이 점심 등 `breaksAfter` 경계를 넘는 횟수. 허용된 배치의 선호 점수이며 하드 금지는 `allowAcrossBreak:false` |

스포츠 담임 등의 동행은 교과 시수를 늘리지 않지만 교사 점유·부담·공강에는 포함한다. 오전·오후 기준은 입력된 학교 달력 하나를 사용한다. 과목 간격 등 일부 품질 손실은 하드조건상 불가피할 수 있다. 목적함수의 하한과 격차를 함께 보아야 한다.

**‘99점’은 설계 목표이지 임의 점수 환산이나 보장이 아니다.** 총 페널티와 항목별 손실, 교사별 부담, 약점, 최적성 하한을 제공한다. 모든 선호를 만족시키는 시간표가 존재한다는 가정은 하지 않는다. 평가 가중치는 담당자와 실제 시간표를 비교하며 조정해야 한다.

## 탐색 옵션과 후보

```json
{
  "timeLimitSeconds": 180,
  "workers": 8,
  "seed": 1,
  "maxCandidates": 3,
  "minDifferentCells": 12,
  "qualityTolerance": 0.05
}
```

기본 워커 수는 CPU 수에 따라 최대 8개, 시간은 전체 모델 생성·탐색을 포함한 180초다. 첫 탐색에 남은 시간의 60%를 주고 나머지를 추가안에 배분한다. 실행·검증 오버헤드 때문에 실제 벽시계 종료는 예산을 조금 넘을 수 있다. 단일 워커·동일 시드로 재현성을 검사하고, 여러 워커의 실행 결과는 달라질 수 있다.

후속 탐색은 기존 후보와 최소 배치 차이를 강제한다. 최종적으로 가장 좋은 발견안 대비 품질 허용 범위 안에 있는 후보만 점수순으로 제공한다. 대안 탐색에서 더 좋은 안이 발견되면 기준도 갱신한다. 배치 차이나 품질 조건을 몰래 완화하여 3개를 채우지 않는다. 고정·잠금이 많거나 유효 해가 하나뿐이면 1~2개와 이유를 반환할 수 있다.

일반 수업 없이 예약만으로 완전한 문제는 배치 차이가 없으므로 후보 한 개를 반환한다. `minDifferentCells` 기본값도 이 경우에는 0이다.

각 후보의 `optimality`는 실제 목적값과 정수 하한의 차이가 1 미만이며 CP-SAT가 최적 상태일 때만 `provenOptimal:true`다. `scope:original`은 원 문제, `diversity_and_change_constraints`는 앞선 후보와의 차이·변경량 조건까지 포함한 문제다. 대안의 최적성은 전체 문제의 ‘두 번째/세 번째 최적해’라는 뜻이 아니다. 미증명 후보는 유효한 우수안이며 전역 최적이라고 표시하지 않는다.

중간 해의 `solverStatus:INTERMEDIATE_FEASIBLE`은 최적성 미증명으로 표시한다. 최종 솔버 해의 증명이나 다른 탐색 회차의 하한을 임의로 붙이지 않는다.

## 기존 시간표와 부분 재배정

`previous`에는 후보의 `placements` 전체, `locks`에는 보존할 셀을 넣는다. 현재 입력과 동일한 수업 ID·시수·블록 구조의 완전한 이전 시간표를 받는다. 일부 이전 배치만 넣거나 수업 구조가 바뀐 과거 시간표를 넣으면 오류다. 가용시간·공유 자원 등의 변경 때문에 이전 시간표가 새 조건에 맞지 않는 것은 허용하고 다시 배정한다.

- `changeMode:minimize`(기본): 실제 변경 칸 수를 최우선으로 최소화하고, 그 다음 품질을 최소화한다. 품질의 엄밀 상한보다 큰 계수를 사용해 이 우선순위를 보장한다.
- `changeMode:quality`: 잠금은 하드조건으로 유지하고 나머지는 전체 품질을 개선한다.
- 이전 시간표가 새 조건도 만족하면 변경량 0의 최소성은 즉시 확인된다. 제한 시간에 새 후보를 못 찾아도 독립 검증한 이전 해는 보존한다.
- 유효한 기존 해의 품질을 상한으로 사용하고 초기 힌트를 제공한다. 더 긴 탐색을 이어갈 때 `previous`와 `changeMode:quality`를 사용하면 기존 최고안을 보존하면서 개선할 수 있다.
- `changeOptimality`에서 변경 최소성 증명과 품질 최적성 증명을 따로 확인한다.

표시용 JS 변환 함수는 엔진의 검증 결과를 신뢰한다. 향후 채택·저장 시에는 후보를 만든 입력과 현재 입력의 일치 여부를 확인하고 현재 하드조건으로 다시 검증해야 한다.

## 학교 데이터와 확인한 변수

`school-2026-2.json`은 보존된 `v1-final` 원본의 279시수·블록·정보 고정·주제선택·체육관 공유·스포츠 담임 동행을 이식한 입력이다. 교사 표시는 ID이며 이름을 추가해 표시할 수 있다. 스포츠 동행 표는 실제 참여 교사로 반영해 동행 교사의 가능 시간까지 검사한다.

2026-10-11 계란님이 확인한 조건을 추가했다. 영어(원어민)는 담당 영어교사와 공통 원어민교사 한 명을 함께 점유한다. 창체에는 각 반 담임을 예약 교사로 배정한다. 4~5교시 블록은 허용하되 점심 경계 횡단을 품질 패널티로 회피한다. 확인 근거는 `metadata.notes`와 결과의 `modelNotes`에 남긴다. 다른 학교는 `teachers`와 각 수업의 `teacherIds`를 통해 원어민 두 명 이상의 수업 분담을 명시할 수 있다.

담임 ID는 v1 스포츠 동행 표에서 가져왔다. 향후 담당 교사 변경, 합반·격주 수업, 이동·준비 시간 등 실제 조건이 추가되면 입력이나 활동 모델을 갱신해야 한다. 입력된 모델의 하드조건 준수와 학교의 모든 실제 조건이 입력됐는지는 별개다.

## 검증·비교

`tests/test_timetable.py`는 작은 문제 완전열거, 독립 검증 변이, 잘못된 입력, 고정·동반교사·자원·예약·블록·잠금·추가 하드조건, 시간 초과의 해 보존을 실제 솔버로 검사한다. `tests/test_timetable_exhaustive.py`는 고정 시드의 48문제·31,475배정 조합에서 가능 여부, 최저 패널티, 변경 최소량과 최적성 보고를 대조한다. `tests/test_timetable.mjs`는 화면 전달 API를 검사한다. 전체 `npm test`에 포함하며 CI에서도 OR-Tools를 설치한다.

```powershell
packages/timetable/.venv/Scripts/python.exe packages/timetable/benchmark.py --seconds 180 --workers 8 --seeds 1,2,3 --output benchmark.json
```

벤치마크는 Git에 보존된 v1을 메모리에서 실행하고, 두 엔진의 결과를 **새로운 동일 평가표**로 다시 평가한다. 평가표가 바뀌었으므로 옛 페널티와 새 페널티를 직접 비교하지 않는다. 시간 예산·워커·시드·하드 검증·항목별 손실을 결과에 저장한다. 성능 숫자는 특정 기기의 실측이며 CI 합격 조건으로 삼지 않는다.

원어민·창체 확인 **이전** 모델의 2026-10-11 비교 기록은 [benchmark-2026-10-11.json](./benchmark-2026-10-11.json)에 있다. 기록 당시 입력에는 공통 원어민과 창체 담임 점유가 없으며 점심 횡단 선호도 아직 없었다. 현재 확정 모델의 품질 수치와 직접 비교할 수 없다. 기존은 최대 50회 재시도와 4,000회 교환, 새 엔진은 시드별 180초·8워커로 실행했다. 탐색 예산이 다르므로 품질 비교이며 속도 개선의 근거는 아니다.

현재 입력은 위 비교 명령의 기본값이다. 확인 이전 기록을 재현하려면 `--legacy-compatible`를 추가한다. 이 모드는 벤치마크 전용이며 실제 시간표 생성 조건은 완화하지 않는다. 기본 비교에서 기존 엔진이 새 하드조건을 어기면 해당 결과의 품질 비교를 생략하고 위반을 기록한다.

| 시드 | 기존 페널티 | 새 후보 페널티 | 기존 공강 / 새 최고안 공강 |
|---|---:|---|---|
| 1 | 996 | 396, 401 | 116 / 28 |
| 2 | 1162 | 336, 337, 337 | 108 / 26 |
| 3 | 1025 | 333, 339, 347 | 117 / 21 |

최고안 평균 페널티는 약 66.5%, 평균 공강은 약 78.0% 감소했다. 필수 블록을 제외한 동일 과목의 하루 중복 활동 쌍은 최고안 세 개 모두 0이다. 반환 후보 8개 모두 하드조건을 통과했으며, 전역 최적성은 아직 증명되지 않았다.

확정된 원어민·창체·점심 선호를 반영한 기록은 [benchmark-confirmed-2026-10-11.json](./benchmark-confirmed-2026-10-11.json)에 있다. 기존 엔진 3회 중 2회는 공통 원어민 충돌로 무효였고, 나머지 유효 예시의 페널티는 1110·공강은 126이었다. 중간 우수안 수집 후에는 444·451·455 세 안을 찾았다. 그 최고안을 출발점으로 600초 예산의 추가 탐색을 실행해 388·388·389 세 안을 반환했다(실제 약 481초).

추가 탐색의 세 안은 모두 하드조건을 통과했고 공강 33·동일 과목 하루 중복 활동 쌍 0·점심 횡단 블록 0이었다. 서로 25~48칸 다르다. 전역 최적성은 미증명이다. 탐색 시간과 초기 해가 다르므로 이 기록을 같은 예산의 속도 비교나 모든 학교의 개선율로 일반화하지 않는다.

최종 엔진의 별도 180초 초기 생성에서는 533·535·539의 세 안을 찾았다(실제 약 181초). 모두 하드조건을 통과했고 서로 14~33칸 다르다. 같은 학교에서도 제한 시간과 다중 워커의 탐색 경로에 따라 품질은 달라진다. 높은 품질이 필요하면 기존 최고안을 `previous`로 보존하며 `changeMode:quality`로 이어 탐색한다.

판단해서 정한 것: 품질·최적성 검증을 위해 로컬 CP-SAT를 채택했고 운영 런타임에는 추가하지 않았다. 가중치와 후보 허용 범위는 평가 정책으로 분리했다. 되돌리거나 조정하려면 `engine/solver.py`, `_assets/quality-defaults.json`, 입력 JSON을 수정한다. DB 변경·SQL 실행은 필요 없다.

참고: [CP-SAT 상태와 최적성](https://developers.google.com/optimization/cp/cp_solver), [스케줄링 모델 예제](https://developers.google.com/optimization/scheduling/employee_scheduling).
