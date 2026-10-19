// 원본 P8 대조는 실패 snapshot을 생략한다. 그 원문을 바꾸지 않고 실제 UI 순서를 별도로 검증한다.
import { readFileSync } from 'node:fs'
import { createTeachingRelationsAdapter } from 'releaseapp/teaching/relations-adapter'
import { contextResponse } from 'releaseapp/connection/validation'

let passed = 0, failed = 0
const check = (name: string, condition: boolean) => {
  condition ? passed++ : failed++
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`)
}
const errorCode = async (operation: () => Promise<unknown>) => {
  try { await operation(); return 'SUCCESS' } catch (error) { return (error as { code?: string })?.code ?? 'UNKNOWN' }
}
const files = (process.env.P8_CAPTURE ?? '').split(',').filter(Boolean)
check('보강 있음·없음 두 캡처 파일을 모두 받음', files.length === 2)
for (let index = 0; index < files.length; index++) {
  const document = JSON.parse(readFileSync(files[index], 'utf8'))
  check(`캡처 ${index + 1}: 보강 있음·없음 순서가 실제 bridge 값과 일치`, document.bridge === (index === 0))
  const cases = document.captures.filter((capture: any) => capture.kind === 'rel_preview' && capture.raw?.ok === false && capture.raw.code === 'UNAVAILABLE')
  check(`캡처 ${index + 1}: 실제 관계 미지원 응답 2건이 있음`, cases.length === 2)
  for (let item = 0; item < cases.length; item++) {
    const capture = cases[item]
    check(`캡처 ${index + 1}-${item + 1}: 원래 실패 snapshot도 UNAVAILABLE로 보존됨`, capture.snapshotRaw?.ok === false && capture.snapshotRaw.code === 'UNAVAILABLE')
    const context = contextResponse(capture.context, capture.scope.schoolId)
    const sent: { name: string; args: any }[] = []
    const connection = {
      info: () => structuredClone(context),
      getIdentity: async () => ({ userId: capture.scope.userId, approved: true, profile: { id: capture.scope.userId, is_active: true, role: 'superadmin', department_id: null, extra_permissions: [] } }),
      rpcVerified: async (name: string, args: any) => {
        sent.push({ name, args })
        if (name === 'workhub_teaching_relations') return structuredClone(capture.snapshotRaw)
        if (name === 'workhub_teaching_relation_preview') return structuredClone(capture.raw)
        throw new Error('이 시험이 허용하지 않은 호출')
      },
    } as any
    const app = createTeachingRelationsAdapter(connection)
    check(`캡처 ${index + 1}-${item + 1}: 조회 전 preview는 서버 호출 없이 QUERY_FAILED`,
      await errorCode(() => app.preview(capture.scope.memberId, capture.intent)) === 'QUERY_FAILED' && sent.length === 0)
    check(`캡처 ${index + 1}-${item + 1}: 실제 snapshot 응답을 같은 학교·수업으로 받고 UNAVAILABLE`,
      await errorCode(() => app.snapshot(capture.scope.memberId, capture.intent.courseId)) === 'UNAVAILABLE' && sent.length === 1 && sent[0].name === 'workhub_teaching_relations' && sent[0].args.p_member_id === capture.scope.memberId && sent[0].args.p_course_id === capture.intent.courseId)
    check(`캡처 ${index + 1}-${item + 1}: 실패 조회 뒤 preview도 UNAVAILABLE이며 추가 RPC 없음`,
      await errorCode(() => app.preview(capture.scope.memberId, capture.intent)) === 'UNAVAILABLE' && sent.length === 1)
  }
}
console.log(`합계: PASS ${passed} · FAIL ${failed}`)
process.exitCode = failed ? 1 : 0
