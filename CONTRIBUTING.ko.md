# Where am I에 기여하기

[English](./CONTRIBUTING.md) | [한국어](./CONTRIBUTING.ko.md)

Where am I 개선에 참여해 주셔서 감사합니다. 영어와 한국어 기여를 모두 환영하며, 버그 제보, 문서 개선, extractor 지원, 테스트와 사용성 피드백 모두 도움이 됩니다.

## 시작하기 전에

- 중복 작업을 피하도록 기존 Issue와 pull request를 먼저 검색해 주세요.
- 버그 수정은 재현 가능한 설명이 있는 Issue를 열거나 연결해 주세요.
- 큰 기능이나 아키텍처 변경은 구현 전에 Issue에서 범위와 접근 방식을 논의해 주세요.
- Issue, 로그, 화면 캡처와 fixture에 비공개 소스 코드, access token, 사내 저장소 이름이나 가리지 않은 로컬 경로를 포함하지 마세요.

처음 참여할 작업을 찾는다면 [`good first issue`](https://github.com/soil0119/Where-am-i/labels/good%20first%20issue)와 [`help wanted`](https://github.com/soil0119/Where-am-i/labels/help%20wanted) label을 확인해 주세요.

## 개발 환경 준비

1. 저장소를 fork하고 `main`에서 목적이 분명한 branch를 만드세요.
2. Node.js `>=22.13.0`을 설치하세요.
3. 의존성을 설치하고 로컬 설정 파일을 만드세요.

```bash
npm ci
cp whereami.config.example.json whereami.config.json
npm run dev
```

Windows PowerShell에서는 `cp` 대신 `Copy-Item whereami.config.example.json whereami.config.json`을 사용하세요.

## 변경할 때

- 각 pull request는 한 가지 문제에 집중해 주세요.
- 동작을 변경하면 테스트를 추가하거나 갱신해 주세요.
- 공통 동작이나 설치 방법이 바뀌면 영어와 한국어 문서를 함께 갱신해 주세요.
- 기존 코드 스타일을 따르고 무관한 formatting 변경은 피해주세요.
- `whereami.config.json`, `public/whereami-snapshot.json`, build 결과물이나 secret을 commit하지 마세요.

## Pull request를 열기 전에

CI와 같은 핵심 검사를 실행하세요.

```bash
npm run lint
npm test
```

Pull request에는 다음 내용을 포함해 주세요.

- 무엇을 왜 변경했는지 설명
- 관련 Issue가 있다면 `Closes #<issue-number>`로 연결
- 동작 변경의 재현 또는 검증 방법
- UI 변경의 경우 민감정보를 제거한 화면 캡처나 짧은 영상
- 알려진 한계, 후속 작업이나 호환성 주의사항

Maintainer가 merge 전에 수정을 요청할 수 있습니다. 리뷰는 기여 내용에 집중하고 서로 존중하며 [행동강령](./CODE_OF_CONDUCT.md)을 따라야 합니다.

## 버그 제보

가능하면 다음 내용을 포함해 주세요.

- 기대한 동작과 실제 동작
- 최소 재현 단계
- Node.js 버전과 운영체제
- 민감정보를 제거한 오류 메시지나 로그

보안 취약점은 공개 Issue로 제보하지 말고 [SECURITY.ko.md](./SECURITY.ko.md)를 따라 주세요.
