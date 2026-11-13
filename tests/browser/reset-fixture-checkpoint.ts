// 각 합성 시나리오는 독립한 학교/서버 초기값으로 시작한다. 이전 시나리오의 탭 초안은 재사용하지 않는다.
// 실제 새로고침 복구 시험은 별도 fixture에서 이 초기화를 사용하지 않는다.
import { clearTabCheckpoints } from '../../apps/workhub/src/app/tab-checkpoint'
clearTabCheckpoints()
