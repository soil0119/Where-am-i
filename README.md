# Where am I

작업 중인 파일, API, 서비스 연결, 팀원 변경 브리핑을 한 화면에서 보는 영향 그래프 MVP입니다.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

## MVP

- 현재 작업 diff 기준 영향 그래프
- 팀원이 바꾼 API/schema 브리핑
- API path, Swagger, 테스트 정합성 확인 뷰
- 전체 API catalog 표시
- 함수, handler, DB, 외부 API, 에러코드 근거 라인 추적
- 노드/선을 클릭해 repo, 파일 경로, 연결 근거 확인

## Repo Scan

`whereami.config.example.json`을 복사해 `whereami.config.json`을 만들고, 연결할 로컬 repo root와 include prefix를 설정합니다. `whereami.config.json`은 로컬 전용 파일이라 git에 올라가지 않습니다.

```bash
npm run scan
npm run scan:watch
npm run scan:server
```

스캔 결과는 `public/whereami-snapshot.json`에 생성됩니다. 기본 주기 갱신은 1시간이고, `npm run dev` 상태에서는 연결된 repo 파일 변경을 감지해 자동 재스캔합니다. 화면은 스캔 서버 이벤트를 받아 바로 다시 읽습니다. 갱신 버튼은 수동 재스캔용입니다.

## Next

- extractor 정확도 개선
- GitHub PR/branch 비교 브리핑 자동화
