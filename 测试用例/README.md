# 测试用例索引

本目录按功能层级拆分测试。给其他模型执行时，先读 `00-执行入口-测试.md`，再按目标模块读取对应文件。

## 通用环境

- 项目目录：`/Volumes/Ventoy/tools/jianyin-web-clean-public`
- 桌面端地址：`http://127.0.0.1:5188/`
- 功能 E2E 隔离地址：`http://127.0.0.1:5189/`
- 性能 E2E 隔离地址：`http://127.0.0.1:5190/`
- Android 包名：`com.randerous.jianyin`
- 主状态 key：`localStorage["jianyin-web-clean-state-v1"]`
- IndexedDB：`jianyin-web-clean-audio / files`
- 共享状态文件：`.jianyin-shared-state.json`

## 模块文件

- `00-执行入口-测试.md`
- `01-启动与基础渲染-测试.md`
- `02-移动端布局与顶部留白-测试.md`
- `03-首页推荐-测试.md`
- `04-搜索-测试.md`
- `05-歌单详情-测试.md`
- `06-播放器-测试.md`
- `07-FLAC与音质-测试.md`
- `08-下载管理-测试.md`
- `09-数据保护与恢复-测试.md`
- `10-我的页与歌单管理-测试.md`
- `11-设置-测试.md`
- `12-账号同步-测试.md`
- `13-错误提示与弹窗层级-测试.md`
- `14-APK与真机-测试.md`

本轮桌面验收不依赖人工用例；自动化入口与实测状态以 `00-执行入口-测试.md` 为准。

## 安全要求

- 不清空真实浏览器 localStorage。
- 不删除真实 IndexedDB 音频。
- 删除类用例必须使用隔离 browser context 和测试 key。
- APK 覆盖安装只能用 `adb install -r`，不要 `adb uninstall`。
- 测试前备份 `.jianyin-shared-state.json`。
