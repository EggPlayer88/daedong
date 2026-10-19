/** 일괄 입력과 AI 제안은 같은 수업·시간의 기존 선호를 낮추지 않는다. */
export const strongerPreferenceWeight = (current: number | undefined, proposed: number) => Math.max(current ?? 0, proposed)

const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('ko')
/** 동명이면 안정된 식별자를 함께 보여 주며 이름으로 다른 대상을 합치지 않는다. */
export function conditionTargetLabels(resources: readonly { id: string; label: string }[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const resource of resources) { const key = normalized(resource.label); counts.set(key, (counts.get(key) ?? 0) + 1) }
  return new Map(resources.map(resource => [resource.id, (counts.get(normalized(resource.label)) ?? 0) > 1 ? `${resource.label} [${resource.id}]` : resource.label]))
}
