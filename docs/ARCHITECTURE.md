# Aegis 架构

## 目标

第三方 DSH 插件默认零权限运行；敏感操作在运行时向用户申请；不修改插件源码；没有版本/兼容豁免。

## 层

1. **加载门**：解析 profile 的 bundles 与 bundle patch insert；未批准的 bundle drop，未批准的 insert 在 cordis.patch.yml 写 managed disable。
2. **Native Cell**：第三方插件在 fork 的 Node 子进程里跑，--permission 只允许读自身目录；env 最小化；net/http/https/dns 在模块边界封死。
3. **Shim**：fetch、fs.promises.readFile/writeFile、回调 fs 转成 capability 请求；Broker 执行真实 I/O。
4. **Broker**：策略/审计/动态申请；fs.read/fs.write/net 由 Broker 执行；push 到 pending，等待用户决定（once/session/always）。
5. **审批 UI/CLI**：aegis pending/approve/deny/ui；127.0.0.1 + token；撤销/回收。
6. **策略**：内容哈希绑定；无 group；无版本分支；confused deputy 按调用者插件判定。

## 能力

fs.read, fs.write, net, exec, env, native, dynamic, tools, services, sessions, schedule, desktop, clipboard.

## 已知残余风险

- Node 24 的 --permission 不拦 net.connect（实测），所以由模块边界封堵；native addon/process.binding 仍可能绕过。
- 已批准代码在 Cell 内仍有 0day/资源耗尽风险；真正的 OS 沙盒（Windows Sandbox/WSL）用于高风险外部工具。
