#!/bin/zsh
# run.sh <name> <script> ; env passes through (PROTO_KILL, PROTO_RESET, PROTO_RESEND)
P=/tmp/mclaude-proto; D=$(dirname "$0")
name=$1; script=$2
rm -f $P/limit $P/drive.log $P/wrapper.log $P/userhook.log $P/tty.raw; : > $P/proxy.log
rm -rf $P/shared-projects/-private-tmp-mclaude-proto-work
cd $P && timeout 150 python3 $D/drive.py $script --model haiku
mkdir -p $P/runs/$name; cp $P/drive.log $P/wrapper.log $P/proxy.log $P/tty.raw $P/runs/$name/ 2>/dev/null; cp $P/userhook.log $P/runs/$name/ 2>/dev/null
echo "##### $name  (KILL=${PROTO_KILL:-SIGTERM} RESET=${PROTO_RESET:-0} RESEND=${PROTO_RESEND:-0})"
echo "--- wrapper"; grep -v '^.*signal SessionStart' $P/wrapper.log | sed -E 's/payload=.*//' | cut -c1-200
echo "--- drive"; grep -E 'seen|TIMEOUT|termios|trigger|mark' $P/drive.log
echo "--- userhook fired: $(grep -c StopFailure $P/userhook.log 2>/dev/null || echo 0)"
echo "--- final screen"; python3 - <<'PY'
import re
b=open('/tmp/mclaude-proto/tty.raw','rb').read()
ANSI=re.compile(rb'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[=>]|\r')
i=b.rfind(b'v2.1.259'); s=ANSI.sub(b'',b[i:]).decode('utf8','replace')
s=re.sub(r'\n\s*\n+', '\n', s); print(s[-1400:])
PY
