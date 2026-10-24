## Code Quality Restrictions

### When editing code

- Use red/green TDD when adding features or fixing issues.

- No over-engineering: no overly defensive design, no unnecessary implementation, and no features added without the maintainer's permission.

- No duplicate or unnecessary tests, but ensure at least one test passes before finishing a task.

- Minimize mocking; test under real conditions where viable, and ask the maintainer for keys or other information when needed.

- Think twice before creating or editing a Markdown file; avoid unnecessary text in both documents and the user interface.

- Always follow clean code principles.

### When exploring

- Be open-minded; feel free to explore different approaches.

### When reviewing code

- Do not adopt the author's mindset; keep asking whether each implementation is necessary.

- Do not hold back on the assumption that something "might be the maintainer's specific requirement"; point out anything you consider inappropriate.

### When asked for an implementation plan

- Think through the details and state the decisions you made in the final plan.

### When writing documents

- Be brief but informative: maximize information density while keeping the text readable and quick to understand.

### When asked to commit changes

- Split the edits into several smaller commits if necessary.

## Project overview

- Self-hosted RSS reader. The client is a fork of [Folo](https://github.com/RSSNext/Folo) (git remote `upstream`); the server is our own.
- `server/` – Rust (Axum + SeaORM + PostgreSQL) API server, all routes under `/api`; also serves the web build.
- Client monorepo managed by pnpm workspaces + Turbo:
  - `apps/desktop` – Electron app; its Vite + React renderer is also the web app
  - `apps/mobile` – React Native app via Expo
  - `packages/internal` – shared components, atoms, hooks, store, utils, database, etc.

## Setup commands

```bash
# Server (needs server/config.toml, see config.example.toml)
cd server && cargo run

# Client deps; pnpm is pinned in package.json, run it through corepack
corepack pnpm install

# Desktop – browser renderer (recommended)
cd apps/desktop && pnpm run dev:web
# Desktop – full Electron
cd apps/desktop && pnpm run dev:electron
# Mobile – Expo (or `pnpm run ios` / `pnpm run android`)
cd apps/mobile && pnpm run dev

# Build web version (desktop renderer)
pnpm run build:web
```

## Quality gates

- Client, at the root and in this order: `pnpm run typecheck` → `pnpm run lint:fix` → `pnpm run test`.
- Server: `cargo test` in `server/`.

## Code style and conventions

- TypeScript strict; avoid `any` (use precise types). Comments in English.
- Prefer CSS transitions/animations for simple UI interactions. Use JS-driven motion only when necessary to avoid frame drops.
- Imports: use `pathe` instead of `node:path` for cross‑platform paths.
- Organize shared, reusable UI in `packages/internal/components`; app-specific UI stays in its app.
- **Style extraction**: Avoid inline styles in JSX. Extract complex styles (especially those using CSS variables, gradients, or multiple properties) to external style objects similar to React Native's `StyleSheet.create`. Place style objects in a `styles.ts` file alongside the component, using `CSSProperties` type for type safety.

## Architecture quick reference

- State: Jotai for atoms, Zustand for complex stores, TanStack Query for server state.
- Database: Drizzle + SQLite (see `packages/internal/database`).
- Error handling: custom utils in `packages/internal/utils`.
- i18n: i18next with flat keys only; no `defaultValue`. Provide `en`, `zh-CN`, `ja` for each feature. Avoid conflicting dotted keys.

## UI system and design tokens

### Tailwind + Apple UIKit colors (Desktop/Web)

- Use Tailwind classes bound to Apple UIKit color tokens (light/dark adaptive). Prefix by CSS property:
  - System colors: `text-red`, `bg-blue`, `border-gray`, etc. for `red|orange|yellow|green|mint|teal|cyan|blue|indigo|purple|pink|brown|gray`.
  - Fill: `bg-fill[-secondary|-tertiary|-quaternary|-quinary]` and `bg-fill-vibrant[-secondary|-tertiary|-quaternary|-quinary]` (and `border-*` as needed).
  - Text: `text-text`, `text-text-secondary|tertiary|quaternary|quinary`, `text-text-vibrant(-secondary|-tertiary|-quaternary|-quinary)`.
  - Material: `bg-material-ultra-thick|thick|medium|thin|ultra-thin|opaque`.
  - Control: `bg-control-enabled|disabled`.
  - Interface: `bg-menu|popover|titlebar|sidebar|selection-focused|selection-focused-fill|selection-unfocused|selection-unfocused-fill|header-view|tooltip|under-window-background`.

These classes map to the UIKit color variables (see `apps/desktop/AGENTS.md`).

### Icons (Desktop/Web)

- Use the open-source MingCute set with the `i-mingcute-` prefix (e.g., `i-mingcute-copy-line`). Never use the proprietary MGC set (`i-mgc-`); Folo's license forbids redistributing it.

### Motion (Desktop/Web)

- Use Framer Motion with LazyMotion via `m` from `motion/react` (e.g., `m.div`).
- Prefer spring presets from `@follow/components/constants/spring.js` (`Spring.presets.smooth|snappy|bouncy`).
- For simple micro-interactions, prefer CSS transitions first.

### React Native (Mobile)

- Styling: NativewindCSS; do not use external `StyleSheet.create` for new UI.
- Icons: use `@/apps/mobile/icons` only.
- Colors: use React Native UIKit color system (via `react-native-uikit-colors`) with Tailwind utilities:
  - Backgrounds: `system-background`, `secondary-system-background`, `tertiary-system-background`.
  - Grouped backgrounds: `system-grouped-background`, `secondary-system-grouped-background`, `tertiary-system-grouped-background`.
  - Labels: `label`, `secondary-label`, `tertiary-label`, `quaternary-label`.
  - Fills: `system-fill`, `secondary-system-fill`, `tertiary-system-fill`, `quaternary-system-fill`.
  - Separators: `separator`, `opaque-separator`, `non-opaque-separator`.
  - Semantic colors: `red|orange|yellow|green|mint|teal|cyan|blue|indigo|purple|pink|brown`, grays `gray..gray6`, and interactive `link`, `placeholder-text`.

## Component placement

1. Check existing components in `apps/desktop/layer/renderer/src/modules/renderer/components` for app-specific UI.
2. If generic and reusable, implement in `packages/internal/components` and export from the package index.

## Testing

- Use Vitest for unit tests; co-locate tests near source files.
- After moving files or changing imports, run `pnpm lint` and `pnpm typecheck` for the affected package.

## Subproject guides

- Apps and packages may have their own `AGENTS.md` (e.g., `apps/desktop/AGENTS.md`, `apps/mobile/AGENTS.md`). The closest guide to the edited file takes precedence when rules conflict.