# Git 워크플로

## 브랜치 모델

두 개의 장수 브랜치를 사용한다.

| 브랜치 | 역할 | 규칙 |
|--------|------|------|
| `main` | 안정/릴리스. 항상 배포 가능 상태 | 직접 커밋 금지. `dev`에서만 병합 |
| `dev`  | 통합 브랜치. 개발은 여기로 모인다 | 기능 브랜치를 병합해 원격으로 올림 |

기능 작업은 짧게 사는 **기능 브랜치**에서 한다.

```
feat/<기능이름>   예) feat/roster-domain, feat/realtime-gateway
fix/<버그이름>
chore/<잡무>
docs/<문서>
```

## 흐름

```
main ──┬─────────────────────────────────────────────▶ (릴리스 시 dev 병합)
       │
       └─▶ dev ──┬── feat/roster-domain ──┐
                 │                         │ (--no-ff 병합)
                 ├─◀───────────────────────┘
                 ├── feat/realtime-gateway ─┐
                 ├─◀────────────────────────┘
                 └──▶ origin/dev (push)
```

1. `dev`에서 기능 브랜치를 딴다: `git switch -c feat/x dev`
2. TDD로 개발한다 → [TDD.md](TDD.md)
3. 기능이 완성되면 **기능 단위로 커밋**한다.
4. `dev`로 `--no-ff` 병합해 기능 묶음을 히스토리에 남긴다.
5. `git push origin dev`로 원격에 올린다.
6. 안정화되면 `dev` → `main` 병합(PR)으로 릴리스한다.

## 커밋 컨벤션

[Conventional Commits](https://www.conventionalcommits.org).

```
<type>: <설명>

<본문(선택)>
```

`feat` · `fix` · `refactor` · `docs` · `test` · `chore` · `perf` · `ci`

- 한 커밋 = 하나의 논리적 변경(기능 단위).
- 명령형·현재형("추가한다"가 아니라 "추가").

## 저작자 표기 정책 (중요)

> **이 저장소의 모든 커밋·병합은 저장소 소유자(사람)를 저작자로 한다.**
> 어시스턴트/도구가 작성했다는 표기를 **넣지 않는다.**

구체적으로:

- 커밋 메시지에 `Co-Authored-By: Claude ...` 또는 `Co-Authored-By: <AI>` 트레일러를 **넣지 않는다.**
- `🤖 Generated with ...` / `Co-authored with an assistant` 류 문구를 **넣지 않는다.**
- `git config user.name` / `user.email`은 사람 소유자 값으로 고정한다.

```bash
git config user.name  "uchong"
git config user.email "dmlcksghd@gmail.com"
```

이 규칙은 로컬에서 손으로 지키며, 필요하면 `commit-msg` 훅으로 강제할 수 있다:

```bash
# .git/hooks/commit-msg (선택) — 저작 표기 트레일러가 있으면 커밋 거부
#!/bin/sh
if grep -qiE 'co-authored-by:.*(claude|assistant|copilot|gpt|ai)|generated with' "$1"; then
  echo "저작자 표기 트레일러는 정책상 금지됩니다." >&2
  exit 1
fi
```

## PR 흐름 (dev → main)

1. `git diff main...dev`로 전체 변경 확인
2. 요약 + 테스트 계획 작성
3. CI 그린 확인 후 병합
