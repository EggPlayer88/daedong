import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { auditDeployment, parseAuditArguments } from './lib/workhub-deployment-audit.mjs'

// import는 요청을 시작하지 않는다. CLI도 안전한 보고서만 기록하고 원시 오류를 출력하지 않는다.
export async function runDeploymentAuditCli(args, dependencies = {}) {
  const stdout = dependencies.stdout ?? (value => process.stdout.write(value))
  const stderr = dependencies.stderr ?? (value => process.stderr.write(value))
  let options
  try { options = parseAuditArguments(args) }
  catch { stderr(JSON.stringify({ code: 'INVALID_ARGUMENTS' }) + '\n'); return 2 }
  const report = await auditDeployment(options, { fetch: dependencies.fetch, now: dependencies.now, limits: dependencies.limits })
  const output = JSON.stringify(report, null, 2) + '\n'
  if (options.output) {
    try { await (dependencies.writeFile ?? writeFile)(options.output, output, { encoding: 'utf8', flag: 'wx', mode: 0o600 }) }
    catch { stderr(JSON.stringify({ code: 'REPORT_WRITE_FAILED' }) + '\n'); return 2 }
  }
  stdout(output)
  return report.status === 'observed' ? 0 : report.status === 'blocked' ? 2 : 1
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runDeploymentAuditCli(process.argv.slice(2)).then(code => { process.exitCode = code }, () => { process.stderr.write('{"code":"AUDIT_FAILED"}\n'); process.exitCode = 2 })
}
