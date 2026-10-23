# RKBO Draft & Card Archive

**60차 시즌 카드 도감** — 8개 구단 1군 선수 211명(타자 105명·투수 106명)의 시즌 카드, 능력치와 OVR을 확인할 수 있는 정적 웹앱입니다.

## 사이트
- **도감:** https://p0emkite.github.io/RKBO_Draft_and_CardArchive/
- **관리자:** https://p0emkite.github.io/RKBO_Draft_and_CardArchive/?admin=1
- GitHub Pages: Settings → Pages → Build and deployment: **Deploy from a branch** → **main** / **/(root)** → Save

## 포함된 기능
- 브론즈·실버·골드·코랄·다이아몬드 카드
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

## 선수 이름 표시
- 통산 제작기의 `data/player_db.csv` 사본을 `data/player_db.csv`에 보관합니다.
- `player-name-map.js`는 통산 제작기 `roster.js`의 이름 정규화·영문 순서 변형·중복 이름 검증 방식을 사용합니다.
- 카드 도감, 선수 상세, 관리자 사진 편집, 750×1050 PNG는 같은 한글 표시 이름을 사용합니다. 영문 이름과 원본 `rawName` 검색도 가능합니다.
- **현재 60차 시즌 211명 중 199명 매칭, 12명 미등록**. 미등록은 잘못된 이름을 추정하지 않고 원문 그대로 표시합니다.
- 새 선수 이름이 필요하면 이 저장소의 `data/player_db.csv`에 `Season,Team,Name,KoreanName` 양식으로 추가한 뒤 페이지를 새로고침하면 됩니다. 통산 제작기 원본 저장소는 수정되지 않습니다.


## 다중 시즌 도감 (2026-10 업데이트)

도감 상단의 **시즌 선택**에서 GitHub에 공개된 카드 데이터가 있는 시즌만 선택할 수 있습니다.

- \`60차 시즌\`은 기본으로 포함되어 있습니다. 60차 원본 카드 211장과 기존 OVR은 그대로 유지합니다.
- 다른 시즌은 **관리자 모드 → 시즌 카드 등록·공개**에서 시즌 번호 및 카드 데이터 JSON을 선택한 뒤 GitHub에 저장합니다.
- 관리자 등록 과정에서 카드 JSON을 검증하고 \`data/seasons/{회차}.json\` 파일이 정상 업로드된 이후 \`data/seasons.json\`에 시즌을 추가합니다. 시즌 목록에는 이 파일에 공개된 시즌만 나타납니다.
- 시즌 선택 시 카드·등급 수량, 선수 목록, 검색/필터, 카드 상세, PNG 저장 대상, 시즌 제목과 배경 시즌 번호가 함께 변경됩니다. 저장된 개인 사진 정보는 시즌별 카드 ID로 연결됩니다.
- \`data/player_db.csv\`의 한글 매칭을 추가 시즌에도 적용합니다. 원문 이름으로도 검색할 수 있습니다.

### 신규 시즌 카드 JSON 예시

\`\`\`json
{
  "season": 59,
  "players": [
    {
      "id": "59-SAM-타-001",
      "season": 59,
      "team": "SAM",
      "teamLabel": "삼성 라이온즈",
      "name": "Go , Younjung",
      "rawName": "Go , Younjung",
      "type": "타자",
      "pos": "1B",
      "ovr": 88,
      "grade": "코랄",
      "ratings": {"정확": 77, "파워": 95, "선구": 83, "주루": 55, "수비": null},
      "stats": {"G": 149, "Avg": 0.253, "Obp": 0.348, "Slg": 0.515, "Ab": 620, "H": 157, "2B": 30, "3B": 0, "Hr": 44, "R": 135, "Rbi": 118, "BB": 88, "K": 104, "Sb": 1, "Cs": 2}
    }
  ]
}
\`\`\`

> 예시는 **형식 설명용 가상 59차 카드**이며 실제 59차 기록·OVR을 뜻하지 않습니다. 59차 자료를 실제로 등록할 때는 59차 원본에서 산출한 실제 기록·능력치를 넣어야 합니다.

**중요:** 관리자 메뉴의 *시즌·HHRecord 자료 첨부* 기능은 원본을 GitHub에 백업하는 메뉴입니다. HTML/XLS/ZIP/HHRecord 파일만 업로드해도 카드 스탯·OVR을 계산하거나 시즌 목록에 자동 등록하지는 않습니다. 현재 공개 등록 기능은 **카드 스탯과 OVR이 준비된 JSON 파일**에 대해서만 지원합니다. 원본 → JSON 자동 변환기는 후속 개발 대상입니다.

### 저장소 구조
- \`data/seasons.json\`: 현재 공개된 시즌 목록(60차 기본)
- \`data/seasons/59.json\` 등: 관리자 등록 시즌별 카드 데이터
- \`data/card-images.json\`: 선수별 이미지 경로·배치 (수정 없음)
- \`data/imports.json\`: 관리자 원본 파일 업로드 목록 (수정 없음)
- \`assets/rkbo-archive-logo.webp\`: 첨부 RKBO 야구 로고 (헤더용 최적화 이미지)

