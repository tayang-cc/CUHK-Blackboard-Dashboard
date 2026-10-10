# CUHK Blackboard 学习空间（香港本部）

基于 [zs-andy/lms-cli](https://github.com/zs-andy/lms-cli) 的本地开发版本，保留上游 MIT 许可与第三方声明。上游基准：`cdbbba4270a6e036b53afd52fae4f118782bce4c`（0.4.7）。

目标为香港中文大学香港本部：`https://blackboard.cuhk.edu.hk`，时区 `Asia/Hong_Kong`。网址与账号说明来自 [CUHK ITSC](https://www.itsc.cuhk.edu.hk/all-it/teaching-learning-and-research/elearning-system/)。不用于深圳校区。

## 开始使用

### 图形界面

在 Finder 中双击本目录的 **`Open-CUHK.command`** 打开「CUHK · 学习空间」。沿用之前 CLI 保存的授权，启动后自动读取数据。会话过期时，点击左下方「登录 / 重新授权」，在学校窗口完成登录。

- 学习总览：可用课程、截止事件和最新公告。
- 截止日期：合并待办与日历，显示香港时间，保留来源。仅合并同一课程、相同标题和时间的事件；名称相近的事件仍保留，避免误删。
- 我的课程：支持搜索，并查看课程内容、资料列表及打开 Blackboard 页面。
- 课程公告：支持标题、课程和正文搜索，展开阅读及打开原始来源。
- 喵喵工具：查看学校官方课表 App 下载链接和导入手机日历的教程，无需等待 Blackboard 数据同步。
- 刷新数据：可选择未来 7、14 或 30 天。待办还包括过去 30 天的逾期窗口；截止事件不代表作业尚未提交。

图形界面使用本机 Electron，无需网页服务器或额外账号。首次同步可能需要十几秒。遇到网络、权限或授权问题会显示提示。课程资料列表需实际课程验证；当前版本不提供直接下载按钮，可以打开 Blackboard 下载。

### 命令行与授权入口

在 macOS 双击本目录的 `Start-CUHK.command`，或在本目录终端运行：

```sh
./cuhk
```

授权窗口打开后，选择 Blackboard，在学校页面选择 CUHK Login 并自行完成学校登录及验证。学生账号为学校邮箱，密码为 OnePass 密码。无需在聊天中提供密码、验证码或 Cookie。

授权后程序检查身份和课程列表。登录失败或取消时，重新运行 `./cuhk` 可继续；强制重新登录使用 `./cuhk --profile cuhk auth login --platform blackboard`。

已经登录后，可以双击 `Check-CUHK.command` 检查身份和课程列表。终端关闭时的 `Saving session...` 等文字只是保存终端历史记录，不表示登录失败。

## 查询

```sh
./cuhk --profile cuhk check
./cuhk --profile cuhk blackboard courses
./cuhk --profile cuhk blackboard announcements --fresh
./cuhk --profile cuhk blackboard todo --args '{"days":7}' --fresh
./cuhk --profile cuhk overview --days 7 --fresh
./cuhk --profile cuhk blackboard content --course '<课程 ID>'
./cuhk --profile cuhk blackboard files --course '<课程 ID>'
```

课程 ID 从 `courses` 输出取得。`tools --name bb_list_content` 等命令可查询具体参数。CLI 输出为 JSON；资料、成绩和作业查询是否可用取决于实际课程与接口，连接检查不覆盖所有功能。

查询复用现有 Blackboard 连接器；没有新增 CUHK 专属接口或虚构课程数据。远程操作为只读，本地待办和日历导出能力沿用上游。

## 本机数据与 MCP

`./cuhk` 将配置、加密会话与缓存放在本项目 `.cuhk-data/`。加密密钥由系统凭据库管理，下载文件为普通文件。该目录已加入 Git 忽略规则，但分享整个项目目录前仍应排除它。

启动入口关闭上游更新检查。`./cuhk mcp` 启动 MCP 服务；`./cuhk mcp-config` 生成客户端配置，本次开发不自动改动客户端设置。MCP 配置中的 `LMS_HOME` 与启动入口保持一致。

## 开发与重新构建

推荐 Node.js 24 LTS。此机器通过被 Git 忽略的 `.cuhk-node` 文件指定现有 Node.js 24 运行时。换电脑后删除该文件以使用 PATH 中的 Node.js，或设置 `CUHK_NODE` 指向所需可执行文件。

```sh
npm ci
node node_modules/electron/install.js
npm run typecheck
npm test
```

使用 npm 命令前确保 PATH 中的 Node.js 为受支持版本。代码改动：新增 `cuhk` 预设，将搜索别名放入预设数据，加入本地启动入口，将显式 `LMS_HOME` 下的授权浏览器数据也隔离到该目录，并将 MCP SDK 从 1.27.1 更新至 1.32.1 修复已知漏洞。原有多学校 CLI/MCP 和授权流程沿用上游。

## 验证边界

本机验证结果见 [CUHK-VALIDATION.md](CUHK-VALIDATION.md)。

2026-10-09 用户实测已完成 CUHK 学校登录，身份、课程列表、公告、待办与日历查询均成功。课程资料和成绩仍需分别验证。待办和日历覆盖不同，整理作业时应合并两者并核实重复事件；时间输出为 UTC，需转换为香港时间。现有连接器使用 Blackboard Learn Ultra 内部接口；CUHK 的部署差异或接口更新可能需要进一步适配。离线构建与测试通过不代表所有学校功能可用。

## 喵喵工具：课表导入手机日历

学校的 **Student Class Timetable App** 可以查看已选课程、上课地点与教师信息，并导入手机日历。功能依据 [CUHK ITSC 官方说明](https://www.itsc.cuhk.edu.hk/all-it/phone-mobile/cuhk-mobile-app-store/)。Dashboard 仅提供信息与链接，下载和导入由同学自行操作。

1. 在手机 / 平板打开 [CUHK Mobile App Store 学生应用入口](https://campusapps.itsc.cuhk.edu.hk/store/stu/apps.aspx)，使用学校账号登录。
2. 找到 Student Class Timetable，按官方页面的安装说明下载；设备兼容性与安装方式以学校最新说明为准。
3. 打开 App 并按提示登录，核对当前学期和已选课程。
4. 使用 App 内的课表导入功能，按提示允许访问日历；如提供目标日历选项，选择需要的日历。
5. 在手机日历核对上课日期、开始与结束时间、地点和香港时区。

课表变更后请核对并按需重新导入。导入不等于持续自动同步，按钮名称和可选日历以 App 实际界面为准。
