# 보안 정책

[English](./SECURITY.md) | [한국어](./SECURITY.ko.md)

## 지원 범위

현재는 최신 release와 `main` branch의 최신 commit에 보안 수정을 제공합니다.

## 취약점 제보

의심되는 취약점을 공개 Issue로 제보하지 마세요.

GitHub 저장소의 **Security → Advisories → Report a vulnerability**에서 [비공개 취약점 제보](https://github.com/soil0119/Where-am-i/security/advisories/new)를 제출해 주세요. 해당 기능을 사용할 수 없다면 [maintainer의 GitHub 프로필](https://github.com/soil0119)에 안내된 비공개 연락 방법을 이용해 주세요.

안전하게 제공할 수 있는 범위에서 다음 내용을 포함해 주세요.

- 영향받는 version 또는 commit
- 영향과 현실적인 공격 시나리오
- 최소 재현 절차 또는 proof of concept
- 알고 있다면 제안하는 완화 방법

사내 원본 소스 코드, access token, 저장소 이름, 로컬 경로나 가리지 않은 snapshot을 첨부하지 마세요. 최초 접수 확인은 7일 이내에 전달하며, 제보를 확인한 뒤 공개와 수정 일정을 함께 조율합니다.

## 로컬 스캔 데이터

`whereami.config.json`과 `public/whereami-snapshot.json`에는 로컬 경로, Git metadata와 코드 근거가 포함될 수 있습니다. 두 파일은 기본적으로 Git에서 제외되며 production build에서도 snapshot을 제거합니다. 설정을 변경하거나 별도 배포 pipeline을 구성할 때도 이 파일이 공개 artifact에 포함되지 않도록 확인하세요.
