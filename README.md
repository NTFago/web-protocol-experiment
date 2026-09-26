# HTTP 协议实验代码

本目录实现论文实验方案中的本地 HTTP/1.1、HTTP/2 对照，以及独立的 HTTP/3 观察。代码和产物均留在本目录，不会写入 `../web-dev`。

## 1 实验组成

- Node.js 应用固定产生 28 个测试请求：HTML、CSS、JavaScript、favicon 和 24 个 SVG。
- 每个 SVG 在服务端异步等待 100 ms 后返回，并记录 `run_id`、上游 socket 和峰值并发。
- Nginx 在 `127.0.0.1:8441` 提供 HTTP/1.1，在 `127.0.0.1:8442` 启用 HTTP/2。
- Playwright 每轮建立新浏览器上下文，通过 CDP 保存协议、连接编号、时序和首部。
- 汇总脚本生成 CSV；绘图脚本生成可直接查看的 SVG。
- HTTP/3 脚本单独记录公开测试页的协议、`Alt-Svc`、截图和 NetLog。

## 2 首次准备

在 PowerShell 中进入本目录。论文用图由 Python 绘制，除 Node.js 依赖外还需安装 Matplotlib：

```powershell
cd E:\project\homework\webdev\class1\web-protocol-experiment
npm install
npm run install:browser
npm run certs
python -m pip install -r requirements-plot.txt
```

`npm run certs` 生成仅用于本机实验的 `nginx/certs/localhost.crt` 和 `localhost.key`。私钥已被 `.gitignore` 排除，不应上传。

启动服务：

```powershell
npm run up
docker compose ps
```

停止服务：

```powershell
npm run down
```

## 3 正式实验前检查

先记录环境并运行 CDP 冒烟测试：

```powershell
npm run env
npm run smoke
```

成功时，冒烟输出应满足：

- H1 文档协议为 `http/1.1`；
- H2 文档协议为 `h2`；
- 每组 `requests=28`；
- H1 通常有多条浏览器连接，H2 通常为一条；
- `logs/cdp-smoke.json` 中两个结果的 `valid` 均为 `true`。

本机 curl 当前不支持 HTTP/2，因此 H2 以 Chromium/CDP 结果为准。

## 4 手工 DevTools 截图

以下命令使用 Playwright 安装的同一份 Chromium，并自动打开 DevTools：

```powershell
npm run devtools:h1
npm run devtools:h2
npm run devtools:public
```

也可自动捕获完整 DevTools 界面证据：

```powershell
npm run devtools:capture
```

该命令保存 H1、H2、公网页面和 HTTP/3 对照所需的 Network/Headers 截图，并生成 `logs/devtools-capture/capture-manifest.json`。

在 Network 面板勾选 `Disable cache`，显示 Protocol、Connection ID、Remote address、Initiator、Size、Time 和 Waterfall。Chrome 可能额外请求 `/.well-known/appspecific/com.chrome.devtools.json`；它不属于 28 个测试资源。

建议把原始截图保存到 `screenshots/manual-devtools/`。H1/H2 各导出一份代表性 HAR 到 `har/`。

## 5 自动采集

默认命令执行每组 5 次预热和 30 个随机顺序配对轮次：

```powershell
npm run collect
```

快速检查可减少轮次：

```powershell
node scripts/collect.mjs --pairs 2 --warmups 1 --seed 20260925
```

每轮原始 JSON 立即写入 `raw/h1/` 或 `raw/h2/`。随机顺序与 seed 保存在 `logs/run-order.json`，简要运行日志保存在 `logs/run-log.ndjson`。第一次有效的 H1、H2 运行会各保存一张整页截图和一份 HAR。

如果快速检查产生了测量文件，正式采集前先将这些测试文件移动到单独备份目录，避免与 30 对正式结果混合。不要覆盖已有原始 JSON。

## 6 汇总、验证和作图

```powershell
npm run verify
npm run analyze
npm run serverlog:summary
npm run netlog:summary
```

输出包括：

- `processed/runs.csv`
- `processed/requests.csv`
- `processed/paired-differences.csv`
- `processed/summary.csv`
- `figures/load-distribution.svg`
- `figures/resource-span-distribution.svg`
- `figures/lcp-distribution.svg`
- `figures/connection-count.svg`
- `figures/paired-load-difference.svg`
- `figures/paper-main-results.pdf`：主要指标的分组柱状图，中位数附 IQR；
- `figures/paper-paired-rounds.pdf`：30 组配对轮次的 H1/H2 折线图。

`verify` 遇到无效运行会返回非零状态，并打印原因；原始文件不会被删除。`summarize` 只用 `valid=true` 的运行计算组内统计和配对差值。

仓库保留本次正式实验的原始 JSON、汇总表、截图、HAR、脱敏 NetLog 和校验日志。`node_modules` 与本地 TLS 私钥不会提交。

## 7 HTTP/3 观察

默认模式在同一浏览器上下文访问三次：

```powershell
npm run h3
```

主动禁用 QUIC 的对照：

```powershell
npm run h3:disable-quic
```

结果写入：

- `raw/h3-observation/`
- `screenshots/automated/`
- `netlog/`

自动截图只能证明页面外观，论文中仍应补一张带 Protocol 列的手工 DevTools 截图。NetLog 即使采用默认脱敏模式也会包含域名、URL 和网络环境信息，提交前应检查。本目录提供 `npm run netlog:sanitize` 和 `npm run privacy:audit`；前者只净化 Wayback 自定义响应首部中的历史 Cookie 值，后者检查 HAR 与 NetLog 是否仍含未脱敏敏感首部。

## 8 日志与证据

查看容器日志：

```powershell
docker compose logs --no-color | Tee-Object -FilePath logs\compose-logs.txt
docker compose exec nginx nginx -T 2>&1 | Tee-Object -FilePath logs\nginx-config.txt
```

Node 日志中的 `active_svg_requests` 与 `peak_active_svg_requests` 用于核对并发；`upstream_socket` 用于观察 Nginx 到 Node 的 HTTP/1.1 连接。Nginx JSON 日志同时记录客户端协议、连接编号、请求耗时和上游连接耗时。

## 9 结果边界

本地实验测量浏览器连接槽排队和 HTTP/2 多路复用。它没有受控数据包丢失，不能据此验证 HTTP/2 的 TCP 跨流队头阻塞，也不能与公网 HTTP/3 页面直接比较性能。
