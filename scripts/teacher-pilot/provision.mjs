#!/usr/bin/env node
import { readFileSync, existsSync, realpathSync, lstatSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateConfig, planProvision, provision } from './core.mjs'
import { privateDirectory, atomicJson, withProvisionLock } from './private-store.mjs'

const repoRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const error = code => { throw Object.assign(new Error(code), { code }) }

async function main() {
  const args = process.argv.slice(2), options = {}
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (!['--config', '--private-dir', '--confirm-hash', '--execute'].includes(key) || key in options) error('INVALID_ARGUMENT')
    if (key === '--execute') options[key] = true
    else { const value = args[++i]; if (!value || value.startsWith('--')) error('INVALID_ARGUMENT'); options[key] = value }
  }
  if (!options['--config']) error('CONFIG_REQUIRED')
  const config = validateConfig(JSON.parse(readFileSync(resolve(options['--config']), 'utf8').replace(/^\uFEFF/, '')))
  if (!options['--execute']) {
    // 기본 모드는 비밀번호·환경변수·네트워크를 건드리지 않는다.
    console.log(JSON.stringify(planProvision(config), null, 2)); return
  }
  if (options['--confirm-hash'] !== planProvision(config).configHash) error('CONFIRM_HASH_MISMATCH')
  // 만료된 시험은 비밀 읽기·폴더 준비·SDK 생성보다 먼저 거절한다.
  if (Date.now() >= Date.parse(config.expiresAt)) error('BATCH_EXPIRED')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (typeof key !== 'string' || key.length < 32) error('SERVICE_KEY_REQUIRED')
  const directory = privateDirectory(options['--private-dir'], config.batchId, repoRoot)
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(`https://${config.projectRef}.supabase.co`, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const journalPath = join(directory, 'credentials.private.json')
  const store = {
    load: async () => {
      if (!existsSync(journalPath)) return null
      if (lstatSync(journalPath).isSymbolicLink() || !lstatSync(journalPath).isFile()) error('UNSAFE_PRIVATE_FILE')
      return JSON.parse(readFileSync(journalPath, 'utf8'))
    },
    save: async value => atomicJson(journalPath, value)
  }
  const manifest = await withProvisionLock(directory, async () => {
    const value = await provision(config, { admin: client.auth.admin, store, confirmedHash: options['--confirm-hash'] })
    atomicJson(join(directory, 'registration.json'), value)
    return value
  })
  console.log(JSON.stringify({ status: 'auth_prepared', count: manifest.entries.length, batchId: manifest.batchId, registrationPath: join(directory, 'registration.json'), credentialsPath: journalPath, schoolConnected: false, aiEnabled: false }))
}
main().catch(failure => {
  // SDK 오류 원문·입력값에는 비밀이 있을 수 있으므로 허용한 코드만 출력한다.
  const code = typeof failure?.code === 'string' && /^[A-Z_]{3,70}$/.test(failure.code) ? failure.code : 'PREPARATION_FAILED'
  console.error(JSON.stringify({ status: 'stopped', code, hint: '같은 설정과 비공개 기록으로 재확인하세요. 기존 계정을 삭제하거나 비밀번호를 바꾸지 않습니다.' }))
  process.exitCode = 1
})
