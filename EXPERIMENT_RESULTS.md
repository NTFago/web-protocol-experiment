# HTTP 协议实验结果与证据索引

## Material Passport

- Experiment ID：`tri-2026-09-28T09-13-29-570Z`
- Type：Code experiment
- Status：VERIFIED
- Command：`node scripts/collect.mjs --blocks 30 --warmups 5 --seed 20260928`
- Scope：本地 HTTP/1.1、HTTP/2、HTTP/3 受控比较
- Reproducibility evidence：原始 JSON、运行顺序、CDP、NetLog、HAR、截图、容器日志与生效配置

## 1 完成情况

实验于 2026 年 9 月 28 日连续完成。H1、H2、H3 各运行 5 次预热，随后完成 30 个区组；每个区组各包含一次三种协议访问，共 90 个正式运行。六种协议顺序各出现 5 次，随机种子为 `20260928`。

90 个正式运行全部通过检查。每轮均收齐 28 个白名单请求，其中 24 个为 SVG；没有状态码异常、缓存命中、加载失败或协议回退。H1 文档与资源均为 `http/1.1`，H2 均为 `h2`，H3 均为 `h3`。

活动批次和完整顺序见 [`logs/tri-protocol-run-order.json`](logs/tri-protocol-run-order.json)，环境版本见 [`logs/environment.txt`](logs/environment.txt)。

## 2 主要结果

| 指标 | HTTP/1.1，中位数（IQR） | HTTP/2，中位数（IQR） | HTTP/3，中位数（IQR） |
|---|---:|---:|---:|
| 页面 `load` | 430.65 ms（429.77–431.97） | 136.25 ms（135.20–138.12） | 132.90 ms（132.05–134.47） |
| 资源完成跨度 | 420.40 ms（419.72–421.60） | 117.05 ms（116.43–118.10） | 116.30 ms（115.80–117.15） |
| DOMContentLoaded | 27.95 ms（19.13–28.70） | 26.25 ms（21.77–26.70） | 23.60 ms（21.83–26.97） |
| LCP 候选 | 36 ms（36–48） | 34 ms（32–47） | 46 ms（36–51） |
| 主导航 TTFB | 3.90 ms（3.80–3.98） | 4.00 ms（3.83–4.00） | 4.60 ms（4.50–4.95） |
| 浏览器连接数 | 6 | 1 | 1 |
| 编码字节数 | 23,451 B | 20,718 B | 20,876 B |

区组内比较显示：

- H2 相对 H1 的 `load` 差值中位数为 −294.70 ms，相对变化中位数为 −68.32%；30 个区组均低于 H1。
- H3 相对 H1 的 `load` 差值中位数为 −297.35 ms，相对变化中位数为 −69.13%；30 个区组均低于 H1。
- H2、H3 相对 H1 的资源完成跨度差值中位数分别为 −303.40 ms 和 −304.20 ms，对应 −72.16% 和 −72.34%。
- H3 相对 H2 的 `load` 差值中位数为 −3.25 ms，范围为 −12.10 至 6.30 ms；资源完成跨度差值中位数为 −0.85 ms，范围为 −3.30 至 7.60 ms。

H2 与 H3 都把 24 个延迟 SVG 放在一个并发批次中。两者之间的毫秒级差距没有脱离本地调度、QUIC/TLS 实现和测量抖动的影响，当前数据不用于判断哪一种协议在一般网络上更快。

完整统计见 [`processed/summary.csv`](processed/summary.csv) 和 [`processed/block-differences.csv`](processed/block-differences.csv)。

## 3 连接与服务端记录

浏览器侧，H1 每轮使用 6 个 Connection ID，H2 和 H3 每轮各使用 1 个。Node 日志在 H1 中记录到峰值并发 6，在 H2、H3 中均为 24。每轮服务端都收到 24 个 SVG 请求。

H1 的请求因此分成约四批；H2、H3 则在单个浏览器连接的多条流上并发推进。Nginx 到 Node 的上游仍为 HTTP/1.1，Node socket 数表示代理侧扇出，不能解释为浏览器连接数。

自动化侧 720 个 SVG 样本中，H2 的单请求 CDP 耗时中位数为 107.08 ms，范围为 101.79–110.25 ms；H3 为 104.55 ms，范围为 101.22–107.90 ms。H1 请求包含连接槽排队，整体范围为 100.94–398.72 ms。

服务端汇总见 [`processed/server-concurrency-summary.json`](processed/server-concurrency-summary.json)，容器日志见 [`logs/tri-protocol-compose-logs.txt`](logs/tri-protocol-compose-logs.txt)。

## 4 图表与代表性记录

- 综合结果图：[`figures/paper-results-combined.png`](figures/paper-results-combined.png)
- 三协议区组折线图：[`figures/paper-block-rounds.png`](figures/paper-block-rounds.png)
- H1、H2、H3 代表性 HAR：[`har/`](har/)
- 三协议代表性页面截图：[`screenshots/automated/`](screenshots/automated/)
- 正式批次 NetLog：[`netlog/tri-2026-09-28T09-13-29-570Z.json`](netlog/tri-2026-09-28T09-13-29-570Z.json)
- 生效的 Nginx 配置：[`logs/tri-protocol-nginx-config.txt`](logs/tri-protocol-nginx-config.txt)

LCP 候选在 90 个正式运行中都是页面 `<h1>`，面积均为 42,328 px²。SVG 没有成为候选项，因此 LCP 只作辅助指标。

## 5 解释边界

实验说明了固定并发资源在三种协议入口下的调度差异。H1 受浏览器六连接槽约束，H2 和 H3 都能在一条连接内并发推进多个流。实验没有注入丢包或公网 RTT，不能检验 HTTP/2 的 TCP 跨流阻塞，也不能展示 QUIC 在弱网中的恢复优势。

本地 H3 使用 Chromium 的强制 QUIC 入口和证书 SPKI 限定，以确保每轮直接协商 `h3`。这保证了协议条件，但不模拟真实站点通过 `Alt-Svc` 逐步发现 H3 的过程。公网观察记录继续保存在 `raw/h3-observation/`，只用于分析服务宣告、连接尝试和回退，不进入本地性能统计。
