# graphify (자동 운영)

이 프로젝트는 graphify 그래프를 **코드 변경 시 자동 증분 갱신**한다.

- **초기 빌드**: 세션 시작 시 graph.json이 없으면 session-resume이 빌드 신호를 띄움
  → Claude가 `/graphify . --update --no-viz` 실행 → `graphify-out/graph.json` 생성
- **증분 갱신**: 코드/문서 편집(Write/Edit) 시 post-code-change → graphify-autobuild가
  `.rebuild-needed` 신호를 남김(디바운스 90초) → 다음 세션 시작 시 증분 반영
- **활용**: agent-harness가 GENERATE_CODE/REFACTOR/FIX_BUG claim 직후 graph를 조회해
  의존성 맹점 제거 + 토큰 절감 (graphify-integration 스킬)

수동 전체 재빌드: `/graphify . --wiki`
