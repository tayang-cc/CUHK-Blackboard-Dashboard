#!/bin/sh
project=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export LMS_HOME="${CUHK_LMS_HOME:-$project/.cuhk-data}"
export LMS_UPDATE_CHECK=0
unset ELECTRON_RUN_AS_NODE
electron="$project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "$electron" ]; then
  printf '缺少图形运行环境，请按 README-CUHK.md 的安装步骤准备 Electron。\n'
  read -r reply
  exit 1
fi
"$electron" "$project" --dashboard
result=$?
if [ "$result" -ne 0 ]; then
  printf '\n界面启动失败（%s），请保留上方错误提示。按回车关闭。\n' "$result"
  read -r reply
fi
exit "$result"
