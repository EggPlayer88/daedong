// 공개 API의 until은 포함하지 않는다. 윤년의 마지막 수업일도 빠짐없이 포함한다.
export function publicationRanges(firstDay, lastDay) {
  const day = 86400000, start = Date.parse(firstDay + 'T00:00:00Z'), end = Date.parse(lastDay + 'T00:00:00Z') + day
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 367 * day) throw new Error('시험 학기 범위가 올바르지 않습니다.')
  const iso = value => new Date(value).toISOString().slice(0, 10), ranges = []
  for (let from = start; from < end; from += 14 * day) ranges.push({from: iso(from), until: iso(Math.min(from + 14 * day, end))})
  return ranges
}
