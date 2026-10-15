# 计划：服务探测修复（上游缺陷）

**更新日期**：2026-10-15
**状态**：✅ 已修复并本地验证

---

## 症状

`bun run dev:desktop` 从源码启动，约 **120 秒后**报错：

```
Server process exited with code 1
Error: Managed service port 3084 on 0.0.0.0 is already in use by another process.
```

但此时**服务其实是好的** —— `http://127.0.0.1:3084/global/health` 返回 200，
`%APPDATA%\ai.opencode.desktop.dev\opencode\service-local.json` 已正确注册（pid + version + password 齐全）。

## 根因

**不是超时，不是竞争者池，是本机的 HTTP 代理。**

链路（每一步都在源码里核对过）：

1. 桌面端以 `--hostname 0.0.0.0` 启动 CLI（`packages/desktop/src/main/service/background-service.ts:57`，
   isolated 模式用固定端口 `0x0c0c` = 3084）；
2. CLI 启动前先探测在任服务：`packages/cli/src/server-process.ts:69-73` 调用 `Service.incumbent(...)`，
   传入的 URL 用**原始 hostname**（即 `0.0.0.0`）；
3. 探测经 `packages/client/src/service-probe.ts` 的 `probeResult()` 发 HTTP 请求；
4. `0.0.0.0` **不在 `NO_PROXY`** → 请求被交给代理 → 代理回 **502**；
5. 探测判定「不兼容」→ `incumbent` 返回 undefined → 输家等 15 秒后抛错并 **exit 1**；
6. 客户端 `reap()`（`packages/client/src/service-contender.ts:95`）只把 `exitCode === 0`
   当作「别人赢了」的良性退避 → 把这个 exit 1 记成致命失败。

延迟 ≈ `promiseTimeout: 120_000`。

## 修复

在唯一的探测入口做地址归一化 —— 通配地址绑定的服务本就在回环上可达：

```ts
// packages/client/src/service-probe.ts
export function reachableUrl(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.hostname === "0.0.0.0") parsed.hostname = "127.0.0.1"
  else if (parsed.hostname === "[::]" || parsed.hostname === "::") parsed.hostname = "[::1]"
  return parsed.toString()
}
```

一处修复同时覆盖 CLI 输家与桌面端客户端两侧。桌面端自己早就在 `background-service.ts:73`
做了同样的归一化，现在两边一致。

## 验证

**本地实测**（Windows，`bun 1.4.3`，本机环境）：

- 修复前：服务 120 秒后必然失败，从未进入 ready；
- 修复后：日志出现 `v2 CLI background service ready`，**耗时约 5 秒**，
  `url: 'http://127.0.0.1:3084'`（已归一化）。

**守护测试**：`packages/client/test/service-probe-url.test.ts`（7 例）覆盖
`0.0.0.0`/`[::]`/回环/局域网/保留路径/不可解析值。全部通过。

## 试过但无效的路径（勿重复）

| 尝试 | 结果 |
| --- | --- |
| 调大 `spawnDelay`（`OPENCODE_SERVICE_SPAWN_DELAY=90000`） | **无效**，已还原 |
| 重载 renderer（CDP `Page.reload`） | **无效** —— 失败在主进程，`SidecarCredentials.set` 从未执行 |
| 清理端口/注册文件后重启 | 无效，因为根因是代理 |

另外两个曾被我误判为根因的方向：**竞争者池的两个尝试**、**`spawnDelay` 过小**。
它们确实存在，但不是本次故障的原因。

## 活跃计划

- [ ] 决定是否随私有仓库固化（当前是本地工作区改动，未提交）
- [ ] 可选：向上游反馈（用户裁定私用，未计划提 PR）

## 完成记录

| 日期 | 成果 |
| --- | --- |
| 2026-10-14 | 定位代理根因；实现 `reachableUrl()`；dev 桌面端起死回生（120s 失败 → 5s 就绪） |
| 2026-10-15 | 补 7 例守护测试 |
