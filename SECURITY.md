# Security Policy

## 지원 범위

현재는 최신 `main` branch와 최신 release만 보안 수정을 제공합니다.

## 취약점 제보

보안 취약점은 공개 Issue에 작성하지 마세요. GitHub 저장소의 **Security → Advisories → Report a vulnerability**를 통해 비공개로 제보해 주세요. 해당 기능을 사용할 수 없다면 [maintainer의 GitHub 프로필](https://github.com/soil0119)을 통해 비공개 연락 방법을 요청해 주세요.

제보에는 가능한 범위에서 영향, 재현 절차, 영향받는 버전과 제안한 완화 방법을 포함해 주세요. 저장소 경로, access token, 사내 코드처럼 민감한 원본 데이터는 첨부하지 마세요.

## 로컬 스캔 데이터

`whereami.config.json`과 `public/whereami-snapshot.json`은 로컬 경로, Git metadata와 코드 근거를 포함할 수 있습니다. 두 파일은 기본적으로 Git에서 제외되며 production build에서도 snapshot을 제거합니다. 설정을 변경하거나 별도 배포 파이프라인을 구성할 때도 이 파일을 공개 artifact에 포함하지 마세요.
