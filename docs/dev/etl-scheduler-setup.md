# ETL Scheduler 배포 가이드

`etl_scheduler.py`는 `datasets.json`을 순회하며 도래한 cron을 실행하는 경량 스케줄러다.
OS crontab 또는 systemd timer가 매시간 이 스크립트를 호출하는 방식으로 배포한다.

---

## 1. 환경 변수 (.env.scheduler)

프로젝트 루트에 `.env.scheduler` 파일을 만든다 (git 추적 제외).

```bash
# .env.scheduler
KOSIS_API_KEY=YOUR_KOSIS_KEY_HERE
LOCALDATA_API_KEY=YOUR_LOCALDATA_KEY_HERE
NTS_API_KEY=YOUR_NTS_KEY_HERE
MOLIT_API_KEY=YOUR_MOLIT_KEY_HERE
VWORLD_API_KEY=YOUR_VWORLD_KEY_HERE

# 선택 — 잠금 파일 디렉터리 (기본: /tmp/towninalpafold-etl-locks)
# ETL_LOCK_DIR=/var/run/towninalpafold/locks
```

crontab/systemd 실행 시 이 파일을 source 한다 (아래 예시 참조).

---

## 2. crontab 등록 (Vultr VPS / Mac)

```bash
# crontab -e 로 편집
# 매시간 정각 실행
0 * * * * bash -c 'set -a; source /opt/towninalpafold/.env.scheduler; set +a; cd /opt/towninalpafold && python3 etl_scheduler.py' >> /opt/towninalpafold/logs/scheduler.log 2>&1
```

Mac 로컬 개발 환경:
```bash
0 * * * * bash -c 'set -a; source /Users/YOU/projects/TowninAlpafold/.env.scheduler; set +a; cd /Users/YOU/projects/TowninAlpafold && python3 etl_scheduler.py' >> /tmp/towninalpafold-scheduler.log 2>&1
```

로그 확인:
```bash
tail -f /opt/towninalpafold/logs/scheduler.log
```

---

## 3. systemd timer 등록 (Vultr 권장)

### 3-1. 서비스 파일
`/etc/systemd/system/towninalpafold-etl.service`
```ini
[Unit]
Description=TowninAlpafold ETL Scheduler
After=network.target

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/opt/towninalpafold
EnvironmentFile=/opt/towninalpafold/.env.scheduler
ExecStart=/usr/bin/python3 /opt/towninalpafold/etl_scheduler.py
StandardOutput=append:/opt/towninalpafold/logs/scheduler.log
StandardError=append:/opt/towninalpafold/logs/scheduler.log
```

### 3-2. 타이머 파일
`/etc/systemd/system/towninalpafold-etl.timer`
```ini
[Unit]
Description=TowninAlpafold ETL Scheduler — 매시간 실행

[Timer]
OnCalendar=*-*-* *:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

### 3-3. 활성화
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now towninalpafold-etl.timer
# 상태 확인
sudo systemctl list-timers towninalpafold-etl.timer
```

---

## 4. 로그 위치 및 형식

| 환경 | 로그 경로 |
|------|---------|
| Vultr | `/opt/towninalpafold/logs/scheduler.log` |
| Mac 로컬 | `/tmp/towninalpafold-scheduler.log` |

스케줄러는 실행 시 JSON을 stdout에 출력한다:
```json
{
  "executed": 1,
  "results": [
    {"key": "kosis_living_pop", "status": "success", "output": "data_raw/...", "marker": "real"}
  ]
}
```

도래한 ETL 없을 때:
```json
{"executed": 0, "message": "도래한 ETL 없음"}
```

---

## 5. alert_on_failure 동작

`datasets.json`의 `ops.alert_on_failure: true`인 항목이 `failure` 상태가 되면
`schedule.consecutive_failures` 카운터가 증가한다.

- 3회 연속 실패 → `schedule.frequency`가 자동으로 `"blocked"`로 변경 (안전장치)
- blocked 항목은 `--force` 없이는 실행되지 않는다
- 알림 발송 로직은 향후 `ops/alert.py`에서 구현 예정 (현재는 로그만)

---

## 6. 수동 일시 정지 절차

특정 데이터셋을 일시 중단하려면 `datasets.json`을 직접 편집한다:

```bash
# 예: molit_landprice를 일시 정지
# data_raw/_registry/datasets.json 열기
# "key": "molit_landprice" → "schedule" → "frequency": "blocked" 으로 변경
```

재개하려면 `frequency`를 원래 값(`monthly`, `quarterly` 등)으로 되돌리고
`consecutive_failures`를 `0`으로 리셋한다.

---

## 7. 수동 실행 / 디버그

```bash
# 도래한 ETL 목록 확인
python3 etl_scheduler.py --list

# 특정 ETL 강제 실행 (dry-run)
python3 etl_scheduler.py --force kosis_living_pop --dry-run

# 실 실행 (API 키 필요)
source .env.scheduler
python3 etl_scheduler.py --force kosis_living_pop

# 모든 도래 ETL을 dry-run으로
python3 etl_scheduler.py --dry-run
```

---

## 8. 새 ETL 모듈 연결

1. `etl/<key>.py`에 `run(dry_run: bool) -> dict` 구현
2. `etl_scheduler.py`의 `ETL_MODULE_MAP`에 항목 추가:
   ```python
   ETL_MODULE_MAP = {
       "kosis_living_pop": "etl.kosis_living_pop",
       "localdata_biz": "etl.localdata_biz",  # 추가
   }
   ```
3. `datasets.json`에서 해당 key의 `schedule.last_run_status`를 `"pending"`으로 초기화
