#!/bin/sh
project=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$project/cuhk" setup --preset cuhk --yes --no-codex
result=$?
printf '\n按回车关闭窗口。\n'
read -r reply
exit "$result"
