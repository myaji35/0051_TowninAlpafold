"""tests/conftest.py
pytest 공통 픽스처 — 프로젝트 루트를 sys.path에 추가.
"""
import sys
from pathlib import Path

# 프로젝트 루트 (tests/ 의 부모) 를 import 경로에 삽입
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
