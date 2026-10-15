# 计划：环境与工具链

**更新日期**：2026-10-15

本机：Windows，PowerShell 5.1 为默认 shell，**有 HTTP 代理**（见下，这是多个故障的根源）。
所有路径与版本均为本机本地实测。

---

## 已就绪

| 组件 | 位置 / 值 | 备注 |
| --- | --- | --- |
| Go 1.25.14 | `C:\Users\28974\.local\go\bin` | 已入用户 PATH；`GOPROXY=https://goproxy.cn,direct`、`GOTOOLCHAIN=local` |
| Bun 1.4.3（全局） | `%APPDATA%\npm\node_modules\bun\bin\bun.exe` | **需降到 1.4.2**，见下 |
| Bun 1.4.2（隔离） | `C:\Users\28974\.local\bun142\node_modules\bun\bin\bun.exe` | 跑测试用 |
| Electron 44.4.5 | `packages/desktop/node_modules/electron/dist` | `bun install` 不下载，需手动装 |
| ripgrep 15.1.0 / fzf 0.74.4 | 已入用户 PATH | Go 版 TUI 的依赖 |
| sst/opencode v2.0.28 | `C:\Users\28974\sst-opencode` | 依赖 2132 包 |

## 网络环境（重要）

```
HTTP_PROXY = http://127.0.0.1:7897
NO_PROXY   = localhost,127.0.0.1,::1        ← 不含 0.0.0.0
```

- `go.dev` 不可达（`winget install GoLang.Go` 报 `0x80072f19`）→ 走 `mirrors.aliyun.com/golang`
- GitHub Releases **可达**（fzf 即从 GitHub 装上）
- npm registry 可达
- **`0.0.0.0` 不在 NO_PROXY**，对它发请求会被代理拦截并返回 502 —— 这是服务探测缺陷的根因

验证方式（本地实测）：对绑定在 `0.0.0.0` 的本地监听发请求，
`127.0.0.1` 返回 200、`localhost` 返回 200、`0.0.0.0` 返回 **502**。

---

## 活跃计划

- [ ] **全局 bun 降到 1.4.2**（仓库 `packageManager` 锁定值）。阻塞原因：dev 桌面端占用 `bun.exe`，
      Windows 上替换会失败，需先关桌面端。
- [ ] 决定符号链接工作区方案（见下）

## 已知陷阱

### bun 1.4.3 与 app 单测不兼容

用 1.4.3 跑 `packages/app` 测试会全部失败：`SyntaxError: Export named 'jsxDEV' not found`。
已用 `git stash` 证明未修改文件同样失败。`--conditions=solid` / `browser` / `NODE_ENV=development` 均无效。
**解法**：用 1.4.2。跑法 `& $bun142 test --conditions=solid --preload ./happydom.ts ./src`。

### git 符号链接在 Windows 被检出成普通文件

仓库有 **57 个** mode `120000` 的符号链接。本机 `core.symlinks=false` 且建链接需管理员权限，
它们全被检出成**内容为链接目标路径的文本文件**。其中 2 个会直接打断 typecheck：

- `packages/app/src/custom-elements.d.ts`
- `packages/enterprise/src/custom-elements.d.ts`

报错形如 `error TS1128: Declaration or statement expected`。
**已处理**：用真实内容覆盖 + `git update-index --skip-worktree`，使 `git status` 保持干净。
**升级或重新 clone 后要重做。**

### Bun 的 Windows spawn 陷阱

`npm i -g bun` 只在 `%APPDATA%\npm` 生成 `.cmd`/`.ps1` shim，**没有 `bun.exe`**。
Electron 主进程 `spawn("bun")` 走 Win32 CreateProcess，不执行 `.cmd`，报 `spawn bun ENOENT`。
**解法**：把 `%APPDATA%\npm\node_modules\bun\bin` 加入用户 PATH（已做）。

### 桌面端 dev 崩溃会留下孤儿服务进程

dev 桌面端崩溃时，它 spawn 的 CLI 服务进程**不会自动退出**，会继续占用端口 3084，
导致下次启动报 `Managed service port 3084 already in use`。
**诊断**：确认占用者命令行是否含 `sst-opencode\packages\cli`；是则清掉。

### `| Select-Object -Last N` 会缓冲长命令全部输出

用它包住长命令后，进程结束前看不到任何进度。排查长时间任务时不要这样包。

### 浅克隆无法推送到新仓库

用 `--depth N` 克隆的仓库推送时会失败：

```
remote: fatal: did not receive expected object <sha>
error: remote unpack failed: index-pack failed
```

原因：浅克隆在边界处缺少历史对象，接收端在校验对象图时拿不到。
**解法**：先 `git fetch --unshallow <remote>` 补全历史再推。
本仓库补全后为 20354 提交（`.git` 体积见下）。

### `git push` 会触发 husky 的 pre-push 钩子

本仓库 `.husky/` 配了 pre-push，会跑完整的 `bun run check`（36 个包 typecheck，约 1 分钟）。
推送失败时容易误判为"推送本身出错"，实际是钩子先跑了一遍校验。

---

## 完成记录

| 日期 | 成果 |
| --- | --- |
| 2026-10-13 | Go 工具链、Bun、Electron、rg/fzf 就位；goproxy 与镜像源配置完成 |
| 2026-10-14 | 定位 `spawn bun ENOENT` 与符号链接两个陷阱并修复 |
| 2026-10-15 | 查明 bun 1.4.3 是 app 单测失败的原因；隔离安装 1.4.2 |
