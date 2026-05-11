"""utils/etl_retry.py
ETL 재시도 정책 — exponential backoff.
@with_retry 데코레이터로 ETL 함수 감싸기.

사용:
    from utils.etl_retry import with_retry, RetryExhausted
    @with_retry(max_attempts=4, backoff_seconds=[300, 900, 3600])
    def fetch_kosis_data(): ...
"""
import time
import functools
from typing import Callable, List, Optional


class RetryExhausted(Exception):
    """모든 재시도 실패."""
    pass


DEFAULT_BACKOFF = [300, 900, 3600]  # 5min, 15min, 1h


def with_retry(max_attempts: int = 4, backoff_seconds: Optional[List[int]] = None,
               retry_on: tuple = (Exception,), on_retry: Optional[Callable] = None,
               on_exhausted: Optional[Callable] = None):
    """exponential backoff retry decorator.

    Args:
        max_attempts: 첫 시도 포함 총 시도 횟수 (4 = 첫 시도 + 3 재시도)
        backoff_seconds: 재시도 사이 대기 (None 이면 DEFAULT_BACKOFF)
        retry_on: 재시도할 예외 튜플
        on_retry(attempt, exc): 재시도 직전 콜백 (로그용)
        on_exhausted(exc): 모든 재시도 실패 시 콜백 (consecutive_failures += 1)
    """
    backoffs = backoff_seconds or DEFAULT_BACKOFF

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except retry_on as e:
                    last_exc = e
                    if attempt >= max_attempts:
                        if on_exhausted:
                            on_exhausted(e)
                        raise RetryExhausted(
                            f"{fn.__name__}: {max_attempts}회 시도 실패 — {e}"
                        ) from e
                    wait = backoffs[min(attempt - 1, len(backoffs) - 1)]
                    if on_retry:
                        on_retry(attempt, e)
                    time.sleep(wait)
            raise RetryExhausted(f"{fn.__name__}: 시도 횟수 0 — 코드 오류") from last_exc
        return wrapper
    return decorator
