# Windows 与 macOS 一键启动设计

## 目标

用户从 GitHub 拉取或解压项目后，只需双击对应系统入口，不需要手动安装依赖、构建或输入启动命令。

## 结构

- `start-jianyin-windows.cmd`：Windows 双击入口。
- `start-jianyin-macos.command`：macOS 双击入口。
- `scripts/bootstrap-node-windows.ps1`：Windows 缺少兼容 Node.js 时，在项目 `.runtime` 内准备官方 Node 22 LTS。
- `scripts/start-desktop.mjs`：两端共用的依赖安装、生产构建、健康检查、服务启动和浏览器打开逻辑。

## 安全边界

- 不要求管理员权限，不修改系统 PATH，不静默安装系统软件。
- Node.js 只从 `nodejs.org` 下载，并使用官方 `SHASUMS256.txt` 校验。
- 不再结束任意占用 5188 端口的进程；只有确认既见健康接口后才复用已有服务。
- `.runtime`、依赖、构建产物和用户状态均不提交到 Git。
- macOS 在外置盘运行时，仅清理由依赖安装和构建产生的 AppleDouble `._*` 元数据文件，避免模块加载器误读。

## 验证

- macOS 双击入口使用共享启动器完成生产构建、健康检查和服务启动。
- 使用独立端口与 `JIANYIN_NO_OPEN=1` 验证自动启动及退出清理。
- 验证已有健康服务可直接复用，非既见端口占用会明确失败而不会终止其他程序。
- Windows 入口只负责环境引导，实际启动路径与 macOS 共用同一 Node 代码。
- GitHub Actions 在 `windows-latest` 与 `macos-latest` 上分别执行真实入口，服务健康后自动退出，作为持续门禁。
