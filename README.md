# dsh-aegis

DSH 插件权限模型补齐（Aegis）：第三方插件默认进入零权限 Native Cell，所有敏感操作由 Broker 在运行时向用户申请，不修改插件源码。

## 安装

需要 DSH 的 plugin manager：

```powershell
dsh plugin --profile desktop add github:ZJ929-max/dsh-aegis
```

然后确保 profile 的 `dsh.profile.bundles` 含 `dsh-aegis`（部分 DSH 版本会在安装时自动加入；没有就手动加）。重启 DSH。

安装后：

```powershell
aegis scan
aegis check
aegis doctor
```

## 这个包包含什么

- `lib/`：能力表、策略库、审计链、profile 解析、加载门、审批队列/UI。
- `bootstrap/`：DSH 侧 Broker + 零权限 Cell host + 测试用插件。
- `bin/aegis.mjs`：CLI。
- `test/`：9 项 core + bootstrap/UI/env/net/fetch/fs/proc 回归。
- `cordis.patch.yml`：bundle 插入 `dsh-aegis/plugin`。

## 安全边界

- Aegis 是 DSH 的插件层，不装服务/驱动、不改注册表/防火墙、不建计划任务。
- Cell 是 DSH 子进程，父进程退出即自退；禁用/卸载后无驻留。
- Node 24 的 `--permission` 不拦 `net.connect`，所以 Cell 在模块边界封 `net/http/https/dns`；网络只能走 fetch shim → Broker。
- `native`/addon 仍可能绕过；高风险管理需要 OS 沙盒（Phase 4）。

## 开发

```powershell
node test/core.test.mjs
node test/bootstrap.test.mjs
node test/ui.test.mjs
```

License: MIT.
