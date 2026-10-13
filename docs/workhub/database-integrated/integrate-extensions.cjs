// 추가 기능 계약을 기존 API·시험·모듈 식별자와 합친다. 실행 SQL이나 DB 연결은 없다.
const fs=require('node:fs'),path=require('node:path');
const root=__dirname;
const read=n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8').replace(/^\uFEFF/,''));
const write=(n,v)=>fs.writeFileSync(path.join(root,n),JSON.stringify(v,null,2)+'\n');
const release=read('design-release.json');
const extensions=release.extensions.map(file=>({...read(file),source_file:file}));
const apis=read('api-contracts.json'),tests=read('acceptance-tests.json'),modules=read('site-modules.json');
const mergeRows=(rows,added)=>{for(const row of added){const i=rows.findIndex(x=>x.id===row.id);if(i<0)rows.push(row);else rows[i]=row;}};
mergeRows(apis.apis,read('existing-api-amendments.json').apis);
for(const ext of extensions){
 if(!ext.domain||!Array.isArray(ext.changes)||!Array.isArray(ext.apis)||!Array.isArray(ext.tests)||!Array.isArray(ext.tickets))throw new Error('확장 계약 누락: '+ext.source_file);
 mergeRows(apis.apis,ext.apis);mergeRows(tests.tests,ext.tests);
 for(const api of ext.apis)for(const id of api.modules){const m=modules.modules.find(x=>x.id===id);if(!m)throw new Error('없는 모듈: '+id);m.apis=[...new Set([...m.apis,api.id])];m.tables=[...new Set([...m.tables,...api.tables])];}
}
const m05=modules.modules.find(m=>m.id==='M05');m05.name='메신저·전달·알림·문의';m05.screen='교사 대화/개별·단체 발송/알림함/전달사항/문의';m05.rule='AI 대화와 교사 대화 분리, 발송 확인·현재 참가 권한, 읽음·제출·동의·확정 구분';
const m04=modules.modules.find(m=>m.id==='M04');m04.screen='양식 분석/방식·질문 확인/받은·보낸 수합/문답·직접 입력/완료본';m04.rule='안내 공개와 완료본 공개 분리, 문항판·접수판 불변; 양식·질문·답변·파일·최종확인의 정확한 판 연결';
const m09=modules.modules.find(m=>m.id==='M09');m09.screen='관리자 기본자료/조건 설정/편성 작업대/확정 시간표';m09.rule='최종 구조 포함, 알고리즘·실제 구현은 사용자 보류 유지; 관리자 자료판·담당자 조건·초안과 배포 분리';
for(const obj of [apis,tests,modules])obj.version=release.version;
write('api-contracts.json',apis);write('acceptance-tests.json',tests);write('site-modules.json',modules);
const tickets=extensions.flatMap(e=>e.tickets.map(t=>({...t,domain:e.domain,source_file:e.source_file,status:'specified_not_implemented'})));
write('implementation-backlog.json',{version:release.version,status:release.status,tickets});
// 요약 문서도 정형 API/시험과 같은 원본에서 갱신해 오래된 입력·상태 설명을 남기지 않는다.
function section(file,start,end,body){let text=fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');const a=text.indexOf(start),b=text.indexOf(end,a+start.length);if(a<0||b<0)throw new Error('문서 생성 구간 없음: '+file);text=text.slice(0,a)+body+'\n\n'+text.slice(b);if(file==='05-api-site-contract.md')text=text.replace(/\d+개 기능군 모두 현재 status/,apis.apis.length+'개 기능군 모두 현재 status');if(file==='06-validation-release.md')text=text.replaceAll('M00~M15/API01~24','M00~M15/API01~29');fs.writeFileSync(path.join(root,file),text);}
const apiText='## 기능군별 계약\n\n'+apis.apis.map(a=>'### '+a.id+' · '+a.modules.join(' / ')+'\n\n- 명령: '+a.commands.join(', ')+'\n- 읽기: '+a.reads+'\n- 표: '+a.tables.join(', ')+'\n- 입력: '+a.input+'\n- 권한: '+a.authorization+'\n- 결과: '+a.result+'\n- 필수 시험: '+a.tests+'\n').join('\n');
section('05-api-site-contract.md','## 기능군별 계약','## 대시보드 응답',apiText);
const testText='## 반드시 통과할 사례\n\n'+tests.tests.map(t=>'### '+t.id+' '+t.topic+'\n\n- 상황: '+t.given+'\n- 기대 결과: '+t.expected+'\n- 시험 층: '+t.layer+'\n- 명세: '+t.contract+'\n- 상태: 통합 DB에서 미실행\n').join('\n');
section('06-validation-release.md','## 반드시 통과할 사례','## 실제 두 연결 시험 방법',testText);
module.exports={release,extensions};
