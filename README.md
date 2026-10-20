# Yannr

自托管的个人 RSS 阅读器：Rust 服务端，加上 Web、桌面与移动客户端。

## 目录

- `server/`：Rust（Axum + SeaORM + PostgreSQL）API 服务，路由都在 `/api` 下，同时托管 Web 构建产物
- `apps/desktop`：Electron 桌面端，其 Vite + React 渲染进程也是 Web 版
- `apps/mobile`：Expo（React Native）移动端
- `packages/internal`：客户端共用的组件、状态、数据库与工具（`@follow/*`）

## 开发

```bash
# 服务端（需要 server/config.toml，参照 config.example.toml）
cd server && cargo run

# 客户端依赖；pnpm 版本已固定，通过 corepack 运行
corepack pnpm install

# Web（在浏览器中运行桌面端渲染进程）
cd apps/desktop && corepack pnpm run dev:web
# Electron
cd apps/desktop && corepack pnpm run dev:electron
# 移动端
cd apps/mobile && corepack pnpm run dev

# 构建 Web 版
corepack pnpm run build:web
```

- 客户端检查（仓库根目录，按顺序）：`corepack pnpm run typecheck` → `corepack pnpm run lint:fix` → `corepack pnpm run test`
- 服务端测试：在 `server/` 中运行 `cargo test`
- 应用图标：修改 `apps/desktop/layer/renderer/public/icon.svg` 后运行 `corepack pnpm run icons:app`

## 许可与致谢

AGPL-3.0，见 [LICENSE](LICENSE)；`icons/mgc` 中的图标版权归 [MingCute](https://mgc.mingcute.com/) 所有，不得再分发。客户端派生自 [Folo](https://github.com/RSSNext/Folo)（git remote `upstream`）。
