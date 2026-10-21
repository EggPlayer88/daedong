"""DB를 만들기 전에 외부 접속 정보와 임의 인자를 거부하는지 확인한다."""
from pathlib import Path
import os,sys,subprocess,unittest
SCRIPT=Path(__file__).with_name('run_integrated.py')
class SafetyTests(unittest.TestCase):
 def run_refused(self,env,args=()):
  clean={key:value for key,value in os.environ.items() if key.upper() in ('PATH','SYSTEMROOT','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','LANG')}
  result=subprocess.run([sys.executable,str(SCRIPT),*args],env={**clean,'PYTHONIOENCODING':'utf-8',**env},capture_output=True,text=True,encoding='utf8',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
  self.assertNotEqual(result.returncode,0)
  self.assertNotIn('initdb',result.stdout+result.stderr)
  return result.stderr
 def test_dsn_is_rejected_before_cluster_creation(self):
  self.assertIn('외부 접속',self.run_refused({'DATABASE_URL':'postgresql://invalid.example/db'}))
 def test_libpq_option_is_rejected_before_cluster_creation(self):
  self.assertIn('외부 접속',self.run_refused({'PGOPTIONS':'invalid'}))
 def test_service_secret_is_rejected_without_printing_it(self):
  value='synthetic-secret-do-not-print'
  error=self.run_refused({'SUPABASE_SERVICE_ROLE_KEY':value})
  self.assertIn('외부 접속',error);self.assertNotIn(value,error)
 def test_libpq_hostaddr_is_rejected_before_cluster_creation(self):
  self.assertIn('외부 접속',self.run_refused({'PGHOSTADDR':'127.0.0.2'}))
 def test_libpq_ssl_key_is_rejected_before_cluster_creation(self):
  value='synthetic-private-key-path'
  error=self.run_refused({'PGSSLKEY':value})
  self.assertIn('외부 접속',error);self.assertNotIn(value,error)
 def test_libpq_names_are_case_insensitive(self):
  self.assertIn('외부 접속',self.run_refused({'pgHostAddr':'127.0.0.2'}))
 def test_unknown_argument_is_rejected(self):
  self.assertIn('인자를 받지 않습니다',self.run_refused({},['--database-url=postgresql://invalid.example/db']))
if __name__=='__main__':unittest.main()
