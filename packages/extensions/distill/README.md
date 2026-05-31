# Distill

> Development plan - please review and provide feedback before implementation begins.

## Overview

**Distill** is a capability-exercise extension. It has no real functionality - its
sole purpose is to register one entry in **every UI hook the Nimbalyst extension
SDK exposes**, so we can see at a glance where extensions can place visible
content and verify all the seams light up.

Wherever the SDK lets an extension display a label, button, panel, header, file
type, slash command, theme, or transcript widget, the word **"Distill"** should
appear.

## UI Hooks Catalog (from `ExtensionContributions`)

Below is every contribution surface I found in
`packages/extension-sdk/src/types/extension.ts` and the related panel/runtime
APIs. Each row is what the Distill extension will register.

### Manifest contributions

| # | Hook | What Distill will register | Where it shows in the UI |
|---|------|---------------------------|--------------------------|
| 1 | `name` | `"Distill"` | Extensions list, marketplace card |
| 2 | `marketplace.tagline` / `longDescription` / `highlights` | All mention "Distill" | Marketplace detail view |
| 3 | `newFileMenu` | `.distill` -> "Distill File" | File tree > New File menu |
| 4 | `customEditors` | Editor for `*.distill`, displayName "Distill Editor" | Tab title + editor area |
| 5 | `fileIcons` | `*.distill` -> material icon (e.g. `science`) | File tree icon |
| 6 | `commands` | `com.nimbalyst.distill.say-distill` titled "Distill: Say Distill" | Command palette (if surfaced) |
| 7 | `keybindings` | `ctrl+shift+d` -> Distill panel toggle | Keyboard shortcut |
| 8 | `slashCommands` | `/distill` slash command (AI chat) | Slash menu in AI chat |
| 9 | `panels` (sidebar) | "Distill" sidebar panel | Left gutter + sidebar |
| 10 | `panels` (bottom) | "Distill" bottom panel | Bottom panel + bottom gutter |
| 11 | `panels` (fullscreen) | "Distill" fullscreen panel | Main content takeover |
| 12 | `panels` (floating) | "Distill" floating panel | App-level modal |
| 13 | `settingsPanel` | "Distill" settings entry | Settings > Extensions |
| 14 | `documentHeaders` | Header for `*.distill` (and maybe `*.md`?) saying "Distill" | Above the editor |
| 15 | `themes` | A "Distill" theme | Theme picker |
| 16 | `aiTools` | `distill.echo` tool that returns "Distill" | AI agent tools list |
| 17 | `hostComponents` | A small "Distill" corner badge | Persistent app-level overlay |
| 18 | `lexicalExtensions` (declarative) | Empty no-op extension named "Distill" | Editor extension graph (invisible but registered) |
| 19 | `configuration` | A "Distill greeting" string setting | Extension settings UI |

### Runtime contribution APIs (from `@nimbalyst/runtime`)

| # | Hook | What Distill will register | Where it shows in the UI |
|---|------|---------------------------|--------------------------|
| 20 | `setExtensionContributions().userCommands` | "Distill" entry in the markdown slash picker | `/` menu inside Lexical editor |
| 21 | `setExtensionContributions().markdownTransformers` | (likely skip - no Lexical node to ship) | n/a |
| 22 | `setTranscriptMarkdownContributions().components.code` | Render fenced ` ```distill ` blocks as a "Distill" widget | AI transcript |
| 23 | `setTranscriptMarkdownContributions().styles` | A small badge style added to transcript | AI transcript |
| 24 | `diffHandlerRegistry.register()` | (skip - we ship no custom Lexical node) | n/a |

### Other surfaces I intentionally won't touch

- `backendModules` - requires permission flow + isolated runtime. Out of scope for a "label everywhere" exercise.
- `claudePlugin` / `agentWorkflows` - require backing markdown directories and would inflate scope.
- `transformers` / `nodes` - need real Lexical nodes; the simpler `userCommands` already covers the slash menu surface.

## Open Questions

1. **Scope check** - Do you want me to add `backendModules` / `claudePlugin` /
   `agentWorkflows` too? They require more scaffolding (permission prompts,
   plugin directories) but they ARE UI hooks. Default: **skip** them for v0.1.
2. **`hostComponents`** - I'd render a tiny non-intrusive "Distill" badge in
   a corner. Acceptable, or should it be invisible / behind a toggle?
3. **`*.distill` files** - The custom editor will just be a centered "Distill"
   text. Want me to make it editable (round-trip a single-line file) or
   purely read-only?
4. **Keybinding choice** - `ctrl+shift+d` is unused in built-ins as far as I
   can tell, but please confirm or pick another combo.
5. **Theme** - Should the "Distill" theme be a noticeable purple/teal variant,
   or just a minimal tweak of the default dark theme?
6. **AI tool** - The `distill.echo` tool returns the string "Distill". Want
   it to do anything more (e.g. echo back its input wrapped in "Distill: ...")?

## Proposed Features

### Core (v0.1.0) - the capabilities exercise
- [ ] Manifest entries for all rows 1-19 above
- [ ] Runtime registrations for rows 20, 22, 23 inside `activate()` and a `hostComponent`
- [ ] Minimal, ugly-but-functional UI for each panel / editor / header / badge
- [ ] One screenshot of each surface for the inevitable "did it actually appear" check

### Nice to have (future)
- [ ] Backend module that exports a "Distill" function
- [ ] Claude Code plugin directory with a `/distill` slash command
- [ ] Agent workflow with a "distill" skill

## Technical Approach

### File layout

```
packages/extensions/distill/
  manifest.json
  package.json
  tsconfig.json
  vite.config.ts
  README.md                 (this file)
  src/
    index.tsx               (entry: components, panels, settingsPanel,
                             hostComponents, slashCommandHandlers, aiTools,
                             lexicalExtensions, activate/deactivate)
    DistillEditor.tsx       (custom editor for *.distill)
    DistillHeader.tsx       (document header)
    DistillSidebarPanel.tsx
    DistillBottomPanel.tsx
    DistillFullscreenPanel.tsx
    DistillFloatingPanel.tsx
    DistillSettings.tsx     (settingsPanel + maybe panel settingsComponent)
    DistillBadge.tsx        (hostComponent corner badge)
    TranscriptDistillHost.tsx  (registers transcript markdown contribution)
    lexical.ts              (no-op LexicalExtension "DistillLexicalExtension")
    aiTools.ts              (`distill.echo` handler)
    styles.css              (theme variables, badge styling)
```

### Activation flow

`activate()` does the imperative registrations:
- `setExtensionContributions(EXT_ID, { userCommands: [...] })` for the markdown slash picker
- Subscribes nothing else (transcript contributions are owned by `TranscriptDistillHost` as a `hostComponent` for clean cleanup)

`deactivate()`:
- Calls `clearTranscriptMarkdownContributions(EXT_ID)` if not already mounted host-side.

### Diff / source mode

Custom editor opts **out** of source mode and diff mode - this is a label
demo, not a real editor.

## Implementation Checklist (post-approval)

### Phase 1: Manifest wiring
- [ ] Fill in `contributions` block with all 19 manifest hooks
- [ ] Add `marketplace` metadata so the extension renders nicely in the marketplace
- [ ] Wire `permissions` (probably empty - we don't need filesystem/ai/network)
- [ ] Add a `screenshots/` placeholder so manifest references don't 404

### Phase 2: Component implementations
- [ ] `DistillEditor` using `useEditorLifecycle` (read-only, just shows "Distill")
- [ ] `DistillHeader`, four panels, settings panel, badge - all are basically "centered text + Distill"
- [ ] `DistillBadge` rendered via `hostComponents`

### Phase 3: AI + runtime hooks
- [ ] `distill.echo` AI tool
- [ ] `TranscriptDistillHost` registers transcript markdown contributions on mount
- [ ] `setExtensionContributions` for the markdown editor slash menu inside `activate()`
- [ ] No-op `DistillLexicalExtension` exported

### Phase 4: Verification
- [ ] Run `mcp__nimbalyst-extension-dev__extension_install` and `extension_reload`
- [ ] Open each surface manually (or via Playwright if quick) and confirm "Distill" appears
- [ ] Add `screenshots/` and update marketplace metadata

## Next Steps

Please review and let me know:
1. Are the 19+ surfaces above the right scope, or do you want me to add
   the deferred ones (`backendModules`, `claudePlugin`, `agentWorkflows`)?
2. Answers to the Open Questions block
3. "Approved" / "proceed" when ready

I will NOT write any implementation code until you confirm.
