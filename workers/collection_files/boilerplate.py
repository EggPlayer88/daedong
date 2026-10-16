"""한컴 기본 스크립트 중 동작 본문이 없는 좁은 문법만 분류한다.

일반 JavaScript 파서/실행기가 아니다. 주석을 지우거나 토큰을 변환하지 않고
전체 입력을 대조한다. 경로·인코딩·패키지 참조 검사는 호출자가 별도로 한다.
"""
import re


_WS = r"[ \t\r\n]*"
_HEADER = re.compile(
    _WS + r"var[ \t\r\n]+Documents" + _WS + "=" + _WS + r"XHwpDocuments" + _WS + ";" + _WS
    + r"var[ \t\r\n]+Document" + _WS + "=" + _WS + r"Documents" + _WS + r"\." + _WS
    + r"Active_XHwpDocument" + _WS + ";" + _WS
)
_SOURCE = re.compile(
    _WS + r"function[ \t\r\n]+OnDocument_New" + _WS + r"\(" + _WS + r"\)" + _WS
    + r"\{" + _WS + r"(?://todo[ \t]*:[ \t]*(?:\r\n|\r|\n))?" + _WS + r"\}" + _WS
)


def is_empty_hancom_script(text: str, role: str) -> bool:
    """빈 값, 기본 별칭 선언 또는 빈 문서 생성 훅만 허용한다.

header 역할의 두 별칭 선언은 한컴 기본 내용과의 호환 범위이며 일반 명령문
허용이 아니다. 다른 훅·주석·이스케이프·호출·표현식은 모두 거부한다.
"""
    if not isinstance(text, str) or role not in ("header", "source") or len(text) > 2048:
        return False
    if re.fullmatch(_WS, text) is not None:
        return True
    return (_HEADER if role == "header" else _SOURCE).fullmatch(text) is not None
