#!/bin/zsh
# run.sh <name> <scenario> ; env passes through (PROTO_STDIN, PROTO_REPLAY_INIT, PROTO_RESEND)
P=/tmp/mclaude-proto; D=$(cd $(dirname "$0") && pwd)
name=$1; scenario=${2:-wall}
rm -f $P/limit $P/host.log $P/sdk-wrapper.log; : > $P/proxy.log
cd $P/work && timeout 240 ~/.bun/bin/bun $D/host.ts $scenario
mkdir -p $P/runs/$name; cp $P/host.log $P/sdk-wrapper.log $P/proxy.log $P/runs/$name/
echo "##### $name  scenario=$scenario STDIN=${PROTO_STDIN:-pipe} REPLAY_INIT=${PROTO_REPLAY_INIT:-0} RESEND=${PROTO_RESEND:-1}"
echo "--- host"; cat $P/host.log | cut -c1-230
echo "--- wrapper"; grep -v 'SessionStart' $P/sdk-wrapper.log | cut -c1-230
echo "--- proxy 429s"; grep -c '429' $P/proxy.log
