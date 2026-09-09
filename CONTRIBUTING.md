# Contributing to Where am I

버그 제보, 문서 개선, extractor 확장과 사용성 피드백을 환영합니다.

## 시작하기

1. 큰 변경은 구현 전에 Issue로 문제와 접근 방식을 공유해 주세요.
2. 저장소를 fork하고 목적이 분명한 branch를 만드세요.
3. Node.js `>=22.13.0`에서 의존성을 설치하세요.
4. 변경에 맞는 테스트와 문서를 함께 갱신하세요.

```bash
npm install
cp whereami.config.example.json whereami.config.json
npm run dev
```

## Pull request 전 확인

```bash
npm run lint
npm test
```

- PR은 한 가지 문제에 집중해 주세요.
- 동작 변경에는 재현 방법이나 테스트를 포함해 주세요.
- UI 변경에는 민감정보가 제거된 화면 설명이나 캡처를 포함해 주세요.
- 생성된 `whereami.config.json`과 `public/whereami-snapshot.json`은 커밋하지 마세요.

## 버그 제보

가능하면 다음 내용을 포함해 주세요.

- 기대한 동작과 실제 동작
- 재현 단계
- Node.js 버전과 운영체제
- 민감정보를 제거한 오류 메시지

보안 취약점은 공개 Issue로 제보하지 말고 [SECURITY.md](./SECURITY.md)를 따라 주세요.
