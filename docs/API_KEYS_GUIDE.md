# 카카오 + SGIS Plus API 키 발급 가이드

> 대표님이 직접 1회 진행 — 약 30분 소요
> 발급된 키는 `.env` 파일에 저장하면 ETL 스크립트가 자동 사용

---

## 1️⃣ 카카오 로컬 API (10분)

### 절차
1. **카카오 개발자 콘솔 가입**
   - URL: https://developers.kakao.com/
   - 우상단 "로그인" → 카카오 계정으로 로그인
   - 약관 동의

2. **애플리케이션 추가**
   - 상단 "내 애플리케이션" → "애플리케이션 추가하기"
   - 앱 이름: `TowninGraph` (자유)
   - 사업자명: `Gagahoho` (자유)
   - 카테고리: `유틸리티`

3. **REST API 키 확인**
   - 생성된 앱 클릭 → 좌측 메뉴 "앱 키"
   - **REST API 키** 복사 (32자 영숫자) ← 이게 필요

4. **플랫폼 등록 (선택, Web 호출 시 필요)**
   - 좌측 "플랫폼" → "Web 플랫폼 등록"
   - 사이트 도메인: `http://localhost` (개발용)
   - **Server-side 호출만 할 거면 이 단계 SKIP 가능**

### 한도
- **일 30만 호출** (무료)
- 초과 시 자동 차단 (요금 부과 X)

### 발급 결과
```
KAKAO_REST_API_KEY=abc1234567890...  (32자)
```

---

## 2️⃣ SGIS Plus API (20분)

### 절차
1. **SGIS Plus 가입**
   - URL: https://sgis.kostat.go.kr/developer/
   - 우상단 "회원가입" → 이메일 인증
   - 본인인증 (휴대폰 또는 i-PIN)

2. **서비스 신청**
   - 상단 "서비스 신청"
   - 서비스 종류:
     - ✅ **인구통계** (행정동 인구·세대)
     - ✅ **행정구역경계** (폴리곤)
     - ✅ **사업체통계** (소상공인)
   - 신청 사유: `학술 연구 및 분석 도구 개발` 정도 (한 줄)
   - 신청 → 즉시 승인 (대부분)

3. **인증 키 확인**
   - 상단 "마이페이지" → "서비스 신청 내역"
   - 승인된 서비스의 **Consumer Key** + **Consumer Secret** 복사
   - **둘 다 필요** (OAuth 2.0)

### 한도
- **무료** (공공데이터)
- 일 5,000회 (충분)

### 발급 결과
```
SGIS_CONSUMER_KEY=abc123...        (20자 정도)
SGIS_CONSUMER_SECRET=xyz789...     (40자 정도)
```

---

## 3️⃣ .env 파일 작성

발급 완료 후 `towningraph_mvp_demo/.env` 파일 생성:

```bash
# ~/Documents/.../AlpaFolder/towningraph_mvp_demo/.env

# 카카오 로컬 API
KAKAO_REST_API_KEY=실제_발급된_키_붙여넣기

# SGIS Plus API
SGIS_CONSUMER_KEY=실제_발급된_키
SGIS_CONSUMER_SECRET=실제_발급된_시크릿
```

### 보안
- `.env`는 자동으로 `.gitignore`에 추가됨 (작업 시 자동 처리)
- 키 노출 금지 — Slack/이메일/스크린샷 시 주의

---

## 4️⃣ 발급 완료 후 다음 단계

대표님께서 **"키 발급 완료"** 또는 **".env 작성 완료"** 라고 알려주시면:
1. ETL 스크립트가 자동으로 키 인식
2. SGIS에서 서울 25구 폴리곤 수집 (Day 2)
3. 카카오 로컬 API로 POI 수집 (Day 3)

---

## 🚨 문제 발생 시

### 카카오
- "REST API 키가 안 보여요" → 좌측 "앱 키" 메뉴 클릭
- "401 Unauthorized" → 헤더 형식 확인: `Authorization: KakaoAK {key}` (KakaoAK 띄어쓰기 1번)

### SGIS
- "본인인증 안 돼요" → 휴대폰 번호 + 통신사 매칭 필요. 외국인은 i-PIN 필요
- "신청 후 승인 안 돼요" → 1영업일 내 승인. 더 걸리면 콜센터 (042-481-3829)
- "OAuth 토큰 안 나와요" → Consumer Key/Secret 둘 다 정확히 복사했는지 확인

---

*작성: 2026-05-01 / 압축 로드맵 v2 Tier 1 진입*
