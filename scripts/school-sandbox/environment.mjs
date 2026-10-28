import { readFileSync } from 'node:fs'
import { Client } from 'pg'

// 운영 프로젝트에는 접속하지 않는다. 복제 프로젝트가 바뀌면 검토 후 허용값을 바꾼다.
export const SANDBOX_REF = 'vfnemvoszjglfblsrzoh'
export const PRODUCTION_REF = 'dhaoszbqtbofqftgjfyb'
export const RUN_ID = 'daedong-year-20261028'
export function assertSandbox(config) {
  if (config?.projectRef !== SANDBOX_REF || config.db?.user !== `postgres.${SANDBOX_REF}` ||
      config.db?.host !== 'aws-0-ap-northeast-2.pooler.supabase.com' || config.db?.port !== 5432 ||
      config.db?.database !== 'postgres' || config.db?.ssl?.rejectUnauthorized !== true || !config.db?.ssl?.ca ||
      JSON.stringify(config).includes(PRODUCTION_REF)) throw new Error('시험 전용 프로젝트·TLS 설정이 일치하지 않습니다.')
  return config
}
export function loadSecrets(path) {
  if (!path) throw new Error('Git에 포함되지 않는 시험 전용 연결 파일을 지정하세요.')
  return assertSandbox(JSON.parse(readFileSync(path, 'utf8')))
}
export async function connectSandbox(config) {
  assertSandbox(config)
  const client = new Client({ ...config.db, connectionTimeoutMillis: 15000 })
  await client.connect()
  await client.query("set statement_timeout='120s'")
  return client
}
export async function assertMarker(client) {
  const result = await client.query('select project_ref,run_id from sandbox_private.environment where singleton')
  if (result.rows.length !== 1 || result.rows[0].project_ref !== SANDBOX_REF || result.rows[0].run_id !== RUN_ID)
    throw new Error('시험 환경 식별자가 일치하지 않습니다.')
}
