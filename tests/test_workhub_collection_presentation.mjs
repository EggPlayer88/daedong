import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const m=await loadBrowserModule(`
 export * from '../apps/workhub/src/collections/presentation'
 export {publicationTargets,guidedCommand,guidedReceipt} from '../apps/workhub/src/documents/guided-contracts'
`)
const check=(name,fn)=>{fn();console.log('  ✓ '+name)}
const row={requestId:'c1',version:1,status:'published',phase:'open',dueDate:'2027-03-01'}
check('담당자 초안과 공개 상태를 구분한다',()=>assert.equal(m.collectionStateLabel('draft',row.dueDate,'2027-03-02'),'담당자 초안'))
check('기한 당일은 접수 중이고 다음 날은 기한 지남이다',()=>{assert.equal(m.collectionStateLabel('published',row.dueDate,'2027-03-01','open'),'접수 중');assert.equal(m.collectionStateLabel('published',row.dueDate,'2027-03-02','open'),'기한 지남 · 접수 중')})
for(const [phase,label] of [['closed','마감됨'],['archived','보관됨']])check('담당자의 '+label+' 상태가 날짜보다 우선한다',()=>assert.equal(m.collectionStateLabel('published',row.dueDate,'2028-01-01',phase),label))
check('미조회·오류 상태를 접수 중으로 꾸미지 않는다',()=>assert.equal(m.collectionStateLabel('published',row.dueDate,'2027-03-02'),'공개됨 · 접수 상태 확인 필요'))
check('서버 학교 날짜와 요청별 판을 고정한다',()=>assert.deepEqual(m.parseCollectionStatuses({today:'2027-03-02',items:[row]},['c1']),{today:'2027-03-02',items:[row]}))
for(const patch of [{phase:'done'},{requestId:'other'},{version:0},{status:'archived'},{dueDate:'bad'}])check('변조 상태 응답 거절 '+JSON.stringify(patch),()=>assert.throws(()=>m.parseCollectionStatuses({today:'2027-03-02',items:[{...row,...patch}]},['c1'])))
check('누락·중복·추가 상태 응답을 거절한다',()=>{for(const items of [[],[row,row]])assert.throws(()=>m.parseCollectionStatuses({today:'2027-03-02',items},['c1']))})
const target={requestId:'c1',title:'수합',version:1,publication:{state:'draft',dueDate:'2027-03-01',unitLabels:['1학년','2학년'],recipientCount:4}}
check('동시 게시 대상의 상태·기한·단위·수신 인원을 검증한다',()=>assert.deepEqual(m.publicationTargets({items:[target]}),[target]))
for(const publication of [{...target.publication,state:'archived'},{...target.publication,recipientCount:0},{...target.publication,unitLabels:[null]}])check('잘못된 대상 게시 요약 거절 '+JSON.stringify(publication),()=>assert.throws(()=>m.publicationTargets({items:[{...target,publication}]})))
const command={kind:'publish_collection',templateId:'t1',expectedVersion:2,previewArtifactId:'a1',collectionRequestId:'c1',collectionVersion:1}
check('동시 게시 명령은 새 종류로 고정한다',()=>assert.deepEqual(m.guidedCommand(command),command))
check('접수증은 원래 번호·양식·다음 판을 요구한다',()=>{const receipt={requestKey:'k1',templateId:'t1',templateVersion:3,responseId:null,responseVersion:null};assert.deepEqual(m.guidedReceipt(receipt,'k1',command),receipt);for(const patch of [{requestKey:'other'},{templateVersion:4},{responseId:'other'}])assert.throws(()=>m.guidedReceipt({...receipt,...patch},'k1',command))})
