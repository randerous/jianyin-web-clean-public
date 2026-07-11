# 性能测试用例索引

本目录只放性能类测试用例。目标是让测试模型快速判断“慢在哪里”，并输出可量化数据。

## 通用环境

- 项目目录：`/Volumes/Ventoy/tools/jianyin-web-clean-public`
- 桌面端地址：`http://127.0.0.1:5188/`
- 性能 E2E 隔离地址：`http://127.0.0.1:5190/`
- Android 包名：`com.randerous.jianyin`
- 主状态 key：`localStorage["jianyin-web-clean-state-v1"]`
- IndexedDB：`jianyin-web-clean-audio / files`

## 文件列表

- `00-性能测试执行入口.md`
- `01-首页与歌单加载性能.md`
- `02-搜索性能.md`
- `03-播放与切歌性能.md`
- `04-下载与本地缓存性能.md`
- `05-数据恢复与存储性能.md`
- `06-UI渲染与交互响应性能.md`
- `07-APK真机性能.md`
- `08-性能测试报告模板.md`

## 全局安全要求

- 不清空真实 localStorage。
- 不删除真实 IndexedDB 音频。
- 删除类和大数据类压测必须使用隔离 browser context。
- APK 测试只允许 `adb install -r` 覆盖安装，禁止 `adb uninstall` 和 `pm clear`。
- 每项测试至少记录：环境、样本量、耗时、是否通过、异常日志。
- 自动化命令为 `npm run test:perf`，报告输出到 `test-results/perf-report.json`。
- 性能服务读取生产构建 `dist`，内部无重复构建入口为 `npm run test:perf:run`。
- 多样本指标和单次 smoke 必须在报告中明确区分。

## 通用指标

- P50：中位耗时。
- P95：95 分位耗时。
- TTI：页面可交互时间。
- TTFP：点击播放到音频 `currentTime > 0` 的时间。
- Long task：浏览器主线程超过 50ms 的长任务。
