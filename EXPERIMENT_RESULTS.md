# HTTP 协议实验结果与证据索引

## 1. 完成情况

正式实验于 2026 年 9 月 25 日完成。论文目录 `../web-dev/` 未被修改。

- 本地 HTTP/1.1 与 HTTP/2：各 5 次预热、30 次正式测量，共 30 组随机顺序配对。
- 有效性检查：60/60 个正式轮次有效，没有删除、替换或补造运行。
- 每轮自动化白名单请求数：28；HTTP/1.1 文档协议为 `http/1.1`，HTTP/2 文档协议为 `h2`。
- DevTools 观察：已保存本地 H1/H2 的 Network、Headers、页面外观，以及 Wikipedia 首页的 Network 和 Headers。
- HTTP/3：默认模式固定观察 3 次，禁用 QUIC 对照 1 次；保存了 CDP 记录、DevTools 截图、页面截图和 NetLog。

正式配对顺序的随机种子为 `3607009607`，见 [`logs/run-order.json`](logs/run-order.json)。环境版本见 [`logs/environment.txt`](logs/environment.txt)，主机条件见 [`logs/host-conditions.txt`](logs/host-conditions.txt)。

## 2. 本地对照实验结果

| 指标 | HTTP/1.1，中位数（IQR） | HTTP/2，中位数（IQR） | 配对差值中位数，H2−H1 | 解释 |
|---|---:|---:|---:|---|
| 页面 `load` | 436.85 ms（434.83–440.00） | 134.85 ms（133.68–136.35） | −301.80 ms | H2 中位数低 69.13% |
| 资源完成跨度 | 424.05 ms（423.25–426.82） | 114.25 ms（113.60–114.85） | −310.50 ms | H2 中位数低 73.06% |
| DCL | 29.20 ms（27.42–32.05） | 26.55 ms（26.12–26.98） | −2.75 ms | 差异较小，不是主要结果 |
| LCP 候选 | 40 ms（36–48） | 32 ms（32–32） | −8 ms | 合成页面的辅助指标 |
| 主导航 TTFB | 6.10 ms（5.93–6.47） | 6.10 ms（5.90–6.20） | −0.15 ms | 两组后端处理条件接近 |
| 浏览器连接数 | 6 | 1 | −5 | 与 H1 连接槽和 H2 多路复用预期一致 |

30 组配对中，H2 的 `load` 时间全部低于同组 H1，配对差值范围为 −314.90 ms 至 −291.50 ms。完整统计见 [`processed/summary.csv`](processed/summary.csv) 和 [`processed/paired-differences.csv`](processed/paired-differences.csv)。

服务器日志给出了独立交叉核对：每个正式轮次都收到 24 个 SVG 请求；H1 每轮的 Node 峰值并发为 6，H2 每轮为 24。H2 在浏览器到 Nginx 的一条连接上承载多条流，Nginx 再通过 HTTP/1.1 上游连接并发访问 Node，因此不能把 Node 侧的 24 条 socket 解释为浏览器建立了 24 条连接。汇总见 [`processed/server-concurrency-summary.json`](processed/server-concurrency-summary.json)。

这组数据支持的结论是：在本机回环环境和 24 个并发延迟资源下，HTTP/2 多路复用消除了 HTTP/1.1 六连接槽造成的分批排队。实验没有施加 RTT 或丢包，不能用来验证 HTTP/2 的 TCP 跨流队头阻塞，也不能推断 QUIC 的性能收益。

## 3. DevTools 观察证据

| 编号 | 内容 | 文件 |
|---|---|---|
| M1 | H1 Network 表：`http/1.1`、多组 Connection ID、约四波完成 | [`m1-h1-network.png`](screenshots/manual-devtools/m1-h1-network.png) |
| M2 | H1 SVG Headers：URL、GET、200、普通请求与响应首部 | [`m2-h1-headers.png`](screenshots/manual-devtools/m2-h1-headers.png) |
| M3 | H2 Network 表：全部目标资源为 `h2`、同一 Connection ID、并行完成 | [`m3-h2-network.png`](screenshots/manual-devtools/m3-h2-network.png) |
| M4 | H2 SVG Headers：`:authority`、`:method`、`:path`、`:scheme` | [`m4-h2-headers.png`](screenshots/manual-devtools/m4-h2-headers.png) |
| M5 | H1/H2 页面最终外观对照 | [`m5-page-appearance-comparison.png`](screenshots/manual-devtools/m5-page-appearance-comparison.png) |
| M6 | Wikipedia 首页 Network 表，实际协议为 `h2` | [`m6-public-network.png`](screenshots/manual-devtools/m6-public-network.png) |
| M7 | Wikipedia 文档 Headers：`Cache-Control`、`Content-Encoding: gzip`、缓存与服务器字段 | [`m7-public-headers.png`](screenshots/manual-devtools/m7-public-headers.png) |

DevTools 的本地页面截图显示 29 条记录，是因为 Chromium 在这次远程 DevTools 观察中把 favicon 的预加载和图标请求分别列出。自动化采集按预先固定的 URL 白名单验证 28 个目标请求，额外的界面记录没有进入正式统计。DevTools 证据捕获脚本还通过 CDP 在重新加载前禁用了缓存；界面截图中的复选框状态不是计时依据。

两组代表性 HAR 分别保存在 [`har/h1-representative.har`](har/h1-representative.har) 和 [`har/h2-representative.har`](har/h2-representative.har)。

## 4. HTTP/3 观察结果

默认模式三次访问 `https://cloudflare-quic.com/` 时，文档协议都为 `h2`，状态码均为 200，响应均包含 `Alt-Svc: h3=":443"; ma=86400`。禁用 QUIC 后的一次对照仍为 `h2`。这说明站点公布了 HTTP/3 端点，但当前网络路径没有让页面导航成功切换到 h3。

默认模式的 NetLog 记录到 2 次 `QUIC_SESSION_CREATED`、HTTP/3 控制流和 QPACK 流创建事件，随后出现无近期网络活动超时和网络错误关闭；浏览器最终使用 H2。禁用 QUIC 的 NetLog 没有 `QUIC_SESSION_CREATED`。这是对“发现 h3 后尝试 QUIC，但本次环境发生回退”的证据，不是性能对比。

- 三次默认路径 Protocol 截图：[`visit 1`](screenshots/manual-devtools/h3-default-visit1-network.png)、[`visit 2`](screenshots/manual-devtools/h3-default-visit2-network.png)、[`visit 3`](screenshots/manual-devtools/h3-default-visit3-network.png)
- `Alt-Svc` 与请求首部：[`h3-default-headers.png`](screenshots/manual-devtools/h3-default-headers.png)
- 禁用 QUIC 对照：[`h3-disabled-network.png`](screenshots/manual-devtools/h3-disabled-network.png)
- 原始观察 JSON：[`raw/h3-observation/`](raw/h3-observation/)
- NetLog 汇总：[`processed/h3-netlog-summary.json`](processed/h3-netlog-summary.json)
- NetLog：[`netlog/`](netlog/)（普通 Cookie 由 Chromium 脱敏；Wayback 返回的 `x-archive-orig-set-cookie` 值已由脚本净化）

三次访问均按预定次数保留，没有为获得 h3 而继续刷新。

## 5. 数据、图表和运行证据

- 60 个正式原始 JSON：[`raw/h1/`](raw/h1/) 与 [`raw/h2/`](raw/h2/)
- 10 个预热 JSON：[`raw/warmup/`](raw/warmup/)
- 请求级与运行级 CSV：[`processed/`](processed/)
- 统计图：[`figures/`](figures/)
- CDP 冒烟记录：[`logs/cdp-smoke.json`](logs/cdp-smoke.json)
- Node 与 Nginx 完整容器日志：[`logs/compose-logs.txt`](logs/compose-logs.txt)
- 生效的 Nginx 配置：[`logs/nginx-config.txt`](logs/nginx-config.txt)
- 容器与镜像信息：[`logs/compose-ps.txt`](logs/compose-ps.txt)、[`logs/compose-images.txt`](logs/compose-images.txt)、[`logs/container-inspect.json`](logs/container-inspect.json)
- 本地证书信息：[`logs/certificate-info.txt`](logs/certificate-info.txt)
- DevTools 捕获清单：[`logs/devtools-capture/capture-manifest.json`](logs/devtools-capture/capture-manifest.json)
- 隐私审计：[`logs/privacy-audit.json`](logs/privacy-audit.json)；净化记录：[`logs/netlog-sanitization.json`](logs/netlog-sanitization.json)
- 最终验证：[`logs/final-verification.txt`](logs/final-verification.txt)
- SHA-256 清单：[`checksums-sha256.csv`](checksums-sha256.csv)

## 6. 论文写作时应保留的边界

建议把 `load`、资源完成跨度和连接数作为主结果，把 DCL、TTFB 与 LCP 作为辅助结果。H1/H2 的本地数据用于说明连接调度与多路复用；HTTP/3 只用于说明 `Alt-Svc`、QUIC 尝试和回退。公网与本地结果不要放在同一性能坐标轴，也不要把本次未协商成功的 h3 写成成功使用 HTTP/3。
