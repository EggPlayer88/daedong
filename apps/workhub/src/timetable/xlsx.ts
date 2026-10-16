import { zipSync, strToU8, Inflate } from 'fflate'
import limits from './workbook-limits.json'

export type WorkbookSheet = { name: string; rows: string[][]; hidden?: boolean }
export class TimetableWorkbookError extends Error {
  constructor(message: string) { super(message); this.name = 'TimetableWorkbookError' }
}
const fail = (message = '시간표 양식으로 저장한 XLSX 파일인지 확인해 주세요.'): never => { throw new TimetableWorkbookError(message) }
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const colName = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : colName(Math.floor(index / 26) - 1) + String.fromCharCode(65 + index % 26)
function checkSheet(sheet: WorkbookSheet) {
  if (!sheet.name || sheet.name.length > 31 || /[\\/?*\[\]:]/.test(sheet.name) || sheet.rows.length > limits.rows) fail()
  for (const row of sheet.rows) {
    if (row.length > limits.columns) fail()
    for (const cell of row) if (typeof cell !== 'string' || cell.length > limits.cellChars || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(cell)) fail('엑셀 셀의 길이나 문자를 확인해 주세요.')
  }
}

// 모든 값은 문자열 셀이다. =, + 등으로 시작하는 교사 입력을 수식으로 만들지 않는다.
export function writeTimetableXlsx(sheets: WorkbookSheet[]): Uint8Array {
  if (!sheets.length || sheets.length > limits.sheets || new Set(sheets.map(s => s.name)).size !== sheets.length || sheets.every(s => s.hidden)) fail()
  sheets.forEach(checkSheet)
  const files: Record<string, Uint8Array> = {}
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  files['_rels/.rels'] = strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${relns}"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.hidden ? ' state="hidden"' : ''}/>`).join('')}</sheets></workbook>`)
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${relns}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="style" Type="${relns}/styles" Target="styles.xml"/></Relationships>`)
  files['xl/styles.xml'] = strToU8(`<?xml version="1.0"?><styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF245B99"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
  sheets.forEach((sheet, i) => {
    const width = Math.max(1, ...sheet.rows.map(row => row.length))
    const body = sheet.rows.map((row, y) => `<row r="${y + 1}">${row.map((value, x) => `<c r="${colName(x)}${y + 1}" t="inlineStr" s="${y === 0 ? 1 : 0}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('')
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${width}" width="24" customWidth="1"/></cols><sheetData>${body}</sheetData>${sheet.rows.length > 1 ? `<autoFilter ref="A1:${colName(width - 1)}${sheet.rows.length}"/>` : ''}</worksheet>`)
  })
  if (Object.values(files).reduce((n, b) => n + b.length, 0) > limits.expandedBytes) fail('엑셀 자료가 한 번에 처리할 수 있는 크기를 넘습니다.')
  const result = zipSync(files, { level: 6 })
  if (result.length > limits.fileBytes) fail('엑셀 파일 크기가 한도를 넘습니다.')
  return result
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0 })
const crc32 = (data: Uint8Array) => { let crc = 0xffffffff; for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0 }
// 중앙 목록을 먼저 검사하고, DEFLATE도 작은 입력 조각으로 풀어 실제 출력 한도를 확인한다.
function unzipWorkbook(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 22 || bytes.length > limits.fileBytes) fail('XLSX 파일은 8 MiB 이하로 올려 주세요.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder('utf-8', { fatal: true })
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail()
  const count = view.getUint16(end + 10, true), offset = view.getUint32(end + 16, true), size = view.getUint32(end + 12, true)
  if (!count || count > limits.zipEntries || count !== view.getUint16(end + 8, true) || offset + size !== end) fail()
  const files = new Map<string, Uint8Array>(), ranges: [number, number][] = []
  let cursor = offset, total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) fail()
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), crc = view.getUint32(cursor + 16, true)
    const compressed = view.getUint32(cursor + 20, true), expanded = view.getUint32(cursor + 24, true), nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true), local = view.getUint32(cursor + 42, true)
    const next = cursor + 46 + nameLength + extra + comment
    if (next > end || flags & 1 || ![0, 8].includes(method) || expanded > limits.entryBytes || (total += expanded) > limits.expandedBytes || local + 30 > offset) fail('암호화되었거나 지원 범위를 넘는 엑셀 파일입니다.')
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || files.has(name) || /(?:vbaProject|externalLinks|embeddings)/i.test(name)) fail('중복 경로·외부 연결·매크로가 없는 XLSX 양식을 사용해 주세요.')
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags) fail()
    const localName = view.getUint16(local + 26, true), start = local + 30 + localName + view.getUint16(local + 28, true), finish = start + compressed
    if (finish > offset || decoder.decode(bytes.subarray(local + 30, local + 30 + localName)) !== name || ranges.some(([a, b]) => local < b && finish > a)) fail()
    ranges.push([local, finish])
    let data: Uint8Array
    if (method === 0) data = bytes.slice(start, finish)
    else {
      const chunks: Uint8Array[] = []; let actual = 0
      const stream = new Inflate(chunk => { actual += chunk.length; if (actual > expanded || actual > limits.entryBytes) fail('압축을 푼 파일의 크기가 목록과 다릅니다.'); chunks.push(chunk) })
      if (!compressed) fail()
      for (let at = start; at < finish; at += 1024) stream.push(bytes.subarray(at, Math.min(at + 1024, finish)), at + 1024 >= finish)
      data = new Uint8Array(actual); let pos = 0; for (const chunk of chunks) { data.set(chunk, pos); pos += chunk.length }
    }
    if (data.length !== expanded || crc32(data) !== crc) fail('파일 일부가 손상되었습니다. 엑셀에서 다시 저장한 파일을 올려 주세요.')
    files.set(name, data); cursor = next
  }
  if (cursor !== end) fail()
  return files
}

function parseXml(bytes: Uint8Array | undefined): XMLDocument {
  if (!bytes) fail('필수 시트 또는 엑셀 파일 구조가 없습니다.')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail()
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) fail('엑셀의 XML 내용을 읽지 못했습니다.')
  return doc
}
const descendants = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name))
const textNodes = (node: Element) => descendants(node, 't').map(t => t.textContent ?? '').join('')
function readSheet(doc: XMLDocument, shared: string[]): string[][] {
  if (descendants(doc, 'f').length || descendants(doc, 'mergeCell').length) fail('입력 양식에는 수식이나 병합 셀을 사용하지 말고 값을 입력해 주세요.')
  const rows: string[][] = [], seen = new Set<number>()
  for (const row of descendants(doc, 'row')) {
    const n = Number(row.getAttribute('r'))
    if (!Number.isSafeInteger(n) || n < 1 || n > limits.rows || seen.has(n)) fail()
    seen.add(n); const cells: string[] = [], used = new Set<number>()
    for (const cell of Array.from(row.children)) {
      if (cell.localName !== 'c') continue
      const ref = /^([A-Z]+)([1-9][0-9]*)$/.exec(cell.getAttribute('r') ?? '')
      if (!ref || Number(ref[2]) !== n) return fail()
      const column = [...ref[1]].reduce((v, char) => v * 26 + char.charCodeAt(0) - 64, 0) - 1
      if (column >= limits.columns || used.has(column)) fail()
      used.add(column)
      const kind = cell.getAttribute('t'), value = descendants(cell, 'v')[0]?.textContent ?? ''
      let result: string
      if (kind === 'inlineStr') result = textNodes(cell)
      else if (kind === 's') { const index = Number(value); if (!/^\d+$/.test(value) || !Number.isSafeInteger(index) || index >= shared.length) fail(); result = shared[index] }
      else if (kind === null || kind === 'n' || kind === 'str') result = value
      else return fail('문자·숫자만 입력한 시간표 양식을 사용해 주세요.')
      if (result.length > limits.cellChars) fail()
      cells[column] = result
    }
    rows[n - 1] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? '')
  }
  return Array.from({ length: rows.length }, (_, i) => rows[i] ?? [])
}
export function readTimetableXlsx(bytes: Uint8Array): WorkbookSheet[] {
  try {
    const files = unzipWorkbook(bytes)
    const types = parseXml(files.get('[Content_Types].xml'))
    if (!descendants(types, 'Override').some(e => e.getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) fail()
    // 원격 연결은 읽거나 실행하지 않는다. 가져오기 양식에는 외부 참조도 받지 않는다.
    for (const [name, content] of files) if (name.endsWith('.rels') && descendants(parseXml(content), 'Relationship').some(e => e.getAttribute('TargetMode') === 'External')) fail('외부 연결이 없는 시간표 양식을 올려 주세요.')
    const workbook = parseXml(files.get('xl/workbook.xml')), rels = descendants(parseXml(files.get('xl/_rels/workbook.xml.rels')), 'Relationship')
    const shared = files.has('xl/sharedStrings.xml') ? descendants(parseXml(files.get('xl/sharedStrings.xml')), 'si').map(textNodes) : []
    if (shared.length > limits.rows * limits.columns || shared.some(s => s.length > limits.cellChars)) fail()
    const elements = descendants(workbook, 'sheet')
    if (!elements.length || elements.length > limits.sheets) fail()
    const sheets = elements.map(sheet => {
      const name = sheet.getAttribute('name') ?? '', id = sheet.getAttributeNS(relns, 'id'), matches = rels.filter(r => r.getAttribute('Id') === id)
      if (!id || matches.length !== 1 || matches[0].getAttribute('Type') !== `${relns}/worksheet`) fail()
      const target = matches[0].getAttribute('Target') ?? ''
      if (target.includes('..') || target.includes('\\') || !/^(?:\/xl\/|worksheets\/)/.test(target)) fail()
      const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target
      const result = { name, rows: readSheet(parseXml(files.get(path)), shared), hidden: sheet.getAttribute('state') !== null && sheet.getAttribute('state') !== 'visible' }
      checkSheet(result); return result
    })
    if (new Set(sheets.map(s => s.name)).size !== sheets.length) fail()
    return sheets
  } catch (error) { if (error instanceof TimetableWorkbookError) throw error; return fail() }
}
