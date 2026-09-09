# Where am I

여러 저장소를 오가며 코드를 추적하지 않아도, 현재 변경이 파일·API·서비스·DB·테스트 어디까지 영향을 주는지 한 화면에서 확인하는 로컬 우선(local-first) 영향 그래프입니다.

> A local-first impact graph for understanding how code changes flow across files, APIs, services, databases, and tests.

> [!IMPORTANT]
> 현재는 초기 MVP입니다. 분석 결과를 배포·보안·호환성 판단의 유일한 근거로 사용하지 마세요.

## 왜 만들었나요?

멀티 저장소 환경에서는 작은 API 변경도 프론트엔드 wrapper, 백엔드 handler, 내부 서비스, DB schema, 문서와 테스트까지 이어집니다. Where am I는 로컬 Git 저장소에서 근거를 수집하고, 변경과 연결 관계를 클릭 가능한 그래프로 보여줍니다.

## 주요 기능

- 현재 작업 diff를 기준으로 영향받는 코드 흐름 표시
- 팀원 PR과 원격 커밋의 API·schema 변경 브리핑
- API path, handler, wrapper, OpenAPI 문서와 테스트 연결 확인
- 여러 저장소의 API catalog 통합 조회
- 함수, DB, 외부 API, 에러 코드의 파일 경로와 근거 라인 추적
- 온보딩을 위한 시스템 구조 요약과 repo별 탐색

```mermaid
flowchart LR
  A[Git diff / team update] --> B[Local scanner]
  B --> C[Files and functions]
  B --> D[API and handlers]
  B --> E[DB / external calls]
  C --> F[Interactive impact graph]
  D --> F
  E --> F
```

## 빠른 시작

### 요구 사항

- Node.js `>=22.13.0`
- 분석할 로컬 Git 저장소

### 설치 및 실행

```bash
git clone https://github.com/soil0119/Where-am-i.git
cd Where-am-i
npm install
cp whereami.config.example.json whereami.config.json
npm run dev
```

`whereami.config.json`에서 분석할 workspace 경로와 저장소 이름 조건을 설정하세요.

```json
{
  "repoRoots": ["/absolute/path/to/your/workspace"],
  "include": ["your-repo-prefix"],
  "baseBranch": "develop",
  "autoFetch": true,
  "liveWatch": true
}
```

특정 저장소만 직접 지정할 수도 있습니다.

```json
{
  "repos": [
    {
      "name": "sample-api",
      "path": "/absolute/path/to/sample-api",
      "baseBranch": "main"
    }
  ]
}
```

전체 설정과 스캔 제한값은 [`whereami.config.example.json`](./whereami.config.example.json)을 참고하세요.

## 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | UI, 로컬 스캔 서버와 파일 변경 감시를 함께 실행합니다. |
| `npm run scan` | 저장소를 한 번 스캔합니다. |
| `npm run scan:watch` | 설정된 주기로 저장소를 다시 스캔합니다. |
| `npm run scan:server` | 수동 갱신과 실시간 이벤트용 로컬 서버를 실행합니다. |
| `npm run build` | 로컬 snapshot을 제외한 production bundle을 생성합니다. |
| `npm test` | production build와 테스트를 실행합니다. |
| `npm run lint` | 정적 코드 검사를 실행합니다. |

## 데이터와 공개 시 주의사항

Where am I는 분석 대상 코드를 로컬에서 읽습니다. 생성되는 `whereami.config.json`과 `public/whereami-snapshot.json`에는 다음 정보가 포함될 수 있습니다.

- 로컬 절대 경로와 저장소 이름
- branch, commit, PR 제목과 변경 파일
- 함수명, API path, 코드 근거 라인

두 파일은 기본적으로 Git에서 제외됩니다. production build도 로컬 snapshot을 결과물에서 제거하고 내장 샘플 데이터로 표시합니다. 그래도 화면을 캡처하거나 결과를 공유하기 전에는 민감한 정보가 없는지 직접 확인하세요.

`autoFetch`를 활성화하면 스캔 시 각 저장소의 원격 Git 정보를 가져옵니다. 네트워크 접근을 원하지 않으면 `false`로 설정하거나 `npm run scan -- --no-fetch`를 사용하세요.

## 현재 한계

- 코드 관계는 정적 패턴 기반으로 추론하므로 동적 호출이나 복잡한 metaprogramming을 놓칠 수 있습니다.
- 지원 언어와 framework별 extractor 정확도가 아직 균일하지 않습니다.
- GitHub PR/branch 비교 브리핑과 extractor 정확도 개선은 진행 중입니다.

## 기여와 보안

버그 제보와 기능 제안은 [GitHub Issues](https://github.com/soil0119/Where-am-i/issues)를 이용해 주세요. 코드 기여 방법은 [CONTRIBUTING.md](./CONTRIBUTING.md), 취약점 제보 방법은 [SECURITY.md](./SECURITY.md)를 참고하세요.

## 라이선스

[MIT License](./LICENSE)
