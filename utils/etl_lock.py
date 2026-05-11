"""utils/etl_lock.py
ETL 동시 실행 차단 — fcntl exclusive lockfile per dataset.
사용:
    from utils.etl_lock import acquire_lock, release_lock
    with acquire_lock("kosis_living_pop") as lock:
        # ETL 작업
        ...
"""
import fcntl
import os
import contextlib
from pathlib import Path

LOCK_DIR = Path(os.environ.get("ETL_LOCK_DIR", "/tmp/towninalpafold-etl-locks"))
LOCK_DIR.mkdir(parents=True, exist_ok=True)


class LockBusyError(Exception):
    """이미 다른 프로세스가 같은 데이터셋을 실행 중."""
    pass


@contextlib.contextmanager
def acquire_lock(dataset_key: str, timeout_sec: int = 0):
    """exclusive lock 획득. timeout_sec=0 이면 즉시 실패, >0 이면 대기."""
    lock_path = LOCK_DIR / f"{dataset_key}.lock"
    fp = open(lock_path, "w")
    acquired = False
    try:
        if timeout_sec == 0:
            try:
                fcntl.flock(fp, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise LockBusyError(f"이미 실행 중: {dataset_key}")
        else:
            fcntl.flock(fp, fcntl.LOCK_EX)  # 대기 (signal 처리 OS 의존)
        acquired = True
        fp.write(f"{os.getpid()}\n")
        fp.flush()
        yield fp
    finally:
        if acquired and not fp.closed:
            try:
                fcntl.flock(fp, fcntl.LOCK_UN)
            except Exception:
                pass
        if not fp.closed:
            fp.close()
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass
