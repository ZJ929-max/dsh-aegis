# 分发方式

Aegis 是一个普通的 DSH 插件包：一个 GitHub 仓库 + 一个 npm 风格的 package.json。

## 包长什么样

```text
dsh-aegis/
  package.json          name=dsh-aegis, dsh.bundle.patch -> ./cordis.patch.yml
  cordis.patch.yml      insert: id=aegis-bootstrap, name=dsh-aegis/plugin
  bootstrap/            Broker + Cell host + 测试插件
  lib/                  策略/解析/加载门/审批/UI
  bin/aegis.mjs         CLI
  test/                 回归测试
  docs/                 架构与分发说明
  .github/workflows/    CI
```

安装后落在 profile 的 node_modules/dsh-aegis；DSH 启动时读到 bundle 的 patch，
插入 dsh-aegis/plugin（同一个包的子路径），再执行 bootstrap/index.js 的 apply。

## 三种渠道

1. GitHub 直接安装（推荐）

```powershell
dsh plugin --profile desktop add github:ZJ929-max/dsh-aegis#v0.1.0
```

pnpm 会把仓库装进 `~/.dsh/profiles/desktop/node_modules/dsh-aegis`。
然后把 `dsh-aegis` 加进该 profile 的 `dsh.profile.bundles`（或跑 scripts/install.ps1）。

2. GitHub Release 的 tgz

```powershell
dsh plugin --profile desktop add https://github.com/ZJ929-max/dsh-aegis/releases/download/v0.1.0/dsh-aegis-0.1.0.tgz
```

3. npm（需要 npm token，尚未发布）

```powershell
dsh plugin --profile desktop add dsh-aegis
```

## 安装 ≠ 启用

`dsh plugin add` 只把包放进 node_modules；DSH 只加载 `dsh.profile.bundles` 里列出的 bundle。
所以还要把 `dsh-aegis` 加进 bundles，重启 DSH 才生效。这与“装上就有权限”是相反的设计。

## 不随包分发的东西

- `~/.dsh/aegis/policy.json` / 审计 / pending：这是每个用户的本地授权状态；
- staging 用的 aegis-test / aegis-headless / aegis-accept profile；
- EigenFlux 的二进制；
- 任何 API key / 凭据。

## 验收

安装后：

```powershell
aegis doctor
```

应显示 profile 存在、策略链 ok、外部工具哈希、沙盒后端列表。
