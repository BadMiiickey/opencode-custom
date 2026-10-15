# 参考报告：Windows 上的"信号语义"替代方案

**日期**：2026-10-15
**触发**：Q-3 排查发现 17 项 client 测试失败源于 Windows 无信号投递语义；用户要求调研开源项目是否存在 Windows 上的等价实现。

---

## 一、核心问题

`packages/client` 有 17 项测试在 Windows 上失败，形态是：

- `expect(await x.exited).toBe(0)` → 实收 `1`
- `.signal` 文件断言失败（该文件从未写出）
- `Timed out waiting for …service.json.unregistered`

共同前提是：被终止的进程里 `process.on("SIGTERM", …)` 处理器会执行并写文件。
在 Windows 上它**永不执行**。

问题：Windows 上是否存在能达到同等效果的做法？

---

## 二、关键结论

**结论 1：Windows 上信号确实不可用（Node 官方文档，原文引用）**

> `'SIGTERM'` **is not supported on Windows**, it can be listened on.
> `'SIGINT'` from the terminal **is supported on all platforms**, and can usually be generated with Ctrl+C.
> `'SIGHUP'` is generated on Windows when the console window is closed, … however **Node.js will be unconditionally terminated by Windows about 10 seconds later**.

来源：Node.js v26.12.0 文档 `process.html#signal-events`。
含义：`SIGTERM` 只能"挂监听"，操作系统**从不投递**它。
`process.kill(pid, "SIGTERM")` 在 Windows 上等价于强制终止，JS 处理器没有机会运行。

**结论 2：本仓库里已经存在一个跨平台可用的优雅停机通道 —— 注册文件接管**

`packages/cli/src/services/service-registration.ts:40-66`：

服务启动时写入注册文件，随后**每 5 秒轮询**该文件（`Effect.repeat(Schedule.spaced("5 seconds"))`）。
一旦发现文件已不属于自己（被替换或删除），就记录 `managed service registration replaced; shutting down`
并打开停机 latch（`:65` 的 `options.shutdown`），服务**优雅退出**。

**这条路径不依赖任何信号，在 Windows 上完全可用。** 这是本报告最重要的发现。

**结论 3：`stop()` 没有使用它，而且顺序是反的**

`packages/client/src/promise/service.ts` 的 `terminate()`：

```
156  signal(info.pid, "SIGTERM")                     ← Windows 上=硬杀
159  if (!(await waitUntilStopped(...))) { 160 signal(pid,"SIGKILL") }
165  await rm(registrationFile)                      ← 进程已死后才删注册文件
```

注册文件是在**确认进程停止之后**才删除的。而优雅通道要求**先**移除注册文件、再等进程自行退出。
顺序反过来，优雅路径永远不会被触发。升级到 `SIGKILL` 也成了死代码（第一发就已杀死）。

**结论 4：这个缺陷不止影响 Windows**

全仓搜索非测试代码里的 SIGTERM 处理器，结果只有：

| 位置 | 性质 |
| --- | --- |
| `packages/desktop/src/main/lifecycle/index.ts:146` | **Electron 主进程**，不是服务端 |
| `packages/core/script/test.ts:47` | 测试运行器自身 |
| `packages/app/e2e/performance/*` | 性能测试夹具 |

**CLI 服务端从未安装 SIGTERM 处理器。** 所以在 Linux 上 `SIGTERM` 也走默认终止，
优雅路径同样不会被走。真正打开停机 latch 的只有"注册文件被接管"这一条路。

---

## 三、技术原理

### 3.1 为什么 Windows 没有等价信号

POSIX 信号是内核提供的异步通知。Windows 的对等物是**控制台事件**
（`CTRL_C_EVENT` / `CTRL_BREAK_EVENT`，经 `GenerateConsoleCtrlEvent` 投递）
与**窗口消息**（`WM_CLOSE` 等）。

Node 只把控制台事件映射到 `SIGINT` / `SIGBREAK`，**没有映射 `SIGTERM`**。
且 Node 未公开投递控制台事件的 API —— 需要原生扩展或外部工具。

### 3.2 开源界的通行做法：用显式控制通道，而非信号

跨平台项目普遍避免依赖信号，改用一条显式的、进程间可达的通道：

| 做法 | 例子 | 特点 |
| --- | --- | --- |
| **IPC 消息** | `child_process.fork` + `child.send()` | 仅限父子进程，需 fork 时带 IPC |
| **协议消息** | LSP 的 `shutdown`/`exit` 请求 | 已有 RPC 通道时最自然 |
| **控制端点** | systemd 的 `sd_notify`、各类 daemon 的 HTTP `/shutdown` | 跨机器也可用，但需鉴权 |
| **文件/sentinel 轮询** | **本仓库的注册文件接管** | 无需额外通道，代价是轮询延迟 |
| 原生调用 `GenerateConsoleCtrlEvent` | 需 `koffi`/`ffi-napi` | 引入原生依赖，收益有限 |

**本仓库已属于第四种**，且实现完整 —— 缺的只是调用方没有用它。

---

## 四、对本项目决策的影响

### 4.1 建议的产品改动（收益覆盖所有平台）

调整 `terminate()` 的顺序，让优雅通道先跑：

1. **先**删除（或替换）注册文件 → 服务端在 **≤5 秒**内自行优雅退出
2. 等待进程退出，超时给到 5 秒轮询之上（例如 10 秒）
3. 仍未退出才 `SIGTERM` → 再 `SIGKILL` 逐级升级

这同时修好两件事：Windows 上的优雅停机，以及所有平台上"根本没走优雅路径"的问题。
**代价**：停机延迟从"立即"变为最多约 5 秒（受轮询周期约束）。
若嫌慢，可考虑把轮询周期做成可配置 —— 但那属于性能调优，不是正确性问题。

### 4.2 对那 17 项测试的影响

**必须区分两个不同的东西**：

- 测试**夹具**（`packages/client/test/fixture/service.ts:108`）自己安装了
  `process.on("SIGTERM", …)` 并写 `.signal` 文件 —— 这是**夹具模拟的行为**；
- **真实服务**用的是注册文件接管。

所以在 Windows 上，这 17 项**无法靠改产品代码通过**，因为夹具期望的通道
（SIGTERM 处理器）在 Windows 上不可能被触发。

两条路：

| 选项 | 做法 | 评价 |
| --- | --- | --- |
| A（建议） | 夹具改为模拟真实的停机通道（响应注册文件变化），并同步改 `stop()` 顺序 | 测试从此检验**真实**契约；17 项在 Windows 上可过 |
| B | `skipIf(win32)` | 仓库已有 2 处先例，但会永久放弃 Windows 上的停机覆盖 |

**注意**：选项 A 会让测试比现在**更强**，因为现在测的是一个产品从未走过的通道。

---

## 五、来源

- Node.js v26.12.0 文档，`process.html#signal-events`
  （`SIGTERM` / `SIGINT` / `SIGHUP` 在 Windows 的行为，本报告第二节结论 1 为原文引用）
- `packages/cli/src/services/service-registration.ts:40-66`（注册文件接管与停机 latch）
- `packages/client/src/promise/service.ts:103-166`（`stop` / `terminate` / `signal` / `waitUntilStopped`）
- `packages/desktop/src/main/lifecycle/index.ts:145-146`（Electron 主进程的信号处理，作为对照）
- 全仓 SIGTERM 搜索结果（结论 4）

### 未亲测的部分

- 注册文件接管在真实 Windows 环境下的端到端优雅停机**未实测**。以上是对源码的静态分析；
  轮询周期 5 秒与停机延迟的关系由 `Schedule.spaced("5 seconds")` 推出，未经运行时验证。
- 第四节 4.1 的改动建议**未实施**，也未评估对其他调用方（桌面端、TUI）的影响。
