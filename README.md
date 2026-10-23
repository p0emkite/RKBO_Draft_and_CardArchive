# RKBO Draft & Card Archive

**60차 시즌 카드 도감** — 8개 구단 1군 선수 211명(타자 105명·투수 106명)의 시즌 카드, 능력치와 OVR을 확인할 수 있는 정적 웹앱입니다.

## 사이트
- **도감:** https://p0emkite.github.io/RKBO_Draft_and_CardArchive/
- **관리자:** https://p0emkite.github.io/RKBO_Draft_and_CardArchive/?admin=1
- GitHub Pages: Settings → Pages → Build and deployment: **Deploy from a branch** → **main** / **/(root)** → Save

## 포함된 기능
- 브론즈·실버·골드·플래티넘·다이아몬드 카드
- 8개 구단·타자/투수·포지션·등급별 필터, 선수 이름 검색, 정렬
- 즐겨찾기, 선수별 카드 상세 기록과 능력치
- 타자/투수 실루엣 기본 이미지 및 선수별 업로드 이미지
- **제작자 모드:** 관리자 전용 사진 업로드, 드래그 위치 조절, 휠 확대·축소, GitHub에 저장/동기화
- 시즌/HHRecord 자료 **첨부 및 원본 보관** (업로드한 다른 시즌의 자동 카드 생성은 아직 미구현)

## 데이터 저장 구조
- `index.html`: 60차 선수 카드 데이터와 공개 UI
- `enhancements.js`: 사진/관리자 기능, **`p0emkite/RKBO_Draft_and_CardArchive`의 `main` 브랜치**로 저장
- `enhancements.css`: 보조 UI 스타일
- `assets/default-batter.svg`, `assets/default-pitcher.svg`: 기본 실루엣
- `assets/cards/`: 관리자가 업로드한 선수 이미지(WebP)
- `data/card-images.json`: 이미지 경로·배치 설정
- `data/imports.json`: 추가 자료 업로드 목록
- `imports/`: 추가 자료 보관

## 관리자 토큰
GitHub Fine-grained PAT을 사용하며 `p0emkite` 계정의 **해당 저장소 Contents: Read and write** 권한이 필요합니다. 토큰은 현재 탭 메모리에서만 사용합니다. 일반 관람객은 변경 내용을 저장할 수 없습니다.

## 주의
이 저장소는 **RKBO_CareerMaker와 독립적**입니다. 기존 통산 제작기의 데이터나 배포 설정을 변경하지 않습니다.
