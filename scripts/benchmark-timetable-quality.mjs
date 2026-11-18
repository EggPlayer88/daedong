// 학교 실제 자료·DB를 읽지 않는다. 같은 입력을 두 엔진에서 순차 실행하고 공통 평가기로 비교한다.
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, totalmem, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { loadBrowserModule } from '../tests/helpers/load-browser-module.mjs'
import { makeQualitySchool } from '../tests/helpers/timetable-quality-fixtures.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha = value => createHash('sha256').update(value).digest('hex')
const args = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]
  if (key === '--warm') { if (args.has(key)) throw Error('--warm 옵션이 중복됐습니다.'); args.set(key, true); continue }
  if (!['--baseline-ref', '--output', '--scenario', '--seeds', '--seconds', '--fixture-seed'].includes(key) || args.has(key) || !process.argv[i + 1]) throw Error('지원 옵션: --baseline-ref --output --scenario simple|complex|large --seeds 1,2,3 --seconds 60 --fixture-seed 71283 --warm')
  args.set(key, process.argv[++i])
}
const baselineRef = args.get('--baseline-ref'), output = args.get('--output')
const scenario = args.get('--scenario') ?? 'complex', seconds = Number(args.get('--seconds') ?? 60), fixtureSeed = Number(args.get('--fixture-seed') ?? 71283)
const seedText = String(args.get('--seeds') ?? '11,12,13')
if (seedText.split(',').some(part => !part.trim())) throw Error('비어 있는 시드는 허용하지 않습니다.')
const seeds = seedText.split(',').map(Number)
if (typeof baselineRef !== 'string' || typeof output !== 'string' || !['simple', 'complex', 'large'].includes(scenario) || !Number.isInteger(seconds) || seconds < 1 || seconds > 120 || !seeds.length || seeds.some(n => !Number.isInteger(n) || n < 0 || n > 2147483647) || new Set(seeds).size !== seeds.length) throw Error('기준 커밋·출력 파일·시나리오·시간·시드를 확인해 주세요.')
const commit = execFileSync('git', ['rev-parse', '--verify', `${baselineRef}^{commit}`], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
const pythonChoices = [process.env.TIMETABLE_PYTHON, process.env.PYTHON,
  join(root, 'packages/timetable/.venv/Scripts/python.exe'), join(root, 'packages/timetable/.venv/bin/python'),
  join(root, 'tests/.venv/Scripts/python.exe'), join(root, 'tests/.venv/bin/python'), 'python3', 'python'].filter(Boolean)
const python = pythonChoices.find(p => (!/[\\/]/.test(p) || existsSync(p)) && spawnSync(p, ['-c', 'import ortools; assert ortools.__version__ == "9.15.6755"'], { stdio: 'ignore', timeout: 10000, windowsHide: true }).status === 0)
if (!python) throw Error('고정 버전 OR-Tools가 있는 Python이 필요합니다. TIMETABLE_PYTHON으로 지정할 수 있습니다.')
const runtime = JSON.parse(execFileSync(python, ['-c', 'import json,platform,ortools;print(json.dumps(dict(python=platform.python_version(),ortools=ortools.__version__,platform=platform.platform())))'], { encoding: 'utf8', windowsHide: true }))
const m = await loadBrowserModule(`export * from '../packages/timetable/src/validate';export * from '../packages/timetable/src/cpSat';export * from '../packages/timetable/src/balanced';`)
const fixture = makeQualitySchool({ classes: scenario === 'large' ? 18 : 9, complex: scenario !== 'simple', seed: fixtureSeed })
assert.equal(m.validateBasis(fixture.basis).valid, true, '합성 기준판을 검증하지 못했습니다.')
assert.equal(m.validatePlacements(fixture.basis, fixture.witness).valid, true, '알려진 유효 배치가 조건을 어겼습니다.')
const basisText = JSON.stringify(fixture.basis), previous = args.has('--warm') ? { basis: fixture.basis, placements: fixture.witness } : null
const work = mkdtempSync(join(tmpdir(), 'timetable-quality-'))
const report = { complete: false, startedAt: new Date().toISOString(), baselineCommit: commit, currentCommit, scenario, fixtureSeed, warmStart: !!previous,
  method: '같은 합성 입력·지정한 벽시계 예산·시드·후보3개·품질우선(minimizeChanges:false). 별도 Python 프로세스를 한 번에 하나씩 실행하고 순서 교대. 이전 엔진은 원래 단일 워커이며 새 엔진의 워커 수는 기록한 정책을 따른다. 모든 후보를 현재 독립 검증기와 같은 품질 평가기로 재평가. wallSeconds는 Python 기동부터 종료까지, verifiedWallSeconds는 요청 생성부터 응답 독립 검증까지이며 추가 보고용 재평가는 제외한다. 실제 학교 성능의 보장이 아님.',
  environment: { ...runtime, cpu: cpus()[0]?.model, logicalProcessors: cpus().length, memoryGiB: Math.round(totalmem() / 2 ** 30) }, input: { label: fixture.label, sha256: sha(basisText), lessons: fixture.basis.lessons.length, periods: fixture.basis.courseLoads.reduce((n, c) => n + c.periods, 0), resources: fixture.basis.resources.length, slots: fixture.basis.slots.length },
  options: { seconds, seeds, maxCandidates: 3, minimizeChanges: false }, qualityPolicy: JSON.parse(readFileSync(join(root, 'packages/timetable/_assets/balanced-policy.json'), 'utf8')),
  sourceHashes: {}, previousQuality: previous ? m.evaluateBalancedQuality(fixture.basis, fixture.witness) : null, runs: [] }
const outputPath = resolve(root, output)
function save() { mkdirSync(dirname(outputPath), { recursive: true }); writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n') }

try {
  const archivePath = join(work, 'baseline.tar'), baseline = join(work, 'baseline'), improved = join(work, 'improved')
  mkdirSync(baseline); mkdirSync(improved)
  const archive = execFileSync('git', ['archive', '--format=tar', commit, 'packages/timetable/engine', 'packages/timetable/_assets'], { cwd: root, maxBuffer: 64000000, windowsHide: true })
  writeFileSync(archivePath, archive)
  execFileSync(python, ['-c', "import sys,tarfile; t=tarfile.open(sys.argv[1]); t.extractall(sys.argv[2],filter='data'); t.close()", archivePath, baseline], { windowsHide: true })
  // 실행 중 작업 트리 변경이 비교 대상 엔진을 섞지 않도록 시작 시점에 계산 코드를 고정한다.
  for (const part of ['engine', '_assets']) {
    const source = join(root, 'packages/timetable', part), target = join(improved, 'packages/timetable', part)
    cpSync(source, target, { recursive: true, filter: path => !path.endsWith('__pycache__') && !path.endsWith('.pyc') })
    for (const name of readdirSync(source).filter(n => /\.(?:py|json)$/.test(n))) report.sourceHashes[`packages/timetable/${part}/${name}`] = sha(readFileSync(join(source, name)))
  }
  for (const file of ['src/balanced.ts', 'src/validate.ts', 'src/cpSat.ts']) report.sourceHashes[`packages/timetable/${file}`] = sha(readFileSync(join(root, 'packages/timetable', file)))
  report.sourceHashes['tests/helpers/timetable-quality-fixtures.mjs'] = sha(readFileSync(join(root, 'tests/helpers/timetable-quality-fixtures.mjs')))
  const roots = { baseline, improved }
  for (const [index, seed] of seeds.entries()) {
    const order = index % 2 ? ['improved', 'baseline'] : ['baseline', 'improved']
    const row = { seed, order }; report.runs.push(row)
    for (const name of order) {
      const runner = join(roots[name], 'packages/timetable/engine/runner.py')
      if (!existsSync(runner)) throw Error('기준 커밋은 현재 정규 계약의 runner.py를 포함해야 합니다.')
      const options = { maxSeconds: seconds, maxCandidates: 3, seed, minimizeChanges: false, improveTeacherBalance: true, spreadCourses: true, ...(name === 'improved' ? { qualityMode: 'balanced' } : {}) }
      const verificationStarted = performance.now()
      const request = await m.buildCpSatRequest(fixture.basis, `benchmark_${name}_${index}`, previous, options)
      const requestBuildSeconds = (performance.now() - verificationStarted) / 1000
      assert.equal(JSON.stringify(request.basis), basisText, '요청 생성이 합성 입력을 바꿨습니다.')
      const input = join(work, `${name}_${index}_request.json`), resultPath = join(work, `${name}_${index}_result.json`)
      writeFileSync(input, JSON.stringify(request), { flag: 'wx' })
      const started = performance.now()
      const child = spawnSync(python, [runner, '--input', input, '--output', resultPath], { cwd: root, encoding: 'utf8', timeout: (seconds + 20) * 1000, maxBuffer: 16000000, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } })
      const wallSeconds = (performance.now() - started) / 1000
      if (child.status !== 0 || child.error) throw Error(`${name} 시드 ${seed} 실행 실패: ${child.error?.message ?? child.stderr ?? child.status}`)
      const raw = JSON.parse(readFileSync(resultPath, 'utf8'))
      const validationStarted = performance.now()
      const verified = await m.parseCpSatResponse(request, raw)
      const resultValidationSeconds = (performance.now() - validationStarted) / 1000, verifiedWallSeconds = (performance.now() - verificationStarted) / 1000
      const fingerprints = new Set(), candidates = []
      for (const candidate of verified.candidates) {
        const validation = m.validatePlacements(fixture.basis, candidate.placements)
        assert.equal(validation.valid, true, '반환 후보의 독립 하드조건 검증에 실패했습니다.')
        const quality = m.evaluateBalancedQuality(fixture.basis, candidate.placements, options)
        if (candidate.quality) assert.deepEqual(candidate.quality, quality, '엔진 품질 보고와 독립 평가가 다릅니다.')
        const fingerprint = m.actualTimetableFingerprint(fixture.basis, candidate.placements)
        fingerprints.add(fingerprint)
        candidates.push({ quality, originalObjective: candidate.objective, optimal: candidate.optimal, hardValid: validation.valid, actualFingerprintSha256: sha(fingerprint), placements: candidate.placements })
      }
      const differences = candidates.map((candidate, i) => candidates.map((other, j) => i === j ? 0 : m.timetableDifferenceMinutes(fixture.basis, candidate.placements, other.placements)))
      const best = candidates.length ? Math.min(...candidates.map(c => c.quality.totalPenalty)) : null
      const tolerance = best === null ? null : best + Math.max(report.qualityPolicy.absoluteQualityTolerance, Math.floor(best * report.qualityPolicy.relativeQualityTolerance))
      // 같은 품질 상한과 거리 기준으로 최대 세 안 조합을 직접 검사한다.
      const eligible = candidates.filter(c => c.quality.totalPenalty <= tolerance)
      const bestCandidates = eligible.filter(c => c.quality.totalPenalty === best)
      let diverseQualityCount = 0, minimumRequiredDifferenceMinutes = null
      for (const first of bestCandidates) {
        const duration = [...m.actualTimetableCells(fixture.basis, first.placements).values()].reduce((n, value) => n + value, 0)
        const minimum = Math.max(1, Math.ceil(duration * report.qualityPolicy.minimumDifferenceFraction))
        const others = eligible.filter(c => c !== first && m.timetableDifferenceMinutes(fixture.basis, first.placements, c.placements) >= minimum)
        let count = others.length ? 2 : 1
        if (others.some((a, i) => others.slice(i + 1).some(b => m.timetableDifferenceMinutes(fixture.basis, a.placements, b.placements) >= minimum))) count = 3
        if (count > diverseQualityCount) { diverseQualityCount = count; minimumRequiredDifferenceMinutes = minimum }
      }
      row[name] = { status: verified.status, wallSeconds, requestBuildSeconds, resultValidationSeconds, verifiedWallSeconds, engineStats: verified.stats, requestHash: request.inputHash, bestPenalty: best, firstPenalty: candidates[0]?.quality.totalPenalty ?? null,
        actualCandidateCount: fingerprints.size, highQualityDiverseCandidateCount: diverseQualityCount, qualityCeiling: tolerance, minimumRequiredDifferenceMinutes, differences, candidates, issues: verified.issues }
      save()
      console.log(`${scenario} seed=${seed} ${name}: status=${verified.status} penalties=${JSON.stringify(candidates.map(c => c.quality.totalPenalty))} actual=${fingerprints.size} qualityDiverse=${diverseQualityCount} wall=${wallSeconds.toFixed(3)}s verified=${verifiedWallSeconds.toFixed(3)}s`)
    }
  }
  const mean = xs => xs.length ? xs.reduce((n, value) => n + value, 0) / xs.length : null
  const median = xs => { const sorted = [...xs].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null }
  const summary = name => {
    const results = report.runs.map(row => row[name]), penalties = results.flatMap(r => r.bestPenalty === null ? [] : [r.bestPenalty])
    return { runs: results.length, feasibleRuns: penalties.length, threeActualCandidateRuns: results.filter(r => r.actualCandidateCount === 3).length,
      threeHighQualityDiverseRuns: results.filter(r => r.highQualityDiverseCandidateCount === 3).length, meanBestPenalty: mean(penalties), medianBestPenalty: median(penalties), worstBestPenalty: penalties.length ? Math.max(...penalties) : null,
      threeHighQualityDiverseWithinBudgetRuns: results.filter(r => r.highQualityDiverseCandidateCount === 3 && r.verifiedWallSeconds <= seconds).length,
      meanWallSeconds: mean(results.map(r => r.wallSeconds)), maxWallSeconds: Math.max(...results.map(r => r.wallSeconds)),
      meanVerifiedWallSeconds: mean(results.map(r => r.verifiedWallSeconds)), maxVerifiedWallSeconds: Math.max(...results.map(r => r.verifiedWallSeconds)) }
  }
  const paired = report.runs.filter(row => row.baseline.bestPenalty !== null && row.improved.bestPenalty !== null)
  const baselineMean = mean(paired.map(row => row.baseline.bestPenalty)), improvedMean = mean(paired.map(row => row.improved.bestPenalty))
  report.summary = { baseline: summary('baseline'), improved: summary('improved'), pairedFeasibleRuns: paired.length,
    improvedPairs: paired.filter(row => row.improved.bestPenalty < row.baseline.bestPenalty).length, worsePairs: paired.filter(row => row.improved.bestPenalty > row.baseline.bestPenalty).length,
    pairedMeanPenaltyReduction: baselineMean ? 1 - improvedMean / baselineMean : null }
  report.complete = true; save(); console.log(JSON.stringify(report.summary, null, 2))
} finally {
  // 이 호출에서 만든 임시 폴더만 제거한다. 절대 경로가 시스템 임시 폴더 아래인지 다시 검사한다.
  const rel = relative(resolve(tmpdir()), resolve(work))
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error('임시 작업 경로가 예상 범위를 벗어났습니다.')
  rmSync(work, { recursive: true, force: true })
}
