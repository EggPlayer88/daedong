"""수합 HWPX 최소 검사 API: 실제 양식·원본 일치·권한 인계·HTTP 경계 검증."""
import base64
import copy
import hashlib
import http.client
import importlib.util
import io
import json
import struct
import sys
import threading
import unittest
import warnings
import zipfile
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / 'apps/main/api/collections'
sys.path.insert(0, str(API))
import _hwpx_basic as basic
spec = importlib.util.spec_from_file_location('check_hwpx', API / 'check-hwpx.py')
endpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(endpoint)

USER = '11111111-1111-4111-8111-111111111111'
MEMBER = '22222222-2222-4222-8222-222222222222'
FILE = '33333333-3333-4333-8333-333333333333'
OBJECT = '44444444-4444-4444-8444-444444444444'
SCHOOL = 'school-one'
TOKEN = 'Bearer ' + 'a' * 30
PAYLOAD = {'memberId': MEMBER, 'fileId': FILE, 'requestKey': 'original-request-key'}
SECRET = 'sb_secret_' + 'b' * 40
ENV = {'SUPABASE_URL': 'https://' + 'a' * 20 + '.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY': SECRET}
PARTS = {'mimetype': b'application/hwp+zip', 'Contents/content.hpf': b'<package/>', 'Contents/section0.xml': b'<section/>', 'META-INF/container.xml': b'<container/>'}


def document(parts=None, compression=zipfile.ZIP_DEFLATED):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression) as archive:
        for name, raw in (PARTS if parts is None else parts).items():
            archive.writestr(name, raw)
    return stream.getvalue()


RAW = document()
DIGEST = hashlib.sha256(RAW).hexdigest()
REF = {'id': FILE, 'name': '수합.hwpx', 'extension': 'hwpx', 'bytes': len(RAW), 'sha256': DIGEST}


def envelope(data):
    return {'contractVersion': 1, 'schoolId': SCHOOL, 'memberId': MEMBER, 'data': data}


def claim(**overrides):
    result = {'fileId': FILE, 'state': 'checking', 'leaseToken': 'lease-original-key',
              'leaseExpiresAt': (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat(),
              'bucket': basic.BUCKET, 'path': f'{SCHOOL}/{FILE}/' + 'a' * 32, 'storageObjectId': OBJECT,
              'name': '수합.hwpx', 'extension': 'hwpx', 'claimedBytes': len(RAW),
              'claimedSha256': DIGEST, 'maxFileBytes': basic.LIMITS['maxFileBytes']}
    result.update(overrides)
    return result


class Client:
    def __init__(self, data=None, raw=RAW):
        self.data = claim() if data is None else data
        self.raw, self.calls, self.downloads = raw, [], []
        self.finish_envelope = None
        self.download_error = self.finish_error = None
    def user(self, authorization):
        self.authorization = authorization
        return USER
    def rpc(self, name, args):
        self.calls.append((name, copy.deepcopy(args)))
        if name.endswith('_claim'):
            return envelope(copy.deepcopy(self.data))
        if self.finish_error:
            raise self.finish_error
        if self.finish_envelope:
            return copy.deepcopy(self.finish_envelope)
        result = args['p_result']
        state = result['outcome']
        ref = {**REF, 'bytes': result['sizeBytes'], 'sha256': result['sha256']} if state == 'ready' else None
        return envelope({'fileId': FILE, 'state': state, 'file': ref})
    def download(self, bucket, path, maximum):
        self.downloads.append((bucket, path, maximum))
        if self.download_error:
            raise self.download_error
        return self.raw


class StructureTests(unittest.TestCase):
    def rejected(self, raw, code):
        with self.assertRaises(basic.FileRejected) as error:
            basic.inspect_hwpx(raw)
        self.assertEqual(error.exception.code, code)
    def test_01_templates(self):
        templates = list((ROOT / 'apps/main/api/doc-ai/_assets').glob('tpl-*.hwpx'))
        self.assertEqual(len(templates), 6)
        for path in templates:
            with self.subTest(template=path.name):
                basic.inspect_hwpx(path.read_bytes())
    def test_02_minimal(self):
        basic.inspect_hwpx(RAW)
    def test_03_no_deep_xml_parsing(self):
        basic.inspect_hwpx(document({**PARTS, 'Contents/section0.xml': b'not parsed as XML'}))
    def test_04_wrong_file(self):
        self.rejected(b'%PDF-not-hwpx', 'FILE_SIGNATURE_MISMATCH')
    def test_05_missing_required(self):
        self.rejected(document({k: v for k, v in PARTS.items() if k != 'Contents/content.hpf'}), 'FILE_HWPX_REQUIRED_PART')
    def test_06_wrong_mimetype(self):
        self.rejected(document({**PARTS, 'mimetype': b'application/zip'}), 'FILE_SIGNATURE_MISMATCH')
    def test_07_duplicate(self):
        stream = io.BytesIO(RAW)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            with zipfile.ZipFile(stream, 'a') as archive:
                archive.writestr('mimetype', b'application/hwp+zip')
        self.rejected(stream.getvalue(), 'FILE_STRUCTURE_INVALID')
    def test_08_paths(self):
        for name in ('../x', '/x', 'C:/x', 'x\\y', 'x//y', 'x/./y', 'x\x00y'):
            with self.subTest(name=name):
                raw = document({**PARTS, name: b'x'})
                if '\\' in name:
                    raw = document({**PARTS, 'x-y': b'x'}).replace(b'x-y', b'x\\y')
                if '\x00' in name:
                    # zipfile 작성 시 NUL은 잘리므로 정상 이름을 바이트 수준에서 바꾼다.
                    raw = document({**PARTS, 'evilname': b'x'}).replace(b'evilname', b'evil\x00ame')
                self.rejected(raw, 'FILE_STRUCTURE_INVALID')
    def test_09_encrypted(self):
        raw = bytearray(RAW)
        pos = raw.index(b'PK\x01\x02')
        struct.pack_into('<H', raw, pos + 8, struct.unpack_from('<H', raw, pos + 8)[0] | 1)
        self.rejected(raw, 'FILE_ENCRYPTED')
    def test_10_expansion_limit(self):
        raw = bytearray(RAW)
        pos = raw.index(b'PK\x01\x02')
        struct.pack_into('<I', raw, pos + 24, basic.LIMITS['maxEntryBytes'] + 1)
        self.rejected(raw, 'FILE_STRUCTURE_LIMIT')
    def test_11_entry_limit(self):
        with patch.dict(basic.LIMITS, {'maxEntries': 3}):
            self.rejected(RAW, 'FILE_STRUCTURE_LIMIT')
    def test_12_total_expansion_limit(self):
        with patch.dict(basic.LIMITS, {'maxExpandedBytes': 5}):
            self.rejected(RAW, 'FILE_STRUCTURE_LIMIT')
    def test_13_corrupt_mimetype(self):
        raw = document(compression=zipfile.ZIP_STORED).replace(b'application/hwp+zip', b'application/hwp+zim')
        self.rejected(raw, 'FILE_STRUCTURE_INVALID')
    def test_14_unsupported_compression(self):
        self.rejected(document(compression=zipfile.ZIP_BZIP2), 'FILE_STRUCTURE_UNSUPPORTED')
    def test_15_symlink(self):
        stream = io.BytesIO(RAW)
        with zipfile.ZipFile(stream, 'a') as archive:
            info = zipfile.ZipInfo('link')
            info.create_system = 3
            info.external_attr = 0o120777 << 16
            archive.writestr(info, b'Contents/section0.xml')
        self.rejected(stream.getvalue(), 'FILE_STRUCTURE_INVALID')
    def test_16_empty_part(self):
        self.rejected(document({**PARTS, 'Contents/section0.xml': b''}), 'FILE_HWPX_REQUIRED_PART')

    def test_17_corrupt_compressed_mimetype(self):
        raw = bytearray(RAW)
        name_length, extra_length = struct.unpack_from('<HH', raw, 26)
        offset = 30 + name_length + extra_length
        raw[offset] = 255
        self.rejected(raw, 'FILE_STRUCTURE_INVALID')


class PipelineTests(unittest.TestCase):
    def failure(self, client, code):
        with self.assertRaises(basic.CheckError) as error:
            basic.check_file(PAYLOAD, TOKEN, client)
        self.assertEqual(error.exception.code, code)
    def test_01_full_flow(self):
        client = Client()
        result = basic.check_file(PAYLOAD, TOKEN, client)
        self.assertEqual(result['data'], {'fileId': FILE, 'state': 'ready', 'file': REF})
        self.assertEqual(client.authorization, TOKEN)
        self.assertEqual(client.calls[0][1]['p_actor_user_id'], USER)
        self.assertEqual(client.calls[1][1]['p_request_key'], PAYLOAD['requestKey'])
        self.assertEqual(client.calls[1][1]['p_storage_object_id'], OBJECT)
        self.assertEqual(client.calls[1][1]['p_lease_token'], 'lease-original-key')
        self.assertEqual(client.calls[1][1]['p_result']['checks'], {'size': True, 'sha256': True, 'hwpx': True})
        self.assertNotIn('leaseToken', json.dumps(result))
        self.assertNotIn('path', result['data'])
    def test_02_cached_ready(self):
        client = Client({'fileId': FILE, 'state': 'ready', 'file': REF})
        self.assertEqual(basic.check_file(PAYLOAD, TOKEN, client)['data']['state'], 'ready')
        self.assertEqual(len(client.calls), 1)
        self.assertFalse(client.downloads)
    def test_03_busy(self):
        for data in ({'fileId': FILE, 'state': 'checking'}, {'fileId': FILE, 'state': 'pending_verification', 'file': None}):
            client = Client(data)
            result = basic.check_file(PAYLOAD, TOKEN, client)
            self.assertEqual(result['data'], {'fileId': FILE, 'state': 'pending_verification', 'file': None})
            self.assertFalse(client.downloads)
    def test_04_wrong_scope(self):
        for changes in ({'path': 'another/' + FILE + '/' + 'a' * 32}, {'fileId': USER}, {'bucket': 'private-other'}, {'storageObjectId': None}):
            client = Client(claim(**changes))
            self.failure(client, 'INVALID_RESPONSE')
            self.assertFalse(client.downloads)
    def test_05_expired_lease(self):
        self.failure(Client(claim(leaseExpiresAt='2020-01-01T00:00:00Z')), 'INVALID_RESPONSE')
    def test_06_policy_smaller(self):
        client = Client(claim(maxFileBytes=1))
        result = basic.check_file(PAYLOAD, TOKEN, client)
        self.assertEqual(result['data']['state'], 'rejected')
        self.assertFalse(client.downloads)
        self.assertEqual(client.calls[1][1]['p_result']['rejectReason'], 'FILE_SIZE_LIMIT')
        self.assertIsNone(client.calls[1][1]['p_result']['sha256'])
    def test_07_hash_mismatch(self):
        client = Client(claim(claimedSha256='f' * 64))
        self.assertEqual(basic.check_file(PAYLOAD, TOKEN, client)['data']['state'], 'rejected')
        self.assertEqual(client.calls[1][1]['p_result']['rejectReason'], 'FILE_HASH_MISMATCH')
    def test_08_size_mismatch(self):
        client = Client(claim(claimedBytes=len(RAW) + 1))
        self.failure(client, 'RESULT_UNKNOWN')
        self.assertEqual(len(client.calls), 1)
    def test_09_invalid_document(self):
        raw = b'PK\x03\x04not-a-zip'
        client = Client(claim(claimedBytes=len(raw), claimedSha256=hashlib.sha256(raw).hexdigest()), raw)
        basic.check_file(PAYLOAD, TOKEN, client)
        self.assertEqual(client.calls[1][1]['p_result']['rejectReason'], 'FILE_STRUCTURE_INVALID')
    def test_10_download_failure_no_finish(self):
        client = Client()
        client.download_error = basic.CheckError('RESULT_UNKNOWN')
        self.failure(client, 'RESULT_UNKNOWN')
        self.assertEqual(len(client.calls), 1)
    def test_11_finish_unknown_retry_same_key(self):
        client = Client()
        client.finish_error = basic.CheckError('RESULT_UNKNOWN')
        self.failure(client, 'RESULT_UNKNOWN')
        first = copy.deepcopy(client.calls[-1])
        client.finish_error = None
        basic.check_file(PAYLOAD, TOKEN, client)
        self.assertEqual(first, client.calls[-1])
    def test_12_finish_scope_mismatch(self):
        client = Client()
        client.finish_envelope = {**envelope({'fileId': FILE, 'state': 'ready', 'file': REF}), 'schoolId': 'other'}
        self.failure(client, 'INVALID_RESPONSE')
    def test_13_finish_wrong_hash(self):
        client = Client()
        client.finish_envelope = envelope({'fileId': FILE, 'state': 'ready', 'file': {**REF, 'sha256': 'a' * 64}})
        self.failure(client, 'INVALID_RESPONSE')
    def test_14_no_auth_no_rpc(self):
        client = Client()
        for token in (None, '', 'Bearer injected\r\nheader'):
            with self.assertRaises(basic.CheckError):
                basic.check_file(PAYLOAD, token, client)
        self.assertFalse(client.calls)
    def test_15_request_cannot_supply_actor_or_path(self):
        for extra in ({'p_actor_user_id': USER}, {'path': 'x'}, {'bucket': 'other'}):
            with self.assertRaises(basic.CheckError):
                basic.check_file({**PAYLOAD, **extra}, TOKEN, Client())
    def test_16_business_codes(self):
        for code in basic.BUSINESS_CODES:
            with self.assertRaises(basic.CheckError) as error:
                basic._envelope({'contractVersion': 1, 'schoolId': SCHOOL, 'memberId': MEMBER, 'error': {'code': code}}, MEMBER)
            self.assertEqual(error.exception.code, code)
    def test_17_duplicate_json(self):
        with self.assertRaises(basic.CheckError):
            basic.parse_json(b'{"fileId":"a","fileId":"b"}')
    def test_18_limit_crossing_rejection(self):
        client = Client()
        client.download_error = basic.FileRejected('FILE_SIZE_LIMIT')
        self.assertEqual(basic.check_file(PAYLOAD, TOKEN, client)['data']['state'], 'rejected')
    def test_19_cached_bad_reference(self):
        self.failure(Client({'fileId': FILE, 'state': 'ready', 'file': {**REF, 'extension': 'pdf'}}), 'INVALID_RESPONSE')


class Response:
    def __init__(self, raw, status=200, headers=None):
        self.body, self.status, self.headers = io.BytesIO(raw), status, headers or {}
    def read1(self, size):
        return self.body.read(size)
    def read(self, size):
        return self.body.read(size)
    def getheader(self, name, default=None):
        return self.headers.get(name, default)


class Connection:
    def __init__(self, response):
        self.response, self.sock, self.closed = response, None, False
    def request(self, method, path, body=None, headers=None):
        self.request_data = (method, path, body, headers)
    def getresponse(self):
        return self.response
    def close(self):
        self.closed = True


class TransportTests(unittest.TestCase):
    def client(self, response, **kwargs):
        connection = Connection(response)
        client = basic.SupabaseClient(ENV, connection_factory=lambda *a, **k: connection, **kwargs)
        return client, connection
    def test_01_auth_uses_user_token(self):
        client, connection = self.client(Response(json.dumps({'id': USER}).encode()))
        self.assertEqual(client.user(TOKEN), USER)
        self.assertEqual(connection.request_data[1], '/auth/v1/user')
        self.assertEqual(connection.request_data[3]['Authorization'], TOKEN)
        self.assertEqual(connection.request_data[3]['apikey'], SECRET)
        self.assertTrue(connection.closed)
    def test_02_service_role_key_not_user_key(self):
        payload = base64.urlsafe_b64encode(json.dumps({'role': 'authenticated', 'sub': USER}).encode()).decode().rstrip('=')
        with self.assertRaises(basic.CheckError):
            basic.SupabaseClient({**ENV, 'SUPABASE_SERVICE_ROLE_KEY': 'aaa.' + payload + '.bbb'})
    def test_03_config_missing_or_bad_host(self):
        for env in ({}, {**ENV, 'SUPABASE_URL': 'http://localhost'}, {**ENV, 'SUPABASE_URL': ENV['SUPABASE_URL'] + '/path'}, {**ENV, 'SUPABASE_URL': 'https://other.example'}, {**ENV, 'VITE_SUPABASE_URL': 'https://other.supabase.co'}):
            with self.assertRaises(basic.CheckError) as error:
                basic.SupabaseClient(env)
            self.assertEqual(error.exception.code, 'NOT_READY')
    def test_04_no_redirect(self):
        client, connection = self.client(Response(b'secret', 302, {'Location': 'https://evil.example'}))
        with self.assertRaises(basic.CheckError):
            client.user(TOKEN)
        self.assertTrue(connection.closed)
    def test_05_untrusted_auth_id(self):
        for value in ({'id': 'not-user'}, {}, []):
            client, _ = self.client(Response(json.dumps(value).encode()))
            with self.assertRaises(basic.CheckError):
                client.user(TOKEN)
    def test_06_rpc_missing(self):
        client, _ = self.client(Response(b'detailed postgres error', 404))
        with self.assertRaises(basic.CheckError) as error:
            client.rpc('workhub_file_basic_claim', {})
        self.assertEqual(error.exception.code, 'NOT_READY')
    def test_07_stream_cap_without_content_length(self):
        client, connection = self.client(Response(b'123456789'))
        with self.assertRaises(basic.FileRejected):
            client.download(basic.BUCKET, 'a/b/c', 8)
        self.assertTrue(connection.closed)
    def test_08_content_length_cap(self):
        client, _ = self.client(Response(b'', headers={'Content-Length': '9'}))
        with self.assertRaises(basic.FileRejected):
            client.download(basic.BUCKET, 'a/b/c', 8)
    def test_09_incomplete_transfer(self):
        client, _ = self.client(Response(b'123', headers={'Content-Length': '4'}))
        with self.assertRaises(basic.CheckError) as error:
            client.download(basic.BUCKET, 'a/b/c', 8)
        self.assertEqual(error.exception.code, 'RESULT_UNKNOWN')
    def test_10_compressed_transport_refused(self):
        client, _ = self.client(Response(b'abc', headers={'Content-Encoding': 'gzip'}))
        with self.assertRaises(basic.CheckError):
            client.download(basic.BUCKET, 'a/b/c', 8)
    def test_11_whole_request_deadline(self):
        clock = iter((0, 46))
        client, _ = self.client(Response(b'{}'), clock=lambda: next(clock))
        with self.assertRaises(basic.CheckError) as error:
            client.user(TOKEN)
        self.assertEqual(error.exception.code, 'RESULT_UNKNOWN')
    def test_12_download_only_fixed_host(self):
        client, connection = self.client(Response(RAW))
        self.assertEqual(client.download(basic.BUCKET, claim()['path'], 100000), RAW)
        self.assertTrue(connection.request_data[1].startswith('/storage/v1/object/authenticated/workhub-collection-files/'))
    def test_13_auth_denied(self):
        client, _ = self.client(Response(b'sensitive', 401))
        with self.assertRaises(basic.CheckError) as error:
            client.user(TOKEN)
        self.assertEqual(error.exception.code, 'UNAUTHENTICATED')
    def test_14_existing_url_fallback(self):
        env = {'VITE_SUPABASE_URL': ENV['SUPABASE_URL'], 'SUPABASE_SERVICE_ROLE_KEY': SECRET}
        self.assertEqual(basic.SupabaseClient(env).host, 'a' * 20 + '.supabase.co')


class ReviewRegressionTests(unittest.TestCase):
    client = TransportTests.client
    def test_service_denial_preserves_work(self):
        for status in (401, 403):
            for path in ('/rest/v1/rpc/workhub_file_basic_claim', '/storage/v1/object/authenticated/x'):
                client, connection = self.client(Response(b'private-trace', status))
                with self.assertRaises(basic.CheckError) as caught:
                    client._request('POST', path)
                self.assertEqual((caught.exception.code, caught.exception.status), ('NOT_READY', 503))
                self.assertTrue(connection.closed)
    def test_postgrest_gate_errors_only_allowlisted(self):
        for code in ('FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'private-trace'):
            client, _ = self.client(Response(json.dumps({'code':'P0001','message':code,'details':'secret'}).encode(), 400))
            with self.assertRaises(basic.CheckError) as caught:
                client.rpc('workhub_file_basic_claim', {})
            self.assertEqual(caught.exception.code, code if code != 'private-trace' else 'RESULT_UNKNOWN')
            self.assertNotIn('secret', str(caught.exception))
    def test_object_id_rejected_before_download(self):
        client = Client(claim(storageObjectId='not-a-uuid'))
        with self.assertRaises(basic.CheckError) as caught:
            basic.check_file(PAYLOAD, TOKEN, client)
        self.assertEqual(caught.exception.code, 'INVALID_RESPONSE')
        self.assertFalse(client.downloads)
    def test_entry_count_rejected_before_zip_construction(self):
        raw=bytearray(RAW)
        end=raw.rfind(b'PK\x05\x06')
        struct.pack_into('<HH',raw,end+8,50000,50000)
        with patch.object(basic.zipfile, 'ZipFile', side_effect=AssertionError('must not parse entries')):
            with self.assertRaises(basic.FileRejected) as caught:
                basic.inspect_hwpx(bytes(raw))
        self.assertEqual(caught.exception.code, 'FILE_STRUCTURE_LIMIT')


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(('127.0.0.1', 0), endpoint.handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
    def request(self, body=None, headers=None, method='POST'):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            connection.request(method, '/api/collections/check-hwpx', body=body, headers=headers or {'Content-Type': 'application/json', 'Authorization': TOKEN})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()
    def test_01_actual_handler_success(self):
        with patch.object(endpoint, 'check_file', side_effect=lambda payload, auth: basic.check_file(payload, auth, Client())):
            status, headers, raw = self.request(json.dumps(PAYLOAD))
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(json.loads(raw)['data']['state'], 'ready')
    def test_02_handler_does_not_leak_exception(self):
        with patch.object(endpoint, 'check_file', side_effect=RuntimeError('service-secret-sensitive-path')):
            status, _, raw = self.request(json.dumps(PAYLOAD))
        self.assertEqual(status, 503)
        self.assertNotIn(b'secret', raw)
        self.assertEqual(json.loads(raw), {'error': {'code': 'RESULT_UNKNOWN'}})
    def test_03_duplicate_json_refused(self):
        self.assertEqual(self.request('{"memberId":"a","memberId":"b"}')[0], 400)
    def test_04_non_json_refused(self):
        self.assertEqual(self.request('{}', {'Content-Type': 'text/plain'})[0], 415)
    def test_05_oversized_refused(self):
        # 본문을 보내는 중 서버가 먼저 413으로 닫으면 Windows TCP가 응답 대신 RST를 낼 수 있다.
        # 길이 헤더만 보내 본문 수신 전 거절을 검사한다. 연결 오류를 성공으로 취급하지 않는다.
        headers = {'Content-Type': 'application/json', 'Authorization': TOKEN,
                   'Content-Length': str(basic.REQUEST_LIMIT + 1)}
        with patch.object(endpoint, 'check_file') as checker:
            self.assertEqual(self.request(headers=headers)[0], 413)
            checker.assert_not_called()
    def test_06_get_refused(self):
        status, headers, _ = self.request(method='GET')
        self.assertEqual(status, 405)
        self.assertEqual(headers['Allow'], 'POST')
    def test_07_no_authorization(self):
        with patch.dict('os.environ', {}, clear=True):
            status, _, raw = self.request(json.dumps(PAYLOAD), {'Content-Type': 'application/json'})
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(raw)['error']['code'], 'UNAUTHENTICATED')
    def test_08_missing_env_closed(self):
        with patch.dict('os.environ', {}, clear=True):
            status, _, raw = self.request(json.dumps(PAYLOAD))
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(raw)['error']['code'], 'NOT_READY')


class Result(unittest.TextTestResult):
    def addSuccess(self, test):
        super().addSuccess(test)
        print('  ✓ ' + test.id().split('.')[-2] + '.' + test.id().split('.')[-1])
    def addFailure(self, test, err):
        super().addFailure(test, err)
        print('  ✗ ' + test.id())
    def addError(self, test, err):
        super().addError(test, err)
        print('  ✗ ' + test.id())


if __name__ == '__main__':
    unittest.main(testRunner=unittest.TextTestRunner(resultclass=Result, verbosity=0))
