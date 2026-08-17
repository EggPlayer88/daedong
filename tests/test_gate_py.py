#!/usr/bin/env python3
"""generate/extract 의 D20 게이트 — urlopen 을 가로채 승인 여부만 바꿔 본다."""
import importlib.util, io, json, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
import os
os.environ["VITE_SUPABASE_URL"] = "https://fake.supabase.co"
os.environ["VITE_SUPABASE_ANON_KEY"] = "anon"

mods = {}
for name in ("generate", "extract"):
    spec = importlib.util.spec_from_file_location(f"m_{name}", API/f"{name}.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); mods[name] = m

FAIL = []
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")

class FakeResp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False

def patch(is_active=None, missing=False):
    calls = []
    def fake_urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        calls.append(url)
        if "/auth/v1/user" in url:
            return FakeResp(json.dumps({"id": "uid-1", "email": "t@x.com"}).encode())
        if "/rest/v1/users" in url:
            rows = [] if missing else [{"is_active": is_active}]
            return FakeResp(json.dumps(rows).encode())
        raise AssertionError("예상치 못한 호출: " + url)
    urllib.request.urlopen = fake_urlopen
    return calls

for name, m in mods.items():
    print(f"\n[{name}.py]")
    calls = patch(is_active=False)
    check("미승인 → is_approved False", lambda m=m: (_ for _ in ()).throw(AssertionError("승인으로 판정"))
          if m.is_approved("Bearer tok", "uid-1") else None)
    patch(missing=True)
    check("행 없음 → 대기로 판정", lambda m=m: (_ for _ in ()).throw(AssertionError("승인으로 판정"))
          if m.is_approved("Bearer tok", "uid-1") else None)
    patch(is_active=True)
    check("승인 → True", lambda m=m: (_ for _ in ()).throw(AssertionError("대기로 판정"))
          if not m.is_approved("Bearer tok", "uid-1") else None)
    check("user_id 없으면 대기", lambda m=m: (_ for _ in ()).throw(AssertionError("승인으로 판정"))
          if m.is_approved("Bearer tok", "") else None)
    # 네트워크 실패 시 안전한 쪽
    def boom(req, timeout=None): raise urllib.error.URLError("down")
    urllib.request.urlopen = boom
    check("조회 실패 시 대기로 판정", lambda m=m: (_ for _ in ()).throw(AssertionError("승인으로 판정"))
          if m.is_approved("Bearer tok", "uid-1") else None)

print("\n[게이트가 핸들러에 연결됐는지]")
for name, m in mods.items():
    src = (API/f"{name}.py").read_text()
    check(f"{name}: 401 직후 is_approved 호출", lambda src=src: (_ for _ in ()).throw(AssertionError("게이트 없음"))
          if 'if not is_approved(self.headers.get("Authorization"), user.get("id")):' not in src else None)
    check(f"{name}: 403 PENDING_APPROVAL 반환", lambda src=src: (_ for _ in ()).throw(AssertionError("응답 없음"))
          if '"error": "PENDING_APPROVAL"' not in src else None)

print()
if FAIL: print(f"{len(FAIL)}건 실패: {', '.join(FAIL)}"); sys.exit(1)
print("전부 통과")
