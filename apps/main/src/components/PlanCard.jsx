// PLAN_READY 로 확정된 내용을 교사가 눈으로 검토하는 카드 (manifest v2 구조).
//
// ⚠ 항목 목록을 하드코딩하지 않는다 — manifest 를 훑어 렌더한다.
//   양식이 바뀌면 manifest 만 갈아끼우면 이 화면도 따라간다.
// ⚠ 노드의 key 는 property 이름과 다를 수 있다 (perf_summary → key: "perf_areas").

import fixedHours from '../../api/doc-ai/_assets/fixed-hours-2026-2.json'

const keyOf = (node, fallback) => node?.key || fallback

/**
 * 서버가 실제로 넣을 시수/누계를 카드에서 미리 보여준다.
 * generate.py 의 apply_fixed_hours 와 같은 판정이어야 한다 (한쪽만 바뀌면 화면이 거짓말을 한다).
 */
function resolveHours(plan) {
  if (plan?.hours_manual === true) {
    return { applied: false, reason: 'manual', months: null, row: null }
  }
  const n = Number(plan?.weekly_hours)
  const row = Number.isInteger(n) && n > 0
    ? fixedHours?.variants?.[fixedHours.default_variant]?.[String(n)]
    : null
  if (!row?.months) return { applied: false, reason: 'out_of_range', months: null, row: null }
  return { applied: true, reason: 'fixed', months: row.months, row }
}

function Val({ v }) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
    return <span className="blank">(공란)</span>
  }
  if (Array.isArray(v)) return <>{v.join(', ')}</>
  return <>{String(v)}</>
}

/**
 * 학업성적관리규정 판정 (V01~V18).
 * ERROR — 이 상태로는 생성되지 않는다 / WARN — 확인 권고 / FLAG — 위원회 심의 대상.
 * 판정 자체는 서버 검증기가 한다 (규칙을 화면에 복제하지 않는다).
 */
function RegulationFindings({ findings }) {
  if (!findings || findings.length === 0) return null
  const groups = [
    ['ERROR', '규정 위반 — 고쳐야 생성됩니다', 'reg-error'],
    ['FLAG', '학업성적관리위원회 심의 대상', 'reg-flag'],
    ['WARN', '확인이 필요합니다', 'reg-warn'],
  ]
  return (
    <div className="reg-box">
      {groups.map(([sev, title, cls]) => {
        const list = findings.filter((f) => f.severity === sev)
        if (list.length === 0) return null
        return (
          <div key={sev} className={`reg-group ${cls}`}>
            <b>{title}</b>
            <ul>
              {list.map((f, i) => (
                <li key={i}>
                  {f.message}
                  {f.article && <span className="muted small"> ({f.article})</span>}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="plan-sec">
      <h4>{title}</h4>
      {children}
    </section>
  )
}

export default function PlanCard({ manifest: m, plan, findings = [], busy, onGenerate, onEdit }) {
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

  const hours = resolveHours(plan)
  const rows = Array.isArray(plan[monthlyKey]) ? plan[monthlyKey] : []
  const exam = plan[examKey] || {}
  const rounds = Array.isArray(exam.rounds) ? exam.rounds : []
  const areas = Array.isArray(plan[perfKey]) ? plan[perfKey] : []
  const plans = Array.isArray(plan[plansKey]) ? plan[plansKey] : []
  const levels = plan[levelsKey] || {}
  const purposes = Array.isArray(plan[purposeKey]) ? plan[purposeKey] : []

  // ⚠ 서·논술형 30% 판정은 서버 검증기(V04)가 한다. 규칙을 화면에 복제하지 않는다
  //   — 규정이 바뀌면 한쪽만 고쳐져 화면이 거짓말을 하게 된다.

  return (
    <div className="card plan">
      <h3>이 내용으로 초안을 만듭니다</h3>
      <p className="muted small">
        결재 전 반드시 검토가 필요한 <b>초안</b>입니다. 공란은 양식에 빈칸으로 들어갑니다.
      </p>

      <RegulationFindings findings={findings} />

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
          {hours.applied ? (
            <p className="muted small">
              시수/누계는 학사일정 기반 고정표로 <b>자동 입력</b>됩니다 (주당{' '}
              {plan.weekly_hours}시간 · 합계 {hours.row.total}
              {hours.row.min_required !== undefined && (
                <>
                  {' '}
                  / 최소 기준 {hours.row.min_required}
                  {hours.row.ok === false && (
                    <span className="warn"> ⚠ 최소 기준 미달</span>
                  )}
                </>
              )}
              ).
            </p>
          ) : hours.reason === 'manual' ? (
            <p className="muted small">
              시수/누계는 <b>교사가 직접 지정한 값</b>을 사용합니다 (hours_manual).
            </p>
          ) : (
            <p className="warn small">
              ⚠ 주당 시수(
              {plan.weekly_hours === undefined || plan.weekly_hours === ''
                ? '미입력'
                : String(plan.weekly_hours)}
              )가 고정표 범위를 벗어나 자동 입력되지 않습니다. 아래 값이 그대로 들어갑니다.
            </p>
          )}
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>월</th>
                  {mp.row_fields.map((rf) => (
                    <th key={rf.key}>
                      {rf.label}
                      {rf.key === 'hours_cum' && hours.applied && (
                        <span className="muted small"> (자동)</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.month || mp.months[i]}</td>
                    {mp.row_fields.map((rf) => (
                      <td key={rf.key}>
                        {rf.key === 'hours_cum' && hours.applied ? (
                          <b>{hours.months[i] ?? ''}</b>
                        ) : (
                          <Val v={row[rf.key]} />
                        )}
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
                    .filter(
                      (f) =>
                        f.key !== 'name' &&
                        f.type !== 'table_rows' &&
                        f.type !== 'element_groups'
                    )
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
                .filter((f) => f.type === 'element_groups')
                .map((f) => {
                  const groups = Array.isArray(p[f.key]) ? p[f.key] : []
                  return (
                    <div key={f.key}>
                      <div className="sub-label">
                        {f.label} (요소 {groups.length}/{f.groups}, 수준 {f.levels}단계)
                      </div>
                      {groups.length === 0 ? (
                        <p className="blank">(공란)</p>
                      ) : (
                        <div className="scroll-x">
                          <table className="table">
                            <thead>
                              <tr>
                                <th>평가 요소</th>
                                {Array.from({ length: f.levels }, (_, k) => (
                                  <th key={k}>{k + 1}수준</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {groups.slice(0, f.groups).map((g, j) => {
                                const levels = Array.isArray(g?.levels) ? g.levels : []
                                return (
                                  <tr key={j}>
                                    <td>
                                      <Val v={g?.name} />
                                    </td>
                                    {Array.from({ length: f.levels }, (_, k) => {
                                      const lv = levels[k] || {}
                                      const desc = lv.desc
                                      const pts = lv.points
                                      return (
                                        <td key={k}>
                                          <Val v={desc} />
                                          {pts !== undefined && pts !== '' && (
                                            <span className="muted small"> ({String(pts)}점)</span>
                                          )}
                                        </td>
                                      )
                                    })}
                                  </tr>
                                )
                              })}
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
