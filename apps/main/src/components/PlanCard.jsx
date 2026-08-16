// PLAN_READY 로 확정된 내용을 교사가 눈으로 검토하는 카드 (manifest v2 구조).
//
// ⚠ 항목 목록을 하드코딩하지 않는다 — manifest 를 훑어 렌더한다.
//   양식이 바뀌면 manifest 만 갈아끼우면 이 화면도 따라간다.
// ⚠ 노드의 key 는 property 이름과 다를 수 있다 (perf_summary → key: "perf_areas").

import constants from '../../api/doc-ai/_assets/school-constants-2026-2.json'

const keyOf = (node, fallback) => node?.key || fallback

function Val({ v }) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
    return <span className="blank">(공란)</span>
  }
  if (Array.isArray(v)) return <>{v.join(', ')}</>
  return <>{String(v)}</>
}

function Section({ title, children }) {
  return (
    <section className="plan-sec">
      <h4>{title}</h4>
      {children}
    </section>
  )
}

export default function PlanCard({ manifest: m, plan, busy, onGenerate, onEdit }) {
  const mp = m.monthly_plan
  const ex = m.exam
  const ps = m.perf_summary
  const pp = m.perf_plans
  const al = m.achievement_levels
  const ep = m.eval_purpose

  const monthlyKey = keyOf(mp, 'monthly_plan')
  const examKey = keyOf(ex, 'exam')
  const perfKey = keyOf(ps, 'perf_areas')
  const plansKey = keyOf(pp, 'perf_plans')
  const levelsKey = keyOf(al, 'achievement_levels')
  const purposeKey = keyOf(ep, 'eval_purpose')
  const essayKey = keyOf(m.essay_total_ratio, 'essay_total_ratio')
  const minKey = keyOf(m.min_achievement_plan, 'min_achievement_plan')

  const rows = Array.isArray(plan[monthlyKey]) ? plan[monthlyKey] : []
  const exam = plan[examKey] || {}
  const rounds = Array.isArray(exam.rounds) ? exam.rounds : []
  const areas = Array.isArray(plan[perfKey]) ? plan[perfKey] : []
  const plans = Array.isArray(plan[plansKey]) ? plan[plansKey] : []
  const levels = plan[levelsKey] || {}
  const purposes = Array.isArray(plan[purposeKey]) ? plan[purposeKey] : []

  // 서·논술형 30% 규칙 — 기준값은 학교 상수에서 읽는다
  const minEssay = constants?.essay_ratio_rule?.min_percent
  const essayVal = Number(plan[essayKey])
  const essayLow =
    minEssay !== undefined && Number.isFinite(essayVal) && essayVal < minEssay

  return (
    <div className="card plan">
      <h3>이 내용으로 초안을 만듭니다</h3>
      <p className="muted small">
        결재 전 반드시 검토가 필요한 <b>초안</b>입니다. 공란은 양식에 빈칸으로 들어갑니다.
      </p>

      <Section title="기본 정보">
        <table className="table kv-table">
          <tbody>
            {m.basic_fields.map((f) => (
              <tr key={f.key}>
                <th>{f.label}</th>
                <td>
                  <Val v={plan[f.key]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {mp && (
        <Section title={`교수·학습 계획 (${mp.months.length}개월)`}>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>월</th>
                  {mp.row_fields.map((rf) => (
                    <th key={rf.key}>{rf.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.month || mp.months[i]}</td>
                    {mp.row_fields.map((rf) => (
                      <td key={rf.key}>
                        <Val v={row[rf.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {ep && (
        <Section title={ep.label}>
          <ol className="plain-list">
            {Array.from({ length: ep.count }, (_, i) => (
              <li key={i}>
                <Val v={purposes[i]} />
              </li>
            ))}
          </ol>
        </Section>
      )}

      {ex && (
        <Section title="정기시험">
          <table className="table kv-table">
            <tbody>
              {ex.fields.map((f) => (
                <tr key={f.key}>
                  <th>{f.label}</th>
                  <td>
                    <Val v={exam[f.key]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rounds.length > 0 && (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    {ex.rounds.item_fields.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((r, i) => (
                    <tr key={i}>
                      {ex.rounds.item_fields.map((f) => (
                        <td key={f.key}>
                          <Val v={r[f.key]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {ps && (
        <Section title={`수행평가 (${areas.length}개 / 최대 ${ps.max})`}>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  {ps.item_fields.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {areas.map((a, i) => (
                  <tr key={i}>
                    {ps.item_fields.map((f) => (
                      <td key={f.key}>
                        <Val v={a[f.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {m.essay_total_ratio && (
        <Section title={m.essay_total_ratio.label}>
          <p>
            <Val v={plan[essayKey]} />
            {essayLow && (
              <span className="warn">
                {' '}
                ⚠ {minEssay}% 미만입니다. 예외 교과가 아니라면 조정이 필요합니다.
              </span>
            )}
          </p>
        </Section>
      )}

      {al && (
        <Section title={al.label}>
          <table className="table kv-table">
            <tbody>
              {al.levels.map((lv) => (
                <tr key={lv}>
                  <th>{lv}</th>
                  <td>
                    <Val v={levels[lv]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {pp && plans.length > 0 && (
        <Section title={`수행평가 출제 계획 (${plans.length}개 / 최대 ${pp.max})`}>
          {plans.map((p, i) => (
            <div className="subblock" key={i}>
              <h5>
                {i + 1}. <Val v={p.name} />
              </h5>
              <table className="table kv-table">
                <tbody>
                  {pp.item_fields
                    .filter((f) => f.key !== 'name' && f.type !== 'table_rows')
                    .map((f) => (
                      <tr key={f.key}>
                        <th>{f.label}</th>
                        <td>
                          <Val v={p[f.key]} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>

              {pp.item_fields
                .filter((f) => f.type === 'table_rows')
                .map((f) => {
                  const list = Array.isArray(p[f.key]) ? p[f.key] : []
                  return (
                    <div key={f.key}>
                      <div className="sub-label">{f.label}</div>
                      {list.length === 0 ? (
                        <p className="blank">(공란)</p>
                      ) : (
                        <div className="scroll-x">
                          <table className="table">
                            <thead>
                              <tr>
                                {f.row_fields.map((rf) => (
                                  <th key={rf}>{rf}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {list.map((row, j) => (
                                <tr key={j}>
                                  {f.row_fields.map((rf) => (
                                    <td key={rf}>
                                      <Val v={row[rf]} />
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          ))}
        </Section>
      )}

      {m.min_achievement_plan && (
        <Section title={m.min_achievement_plan.label}>
          <p>
            <Val v={plan[minKey]} />
          </p>
        </Section>
      )}

      <div className="row">
        <button className="btn-google" onClick={onGenerate} disabled={busy}>
          한글파일 생성
        </button>
        <button className="btn-plain" onClick={onEdit} disabled={busy}>
          대화로 계속 수정
        </button>
      </div>
    </div>
  )
}
