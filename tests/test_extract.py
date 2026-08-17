import base64, importlib.util, zipfile, io, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("ext", API/"extract.py")
ext = importlib.util.module_from_spec(spec); spec.loader.exec_module(ext)

FAIL=[]
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")

NS = ('xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
      'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"')

def para(t): return f"<hp:p><hp:run><hp:t>{t}</hp:t></hp:run></hp:p>"

def cell(t): return f"<hp:tc><hp:subList>{para(t)}</hp:subList></hp:tc>"

def make(paras, table_rows=None, name="ref.hwpx"):
    body = "".join(para(p) for p in paras)
    if table_rows:
        rows = "".join("<hp:tr>" + "".join(cell(c) for c in r) + "</hp:tr>" for r in table_rows)
        body += f"<hp:p><hp:run><hp:tbl>{rows}</hp:tbl></hp:run></hp:p>"
    sec = f'<?xml version="1.0" encoding="UTF-8"?><hs:sec {NS}>{body}</hs:sec>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        zi = zipfile.ZipInfo("mimetype"); zi.compress_type = zipfile.ZIP_STORED
        z.writestr(zi, "application/hwp+zip")
        z.writestr("Contents/section0.xml", sec)
    return buf.getvalue()

print("\n[1] 정상 추출")
raw = make(["2026학년도 1학기 과학 평가계획서", "Ⅰ. 물질의 구성"],
           [["영역","만점","시기"],["실험 보고서","20점","10월"]])
res = {}
def t_ok():
    r = ext.extract_payload({"filename":"과학.hwpx","base64":base64.b64encode(raw).decode()})
    res.update(r)
    assert "2026학년도 1학기 과학 평가계획서" in r["text"], r["text"][:200]
def t_table():
    assert "| 영역 | 만점 | 시기 |" in res["text"], res["text"]
    assert "실험 보고서" in res["text"]
def t_meta():
    assert res["filename"] == "과학.hwpx" and res["chars"] > 0 and res["truncated"] is False, res
check("본문 문단 추출", t_ok)
check("표를 마크다운으로 변환", t_table)
check("메타(파일명/글자수/truncated)", t_meta)

print("\n[2] 거부 케이스")
def bad(payload, needle):
    try: ext.extract_payload(payload)
    except ext.BadRequest as e:
        assert needle in str(e), f"메시지: {e}"; return
    raise AssertionError("거부되지 않음")
check("base64 없음", lambda: bad({"filename":"a"}, "base64"))
check("base64 깨짐", lambda: bad({"base64":"!!!not-b64!!!"}, "해석"))
check("hwpx 아님(PK 아님)", lambda: bad({"base64":base64.b64encode(b"hello world").decode()}, "hwpx 파일이 아닙니다"))
check("압축 깨짐", lambda: bad({"base64":base64.b64encode(b"PK\x03\x04garbage").decode()}, "압축이 깨진"))
check("본문 없음", lambda: bad({"base64":base64.b64encode(make([])).decode()}, "찾지 못했습니다"))
def t_toobig():
    big = b"PK" + b"\x00" * (ext.MAX_FILE_BYTES + 10)
    bad({"base64": base64.b64encode(big).decode()}, "너무 큽니다")
check("용량 초과", t_toobig)

print("\n[3] 길이 상한")
def t_trunc():
    long_paras = [f"문단 {i} " + "가"*300 for i in range(120)]
    r = ext.extract_payload({"filename":"long.hwpx","base64":base64.b64encode(make(long_paras)).decode()})
    assert r["truncated"] is True, "잘리지 않음"
    assert r["chars"] <= ext.MAX_TEXT_CHARS + 60, r["chars"]
    assert "이하 생략" in r["text"], "생략 안내 없음"
check(f"{ext.MAX_TEXT_CHARS:,}자 초과 시 잘라내고 안내", t_trunc)

print("\n[4] 대화 삽입 형식 + chat 상한 정합성")
def t_fits():
    msg = f"[참고자료: {res['filename']}]\n{res['text']}"
    assert msg.startswith("[참고자료: 과학.hwpx]\n"), msg[:40]
    # chat.js MAX_TOTAL_CHARS = 80000 — 최대 크기 참고자료 2개까지는 들어가야 한다
    assert ext.MAX_TEXT_CHARS * 2 < 80000, "참고자료 2개도 못 들어감"
check("[참고자료: 파일명] 형식 + chat 상한 안에 들어감", t_fits)

print()
if FAIL: print(f"{len(FAIL)}건 실패: {', '.join(FAIL)}"); sys.exit(1)
print("전부 통과")
