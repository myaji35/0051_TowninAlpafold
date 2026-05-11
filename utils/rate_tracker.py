"""utils/rate_tracker.py
API rate limit 추적 — 시간/일 카운터 + 80% throttle.

사용:
    from utils.rate_tracker import RateTracker
    rt = RateTracker("kosis_living_pop", daily_limit=5000, hourly_limit=500)
    if rt.should_throttle():
        return  # 다음 cron 도래까지 보류
    rt.record_call()
    response = api.get(...)
"""
import json
import datetime
from pathlib import Path

TRACK_DIR = Path("data_raw/_progress/rate_tracking")
TRACK_DIR.mkdir(parents=True, exist_ok=True)


class RateTracker:
    def __init__(self, dataset_key: str, daily_limit: int = 0, hourly_limit: int = 0,
                 throttle_pct: float = 0.80):
        self.key = dataset_key
        self.daily_limit = daily_limit
        self.hourly_limit = hourly_limit
        self.throttle_pct = throttle_pct
        self.path = TRACK_DIR / f"{dataset_key}.json"
        self._load()

    def _load(self):
        if self.path.exists():
            try:
                self.state = json.loads(self.path.read_text())
            except Exception:
                self.state = self._empty()
        else:
            self.state = self._empty()

    def _empty(self):
        return {"hourly": {}, "daily": {}}

    def _now_keys(self):
        now = datetime.datetime.now()
        return now.strftime("%Y-%m-%d %H"), now.strftime("%Y-%m-%d")

    def record_call(self, count: int = 1):
        h, d = self._now_keys()
        self.state["hourly"][h] = self.state["hourly"].get(h, 0) + count
        self.state["daily"][d] = self.state["daily"].get(d, 0) + count
        # 7일 이전 hourly 정리
        cutoff = datetime.datetime.now() - datetime.timedelta(days=7)
        cutoff_h = cutoff.strftime("%Y-%m-%d %H")
        self.state["hourly"] = {k: v for k, v in self.state["hourly"].items() if k >= cutoff_h}
        self.state["daily"] = {k: v for k, v in self.state["daily"].items()
                               if k >= cutoff.strftime("%Y-%m-%d")}
        self.path.write_text(json.dumps(self.state, indent=2))

    def current_usage(self):
        h, d = self._now_keys()
        return {
            "hourly": self.state["hourly"].get(h, 0),
            "daily": self.state["daily"].get(d, 0),
            "hourly_limit": self.hourly_limit,
            "daily_limit": self.daily_limit,
            "hourly_pct": (self.state["hourly"].get(h, 0) / self.hourly_limit * 100)
                          if self.hourly_limit else 0,
            "daily_pct": (self.state["daily"].get(d, 0) / self.daily_limit * 100)
                         if self.daily_limit else 0,
        }

    def should_throttle(self) -> bool:
        u = self.current_usage()
        if self.daily_limit and u["daily_pct"] >= self.throttle_pct * 100:
            return True
        if self.hourly_limit and u["hourly_pct"] >= self.throttle_pct * 100:
            return True
        return False
