# Palette to OpenChamber Theme

This workflow lets you manage a small semantic palette and generate full OpenChamber theme JSON files from it.

## Files

- Palette schema example: `scripts/themes/palettes/example.json`
- Converter script: `scripts/themes/palettes/palette-to-theme.cjs`

## Quick visual map

- **Buttons / interactive focus**
  - `shared.accentPrimary`: primary buttons, focused controls, active toggles
  - `shared.accentSecondary`: secondary actions, links, selected tabs
  - `shared.accentTertiary`: tertiary badges and extra accent points

- **Text**
  - `<variant>.neutral.text`: main readable text
  - `<variant>.neutral.textMuted`: secondary descriptions and helper text
  - `<variant>.neutral.textDim`: timestamps, placeholders, disabled labels

- **Backgrounds / surfaces**
  - `<variant>.neutral.canvas`: full app background
  - `<variant>.neutral.surface`: main cards/panels/code containers
  - `<variant>.neutral.surfaceAlt`: popovers, dropdowns, modals
  - `<variant>.neutral.surfaceSubtle`: subtle highlighted sections

- **Chat**
  - `<variant>.neutral.chatUserBubble`: user message bubble background
  - `<variant>.neutral.canvas` + `<variant>.neutral.surface*`: assistant/thread container layering

- **Code / syntax**
  - `shared.syntaxString`, `shared.syntaxNumber`, `shared.syntaxType`, `shared.syntaxTag`, `shared.syntaxSpecial`
  - `<variant>.neutral.syntaxComment`: comments and low-emphasis punctuation

- **Status (toasts / diff / badges)**
  - `shared.statusSuccess`: success/open/added
  - `shared.statusWarning`: warning/caution/blocked
  - `shared.statusError`: error/destructive/removed
  - `shared.statusInfo`: info/neutral/modified

## 1) Start from the example palette

Copy the example and edit colors:

```bash
cp scripts/themes/palettes/example.json scripts/themes/palettes/my-theme.json
```

Use the inline `//` comments as guidance for each token.

## 2) Generate themes

Generate both variants (default):

```bash
node scripts/themes/palettes/palette-to-theme.cjs \
  --palette scripts/themes/palettes/my-theme.json
```

Generate only one variant:

```bash
node scripts/themes/palettes/palette-to-theme.cjs \
  --palette scripts/themes/palettes/my-theme.json \
  --variant light
```

Write output to a custom directory:

```bash
node scripts/themes/palettes/palette-to-theme.cjs \
  --palette scripts/themes/palettes/my-theme.json \
  --out-dir scripts/themes/palettes/out
```

## 3) Normalization levels

Normalization is inspired by the Macura process (semantic + OKLCH-based harmonization):

- `tight`: strongest harmonization, most uniform output
- `balanced`: recommended default
- `expressive`: keeps more of your raw palette variation

Example:

```bash
node scripts/themes/palettes/palette-to-theme.cjs \
  --palette scripts/themes/palettes/my-theme.json \
  --normalization expressive
```

## 4) What normalization does

- Preserves your hue identity (keeps color families recognizable)
- Clamps lightness/chroma per semantic category (surfaces, text, borders, accents, status)
- Enforces a surface ladder so layered backgrounds stay readable
- Applies contrast guards for primary and muted text against canvas
- Generates alpha variants (selection/focus/status backgrounds) from base semantic tokens

## 5) Output

By default, generated themes are written to:

- `packages/ui/src/lib/theme/themes/<id>-light.json`
- `packages/ui/src/lib/theme/themes/<id>-dark.json`

When writing to the default themes directory, the script also auto-registers generated themes in `packages/ui/src/lib/theme/themes/presets.ts`.

To skip auto-registration:

```bash
node scripts/themes/palettes/palette-to-theme.cjs \
  --palette scripts/themes/palettes/my-theme.json \
  --no-register
```
