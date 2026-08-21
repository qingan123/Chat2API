# Chat2API Fork 开发与上游维护指南

本仓库 `qingan123/Chat2API` 以 `pyf-feifei/Chat2API` 为功能基线，并保留 `xiaoY233/Chat2API` 作为官方对比源。本文用于后续维护、上游同步、冲突处理、测试和生产更新。

## 1. 仓库关系

| 名称 | 仓库 | 用途 |
|---|---|---|
| `origin` | `qingan123/Chat2API` | 用户自己的生产与开发仓库 |
| `py-upstream` | `pyf-feifei/Chat2API` | 日常功能基线，包含原生 WebUI、Docker/Node 服务端和 Qwen 增强 |
| `official` | `xiaoY233/Chat2API` | 官方基线，用于检查新功能、安全修复和上游差异 |

生产服务器只能部署或更新 `origin/main`。不要让生产更新脚本直接覆盖为 `official/main`，否则会丢失 WebUI、服务器运行模式、管理员账号登录和本仓库脚本。

## 2. 首次配置远程

```bash
git remote set-url origin https://github.com/qingan123/Chat2API.git
git remote remove py-upstream 2>/dev/null || true
git remote add py-upstream https://github.com/pyf-feifei/Chat2API.git
git remote remove official 2>/dev/null || true
git remote add official https://github.com/xiaoY233/Chat2API.git
git fetch --all --prune
git remote -v
```

## 3. 每次维护前先比较

```bash
git checkout main
git pull --ff-only origin main
git fetch --all --prune
```

### 3.1 本仓库与 Py 上游

```bash
git log --left-right --cherry-pick --oneline main...py-upstream/main
git diff --stat main...py-upstream/main
git diff --name-status main...py-upstream/main
```

### 3.2 官方与 Py 上游

```bash
git log --left-right --cherry-pick --oneline official/main...py-upstream/main
git diff --stat official/main...py-upstream/main
git diff --name-status official/main...py-upstream/main
```

### 3.3 判断官方更新是否已被 Py 吸收

```bash
git log --oneline py-upstream/main..official/main
git log --oneline official/main..py-upstream/main
```

- 第一条有输出：官方存在 Py 尚未吸收的提交，需要逐项审查。
- 第二条有输出：Py 有官方没有的增强，这是正常情况。
- 不要只看 `package.json` 中的版本号；必须看提交关系和源码差异。

## 4. 同步 Py 上游的标准流程

不要直接在 `main` 上实验。先创建维护分支和备份标签：

```bash
git checkout main
git pull --ff-only origin main
git tag -a "backup-before-py-sync-$(date +%Y%m%d)" -m "Backup before Py upstream sync"
git checkout -b "maintenance/py-sync-$(date +%Y%m%d)"
git merge --no-commit --no-ff py-upstream/main
```

### 无冲突

检查差异后提交：

```bash
git diff --check
git status --short
git commit -m "chore: sync py upstream"
```

### 有冲突

1. 不要运行 `git checkout --theirs .` 或强制覆盖。
2. 逐个解决冲突，优先保留 Py 业务更新。
3. 本仓库以下定制必须保留：
   - `scripts/install-fork.sh`
   - `scripts/install-official.sh`
   - `scripts/update.sh`
   - `docs/MAINTENANCE_CN.md`
   - README 最前面的部署区块
   - `CHAT2API_ADMIN_USERNAME` 管理员账号校验
   - WebUI 中文管理员账号/密码登录页
4. 解决后执行完整测试门禁。

放弃本次合并：

```bash
git merge --abort
git checkout main
```

## 5. 官方出现新更新时怎么处理

先确认 Py 是否已经合并官方更新。若 Py 已吸收，优先按第 4 节同步 Py，不需要再单独合并官方。

若 Py 尚未吸收官方的重要修复：

```bash
git checkout main
git pull --ff-only origin main
git checkout -b "maintenance/official-review-$(date +%Y%m%d)"
git log --oneline py-upstream/main..official/main
git diff py-upstream/main...official/main -- src package.json package-lock.json
```

推荐策略：

1. 对独立、明确的修复，使用 `git cherry-pick <官方提交>`。
2. 对范围较大的官方版本升级，先在维护分支合并，再解决与 Py 增强的冲突。
3. 不要把 `official/main` 强制重置到本仓库 `main`。
4. 完成后把结果贡献给 Py 上游或记录本仓库为什么单独保留。

## 6. 高风险冲突区域

同步时重点审查：

- `package.json`、`package-lock.json`
- `Dockerfile`、`docker-compose.yml`
- `src/server/`
- `src/main/runtime/`
- `src/main/store/store.ts` 和 `src/main/store/storage/`
- `src/main/proxy/server.ts`
- `src/main/proxy/middleware/managementAuth.ts`
- `src/main/proxy/adapters/qwen-ai*`
- `src/main/proxy/qwenAi*`
- `src/main/proxy/toolCalling/`
- `src/renderer/src/web-admin-api.ts`
- `src/renderer/src/web-main.tsx`
- `vite.admin.config.ts`、`vite.server.config.ts`
- 三套部署/更新脚本和 README 顶部部署区块

## 7. 合并后的测试门禁

### 7.1 基础检查

```bash
npm ci
bash -n scripts/install-fork.sh scripts/install-official.sh scripts/update.sh
git diff --check -- scripts src tests docs README.md README_CN.md
```

### 7.2 服务端和 WebUI

```bash
npm run build:server
node --test \
  tests/server/web-admin-electron-api-contract.test.mjs \
  tests/server/bootstrap-config.test.mjs \
  tests/server/node-runtime.test.mjs \
  tests/server/admin-page-assets.test.mjs
```

上游提供完整服务端套件时，再执行：

```bash
npm run test:server-compat
```

### 7.3 依赖安全审计

```bash
npm audit
```

审计报告需要逐项评估。不要未经验证运行 `npm audit fix --force`，它可能升级 Electron/Vite 等关键依赖并造成破坏性变化。

### 7.4 必做运行验收

在隔离端口部署，至少验证：

1. `/health` 返回 `status=running`。
2. `/admin/` 正常加载静态资源。
3. 错误管理员账号返回 401。
4. 正确管理员账号和密码可以登录。
5. 未携带 API Key 的 `/v1/models` 返回 401。
6. 正确 API Key 的 `/v1/models` 返回 200。
7. 后台修改一项非敏感设置后刷新仍然保留。
8. 容器重启后账号、配置和 API Key 保留。
9. 桌面和移动浏览器页面无阻断性错误。
10. 若改动 Qwen 或工具调用，使用真实账号和客户端完成多轮、工具调用、流式和失败恢复测试。

## 8. 发布流程

```bash
git status --short
git log --oneline --decorate -5
git push -u origin HEAD
```

通过 GitHub PR 审查并确保测试通过后再合入 `main`。合入后核对：

```bash
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

生产实例最后才运行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/qingan123/Chat2API/main/scripts/update.sh)
```

更新脚本只快进拉取对应实例的仓库 `main`，更新前备份数据、运行环境和凭据；构建或验收失败会尝试恢复旧镜像和数据。

## 9. 回滚

### 代码回滚

查找备份标签：

```bash
git tag --list 'backup-*' --sort=-creatordate
```

从标签创建恢复分支，不要直接强推：

```bash
git checkout -b recovery/<说明> <备份标签>
```

### 服务器回滚

更新脚本会输出备份目录，通常位于：

```text
/opt/chat2api-<端口>/backups/update-<UTC时间>/
```

保留内容包括数据目录、运行环境、API Key、管理员账号文件和部署元数据。不要删除最近一次成功更新前的备份，直到真实流量验收完成。

## 10. 本仓库部署模型

- `install-fork.sh`：部署 `qingan123/Chat2API`，用于生产。
- `install-official.sh`：文件名为兼容旧命令而保留，实际部署 `pyf-feifei/Chat2API` 上游版，用于对照测试。
- `update.sh`：发现上述两类 WebUI 实例，按编号或端口选择并安全更新。
- 纯官方 `xiaoY233/Chat2API` 是 Electron 桌面基线，不由这三套 WebUI 服务器脚本直接部署。
