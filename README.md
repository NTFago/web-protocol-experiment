# HTTP 协议实验代码

本目录实现同一受控负载下的 HTTP/1.1、HTTP/2 与 HTTP/3 比较。三组共用 Node.js 应用、Nginx 反向代理、页面资源和浏览器采集逻辑，区别只在浏览器到 Nginx 的传输协议。

## 1 实验组成

- Node.js 应用固定产生 28 个测试请求：HTML、CSS、JavaScript、favicon 和 24 个 SVG。
- 每个 SVG 在服务端异步等待 100 ms 后返回，并记录 `run_id`、上游 socket 和峰值并发。
- Nginx 分别在 `127.0.0.1:8441`、`8442`、`8443` 提供 HTTP/1.1、HTTP/2 和 HTTP/3；8443 同时映射 TCP 与 UDP。
- Playwright 每轮建立新的浏览器上下文，通过 CDP 保存协议、连接编号、时序和首部。
- 正式实验以区组组织。每个区组各运行一次 H1、H2、H3，六种协议顺序均衡出现。
- 汇总脚本生成运行级、请求级和区组差值 CSV；绘图脚本生成论文图表。

公网脚本仍保留，用于观察 `Alt-Svc`、QUIC 尝试和协议回退，不与本地受控数据混算。

## 2 首次准备

```powershell
cd E:\project\homework\webdev\class1\web-protocol-experiment
npm install
npm run install:browser
npm run certs
python -m pip install -r requirements-plot.txt
```

`npm run certs` 生成仅用于本机实验的证书。私钥已被 `.gitignore` 排除。

启动与停止服务：

```powershell
npm run up
docker compose ps
npm run down
```

## 3 冒烟测试

服务启动后运行：

```powershell
npm run env
npm run smoke
```

通过条件如下：

- H1 文档协议为 `http/1.1`；
- H2 文档协议为 `h2`；
- H3 文档协议为 `h3`；
- 每组均收齐 28 个白名单请求；
- `logs/cdp-smoke.json` 中三个结果的 `valid` 均为 `true`。

H3 使用 Chromium 的 `--origin-to-force-quic-on=127.0.0.1:8443`，并以本地证书 SPKI 摘要限定证书例外。该设置只作用于 8443，不改变 H1、H2 的入口。

## 4 正式采集

默认命令执行每组 5 次预热和 30 个三协议区组：

```powershell
npm run collect
```

需要固定随机顺序时显式给出 seed：

```powershell
node scripts/collect.mjs --blocks 30 --warmups 5 --seed 20260928
```

一次采集对应一个 `campaign_id`。原始 JSON 写入 `raw/tri-protocol/<campaign_id>/`，当前活动批次记录在 `logs/tri-protocol-run-order.json`。首次有效的 H1、H2、H3 运行分别保存页面截图和 HAR；整批浏览器网络事件另存为 NetLog。

正式实验不覆盖既有原始 JSON。若重新运行，新的 `campaign_id` 会创建独立目录，汇总脚本只读取活动批次。

## 5 验证、汇总和作图

采集结束、服务仍在运行时保存日志并执行分析：

```powershell
npm run capture:logs
npm run verify
npm run analyze
npm run serverlog:summary
npm run privacy:audit
npm run checksums
```

主要输出包括：

- `processed/runs.csv`：90 个正式运行；
- `processed/requests.csv`：请求级记录；
- `processed/block-differences.csv`：30 个区组及三组组内差值；
- `processed/summary.csv` 与 `summary.json`：中位数、IQR、范围和相对差值；
- `processed/server-concurrency-summary.json`：Node 侧并发与上游 socket 数；
- `figures/paper-results-combined.pdf` 与 `.png`：论文使用的综合结果图；
- `logs/tri-protocol-compose-logs.txt`：Node 与 Nginx 日志；
- `logs/tri-protocol-nginx-config.txt`：本次实验实际生效的 Nginx 配置。

`verify` 同时检查运行数、区组完整性、28 个白名单请求、24 个 SVG、状态码、缓存标志和实际协议。任一条件不满足都会返回非零状态，原始记录仍保留。

发布或归档前应再次运行 `privacy:audit` 和 `checksums`。校验和脚本覆盖仓库中的代码、配置、处理结果、图表和原始证据，但排除 Git 元数据、依赖目录、本地证书及校验和文件本身。

## 6 单独验证 HTTP/3

无需执行完整批次时，可运行：

```powershell
npm run h3:local
```

该命令验证本地页面是否完整使用 `h3`，并保存原始 JSON、截图和 NetLog。它用于协议排障，不进入正式 30 区组统计。

公网观察命令为：

```powershell
npm run h3
npm run h3:disable-quic
```

公网记录用于区分服务宣告、QUIC 会话尝试和页面最终协议。它不与本地性能数据放在同一坐标轴。

## 7 结果边界

本地实验适合观察 HTTP/1.1 连接槽排队，以及 HTTP/2、HTTP/3 在单连接上的并发流。回环路径没有注入 RTT、抖动或丢包，不能用来检验 TCP 跨流队头阻塞，也不能据此推断 QUIC 在公网或弱网中的性能收益。H3 到达 Nginx 后仍由 Nginx 通过 HTTP/1.1 访问 Node；实验比较的是浏览器到代理这一段的协议行为。
