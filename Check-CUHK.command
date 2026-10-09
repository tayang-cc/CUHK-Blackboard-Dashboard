#!/bin/sh
project=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '正在检查 CUHK Blackboard 身份和课程列表…\n'
"$project/cuhk" --profile cuhk check
result=$?
if [ "$result" -eq 0 ]; then
  printf '\n连接检查通过，可以查询课程和作业。\n'
else
  printf '\n连接检查未通过，请保留上方的错误提示。\n'
fi
printf '\n按回车关闭窗口。\n'
read -r reply
exit "$result"
