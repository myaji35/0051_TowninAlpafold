"""tests/test_pdf_render.py
PDF 렌더 회귀 테스트 — 스켈레톤.

PDF 엔진(wkhtmltopdf / weasyprint)과 백엔드 /pdf 엔드포인트가
확정되면 아래 skip marker를 제거하고 활성화한다.
추적 이슈: ISS-PDF_ENGINE

활성화 체크리스트:
  [ ] backend/main.py 에 GET /api/report/{id}/pdf 엔드포인트 추가
  [ ] PDF 엔진(wkhtmltopdf or weasyprint) requirements.txt 반영
  [ ] SKIP_PDF_TESTS 환경변수 제거 또는 조건 변경
"""
import pytest


@pytest.mark.skip(reason="PDF endpoint pending: ISS-PDF_ENGINE 결정 후 활성화")
def test_pdf_endpoint_returns_200():
    """백엔드 /api/report/{id}/pdf 가 200 + application/pdf 를 반환하는지 확인."""
    import httpx  # 활성화 시 requirements에 추가

    r = httpx.get("http://localhost:8000/api/report/1/pdf", timeout=10)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"


@pytest.mark.skip(reason="PDF endpoint pending: ISS-PDF_ENGINE 결정 후 활성화")
def test_pdf_content_not_empty():
    """PDF 바이트 크기가 1 KB 이상인지 확인 (비어 있는 렌더 방지)."""
    import httpx

    r = httpx.get("http://localhost:8000/api/report/1/pdf", timeout=10)
    assert len(r.content) > 1024, "PDF 파일이 너무 작음 (렌더 실패 의심)"


@pytest.mark.skip(reason="PDF endpoint pending: ISS-PDF_ENGINE 결정 후 활성화")
def test_pdf_regression_byte_size():
    """이전 렌더 대비 ±20% 이내인지 회귀 체크."""
    import httpx

    baseline_bytes = 45_000  # 엔진 확정 후 실측값으로 교체
    r = httpx.get("http://localhost:8000/api/report/1/pdf", timeout=10)
    ratio = abs(len(r.content) - baseline_bytes) / baseline_bytes
    assert ratio < 0.20, f"PDF 크기 회귀: baseline={baseline_bytes}, actual={len(r.content)}"
