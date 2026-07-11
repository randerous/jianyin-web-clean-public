# 07 FLAC 与音质测试

## 环境

- 可 mock `/api/flac/search`、`/api/flac/song/:id`、`/api/flac/stream/:id`。

## 用例

| ID | 测试点 | 方法 | 通过标准 |
|---|---|---|---|
| FLAC-01 | 高质量优先 | 搜索真实 FLAC ID 并播放 | 优先请求 FLAC/高质量，不固定 320K |
| FLAC-02 | FLAC 不可用 | mock FLAC URL 失败 | 自动降级 320K 且可播 |
| FLAC-03 | 旧 320K 缓存 | localStorage 存旧 320K 结果 | 播放前刷新到 FLAC |
| FLAC-04 | 签名过期 | stream 中途失败 | 自动刷新签名恢复播放 |
| FLAC-05 | 中途恢复 | 播放中链接失效 | 从当前进度附近恢复 |
| FLAC-06 | 长暂停恢复 | 暂停超过刷新阈值再播 | 刷新链接，不丢进度 |

## 通过标准

- 可用 FLAC 时优先 FLAC。
- 不可用时能降级播放，并保留可理解提示。
