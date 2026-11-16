"""최신 전체 기준 위의 TR2 회귀 진입점. 운영 DSN·임의 인자를 받지 않는다."""
from pathlib import Path
import sys,importlib.util
if len(sys.argv)!=1:raise SystemExit('실행 인자를 받지 않습니다.')
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('tr2_full_suite',root/'build_checks.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.I.H.main()
