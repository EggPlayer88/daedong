import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const sourcePath=new URL('../database/workhub/p7/P7-05_R1_P2_보강_별도승인.sql',import.meta.url)
const sourceHash='66c16e6c5ddae17f46555b311de8c031d6e70bc29379aafab53d1d5948812caf'
const oldGuard="(SELECT md5(prosrc) FROM pg_proc WHERE oid = 'workhub_private.collections_guard()'::regprocedure)"
const newGuard="(SELECT md5(replace(prosrc, E'\\r\\n', E'\\n')) FROM pg_proc WHERE oid = 'workhub_private.collections_guard()'::regprocedure)"
const approval=/DECLARE p jsonb := \$json\$\n[\s\S]*?\n\$json\$::jsonb;/

// 확정 SQL은 읽기만 한다. 알려진 원본의 사전 지문 비교 한 곳에서 CRLF만 LF로 정규화한다.
export function prepareP7Bridge(source,approvedBy,approvalRef){
 const normalized=source.replace(/\r\n/g,'\n')
 if(createHash('sha256').update(normalized).digest('hex')!==sourceHash)throw Error('P7-05 확정 원본이 다릅니다.')
 for(const [value,max]of [[approvedBy,100],[approvalRef,200]])if(typeof value!=='string'||!value.trim()||value.length>max||/[<>\u0000-\u001f]/u.test(value))throw Error('승인자와 승인 근거를 확인해 주세요.')
 if(normalized.split(oldGuard).length!==2||!approval.test(normalized))throw Error('P7-05 준비 위치가 다릅니다.')
 const encoded=JSON.stringify({approved_by:approvedBy,approval_ref:approvalRef}).replace(/'/g,"''")
 return normalized.replace(oldGuard,newGuard).replace(approval,()=>`DECLARE p jsonb := '${encoded}'::jsonb;`)
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [output,approvedBy,approvalRef]=process.argv.slice(2)
 if(!output)throw Error('사용법: node scripts/prepare-workhub-p7-05.mjs 출력.sql 승인자 승인근거')
 writeFileSync(output,prepareP7Bridge(readFileSync(sourcePath,'utf8'),approvedBy,approvalRef),{encoding:'utf8',flag:'wx'})
 console.log('P7-05 승인 실행본 준비 완료. SQL 실행은 하지 않았습니다.')
}
