#!/bin/bash
# .git/hooks/pre-commit 에 fk-validate 등록 (1회 실행)
ROOT="$(git rev-parse --show-toplevel)"
HOOK="$ROOT/.git/hooks/pre-commit"
LINE="bash .claude/hooks/pre-commit-fk-validate.sh"
mkdir -p "$ROOT/.git/hooks"
if [ -f "$HOOK" ]; then
    grep -qF "$LINE" "$HOOK" || echo "$LINE" >> "$HOOK"
else
    echo "#!/bin/bash" > "$HOOK"
    echo "$LINE" >> "$HOOK"
fi
chmod +x "$HOOK"
echo "pre-commit hook 등록 완료"
