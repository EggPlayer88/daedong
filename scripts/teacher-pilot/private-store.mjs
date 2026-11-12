import { writeFileSync, readFileSync, existsSync, mkdirSync, realpathSync, lstatSync, renameSync, chmodSync, unlinkSync } from 'node:fs'
import { join, relative, isAbsolute, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const error = code => { throw Object.assign(new Error(code), { code }) }
const inside = (root, target) => { const path = relative(root, target); return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)) }

export function privateDirectory(base, batchId, repoRoot, { run = execFileSync, platform = process.platform } = {}) {
  if (!base || !isAbsolute(base) || !existsSync(base)) error('PRIVATE_PARENT_REQUIRED')
  if (!/^[a-z][a-z0-9-]{2,47}$/.test(batchId)) error('INVALID_BATCH_DIRECTORY')
  const realBase = realpathSync(base)
  if (inside(realpathSync(repoRoot), realBase)) error('PRIVATE_DIRECTORY_MUST_BE_OUTSIDE_REPOSITORY')
  const path = join(realBase, batchId)
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) error('UNSAFE_PRIVATE_DIRECTORY')
  mkdirSync(path, { mode: 0o700, recursive: true })
  if (platform === 'win32') {
    const identity = run('whoami.exe', [], { encoding: 'utf8', windowsHide: true }).trim()
    if (!identity || /[\r\n]/.test(identity)) error('PRIVATE_ACL_FAILED')
    try { run('icacls.exe', [path, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`], { stdio: 'ignore', windowsHide: true }) }
    catch { error('PRIVATE_ACL_FAILED') }
    // 기존 폴더에 다른 사람의 명시 허용이 남아 있으면 비밀을 쓰지 않는다.
    const quotedPath = `'${path.replaceAll("'", "''")}'`
    const check = `$ErrorActionPreference='Stop'; $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $other=@([System.IO.Directory]::GetAccessControl(${quotedPath}).Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $me }); if($other.Count -gt 0){exit 7}`
    try { run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(check, 'utf16le').toString('base64')], { stdio: 'ignore', windowsHide: true }) }
    catch { error('PRIVATE_ACL_FAILED') }
  } else chmodSync(path, 0o700)
  return path
}

export function atomicJson(path, value) {
  if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) error('UNSAFE_PRIVATE_FILE')
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  renameSync(temp, path)
}

// 두 프로세스가 서로 다른 암호를 같은 계정에 선보관하지 못하게 한다.
export async function withProvisionLock(directory, action) {
  const lock = join(directory, 'provision.lock'), token = randomBytes(24).toString('hex')
  try { writeFileSync(lock, JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }) }
  catch { error('PROVISION_ALREADY_RUNNING') }
  try { return await action() }
  finally {
    // 외부에서 바꾼 잠금은 지우지 않는다. 강제 종료의 잠금은 수동 확인 대상이다.
    if (existsSync(lock) && !lstatSync(lock).isSymbolicLink()) {
      let own = false
      try { own = JSON.parse(readFileSync(lock, 'utf8')).token === token } catch { /* 손상된 잠금 유지 */ }
      if (own) unlinkSync(lock)
    }
  }
}
