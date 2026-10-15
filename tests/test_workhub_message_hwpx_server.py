"""메시지 파일 기본 확인의 권한 범위·실물·멱등 경계 시험."""
import copy, hashlib, importlib.util, sys, unittest
from pathlib import Path
from datetime import datetime,timedelta,timezone
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'apps/main/api/messages'))
import _message_hwpx as api
spec=importlib.util.spec_from_file_location('basic_fixture',ROOT/'tests/test_workhub_hwpx_basic_server.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
USER,MEMBER,FILE,OBJECT,SCHOOL=fixture.USER,fixture.MEMBER,fixture.FILE,fixture.OBJECT,fixture.SCHOOL
RAW=fixture.RAW

def env(data):return dict(contractVersion=1,schoolId=SCHOOL,memberId=MEMBER,userId=USER,ok=True,data=data)
def status(accepted=True):return dict(fileId=FILE,state='ready' if accepted else 'rejected',storageObjectId=OBJECT,file=dict(id=FILE,name='문서.hwpx',bytes=len(RAW),sha256=hashlib.sha256(RAW).hexdigest(),profile='hwpx_basic_v1') if accepted else None)
def claim():return dict(fileId=FILE,state='checking',leaseToken='original-lease-token',leaseExpiresAt=(datetime.now(timezone.utc)+timedelta(seconds=90)).isoformat(),bucket=api.BUCKET,path=f'{SCHOOL}/{MEMBER}/{FILE}/original.hwpx',storageObjectId=OBJECT,name='문서.hwpx',claimedBytes=len(RAW),claimedSha256=hashlib.sha256(RAW).hexdigest(),maxFileBytes=30*1024*1024)
class Client:
 def __init__(self):self.data=claim();self.calls=[];self.raw=RAW;self.final=None;self.response=None;self.downloads=[]
 def user(self,token):return USER
 def rpc(self,name,args):
  self.calls.append((name,copy.deepcopy(args)))
  if name.endswith('_claim'):return self.response or env(copy.deepcopy(self.data))
  return self.final or env(status(args['p_result']['accepted']))
 def download(self,bucket,path,maximum):self.downloads.append((bucket,path));return self.raw
class Tests(unittest.TestCase):
 def call(self,c):return api.check_file(fixture.PAYLOAD,fixture.TOKEN,c)
 def error(self,c,code):
  with self.assertRaises(api.basic.CheckError) as caught:self.call(c)
  self.assertEqual(caught.exception.code,code)
 def test_01_real_content(self):
  c=Client();r=self.call(c);self.assertEqual(r['data']['file']['sha256'],hashlib.sha256(RAW).hexdigest());self.assertEqual([x[0] for x in c.calls],list(api.NAMES));self.assertEqual(c.calls[-1][1]['p_actor_user_id'],USER);self.assertNotIn('leaseToken',str(r));self.assertNotIn('path',str(r))
 def test_02_collection_bucket_rejected(self):
  c=Client();c.data['bucket']='workhub-collection-files';self.error(c,'INVALID_RESPONSE');self.assertEqual(c.downloads,[])
 def test_03_foreign_member_path_rejected(self):
  c=Client();c.data['path']=f'{SCHOOL}/other/{FILE}/original.hwpx';self.error(c,'INVALID_RESPONSE')
 def test_04_foreign_envelope(self):
  c=Client();c.response=env(c.data);c.response['userId']='another';self.error(c,'INVALID_RESPONSE')
 def test_05_short_read_is_retryable(self):
  c=Client();c.raw=RAW[:-1];self.error(c,'RESULT_UNKNOWN');self.assertEqual(len(c.calls),1)
 def test_06_hash_rejection(self):
  c=Client();c.data['claimedSha256']='0'*64;r=self.call(c);self.assertEqual(r['data']['state'],'rejected');self.assertEqual(c.calls[-1][1]['p_result']['reasonCode'],'FILE_HASH_MISMATCH')
 def test_07_finish_object_changed(self):
  c=Client();c.final=env(status());c.final['data']['storageObjectId']=USER;self.error(c,'INVALID_RESPONSE')
 def test_08_cached_result_no_download(self):
  c=Client();c.data=status();self.assertEqual(self.call(c)['data'],status());self.assertFalse(c.downloads);self.assertEqual(len(c.calls),1)
 def test_09_busy_no_recheck(self):
  c=Client();c.data['leaseToken']=None;self.assertEqual(self.call(c)['data']['state'],'pending_basic');self.assertFalse(c.downloads)
 def test_10_expired_lease(self):
  c=Client();c.data['leaseExpiresAt']='2020-01-01T00:00:00Z';self.error(c,'INVALID_RESPONSE')
 def test_11_claim_business_error(self):
  c=Client();c.response={**env({}),'ok':False,'error':{'code':'NOT_READY'}};del c.response['data'];self.error(c,'NOT_READY')
 def test_12_cached_missing_object(self):
  c=Client();c.data=status();c.data['storageObjectId']=None;self.error(c,'INVALID_RESPONSE')
 def test_13_guarded_input(self):
  with self.assertRaises(api.basic.CheckError):api.check_file({**fixture.PAYLOAD,'actorUserId':USER},fixture.TOKEN,Client())
 def test_14_rpc_allowlist(self):
  c=api.MessageClient(fixture.ENV)
  with self.assertRaises(api.basic.CheckError):c.rpc('workhub_file_basic_claim',{})
 def test_15_size_limit(self):
  c=Client();c.data['maxFileBytes']=1;self.call(c);self.assertEqual(c.calls[-1][1]['p_result']['reasonCode'],'FILE_SIZE_LIMIT');self.assertFalse(c.downloads)
 def test_16_invalid_structure(self):
  c=Client();c.raw=b'x'*len(RAW);c.data['claimedSha256']=hashlib.sha256(c.raw).hexdigest();self.call(c);self.assertEqual(c.calls[-1][1]['p_result']['reasonCode'],'FILE_SIGNATURE_MISMATCH')
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
 if result.wasSuccessful():
  for n in range(result.testsRun):print('  ✓ 메시지 HWPX 서버',n+1)
 sys.exit(not result.wasSuccessful())
