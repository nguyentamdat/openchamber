#!/usr/bin/env node

/*
 * OpenChamber palette -> theme converter.
 *
 * Inspired by Macura normalization approach:
 * - semantic grouping
 * - OKLCH normalization with profile levels
 * - contrast guards for readable output
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'packages', 'ui', 'src', 'lib', 'theme', 'themes');
const PRESETS_PATH = path.join(DEFAULT_OUT_DIR, 'presets.ts');

const DEFAULTS = {
  shared: {
    accentPrimary: '#BC5215',
    accentSecondary: '#205EA6',
    accentTertiary: '#5E409D',
    syntaxString: '#24837B',
    syntaxNumber: '#5E409D',
    syntaxType: '#AD8301',
    syntaxTag: '#205EA6',
    syntaxSpecial: '#A02F6F',
    statusSuccess: '#66800B',
    statusWarning: '#BC5215',
    statusError: '#AF3029',
    statusInfo: '#205EA6',
  },
  light: {
    neutral: {
      canvas: '#FFFCF0',
      surface: '#F2F0E5',
      surfaceAlt: '#FDF6EC',
      surfaceSubtle: '#F6F0E6',
      text: '#100F0F',
      textMuted: '#474643',
      textDim: '#6F6E69',
      border: '#DAD8CE',
      borderStrong: '#CECDC3',
      selection: '#76736F',
      overlay: '#100F0F',
      chatUserBubble: '#F6F0E6',
      toolsBackground: '#F2F0E5',
      syntaxComment: '#6F6E69',
    },
  },
  dark: {
    neutral: {
      canvas: '#151313',
      surface: '#1C1B1A',
      surfaceAlt: '#1C1A19',
      surfaceSubtle: '#1E1D1C',
      text: '#CECDC3',
      textMuted: '#878580',
      textDim: '#575653',
      border: '#343331',
      borderStrong: '#403E3C',
      selection: '#F4F4F4',
      overlay: '#000000',
      chatUserBubble: '#27180E',
      toolsBackground: '#1C1B1A',
      syntaxComment: '#878580',
    },
  },
};

const PROFILE_CONFIG = {
  tight: {
    pull: 1,
    neutralPull: 0.6,
    chromaScale: 0.82,
    ladderStep: 0.016,
    minContrastMain: 7.2,
    minContrastMuted: 4.8,
  },
  balanced: {
    pull: 0.78,
    neutralPull: 0.35,
    chromaScale: 0.94,
    ladderStep: 0.022,
    minContrastMain: 7,
    minContrastMuted: 4.5,
  },
  expressive: {
    pull: 0.58,
    neutralPull: 0.2,
    chromaScale: 1.08,
    ladderStep: 0.03,
    minContrastMain: 6.6,
    minContrastMuted: 4.2,
  },
};

const SURFACE_OFFSETS = {
  tight: {
    light: {
      alt: { min: 0.01, max: 0.02 },
      subtle: { min: 0.02, max: 0.038 },
      muted: { min: 0.028, max: 0.048 },
    },
    dark: {
      alt: { min: 0.012, max: 0.03 },
      subtle: { min: 0.03, max: 0.06 },
      muted: { min: 0.06, max: 0.095 },
    },
  },
  balanced: {
    light: {
      alt: { min: 0.012, max: 0.024 },
      subtle: { min: 0.024, max: 0.045 },
      muted: { min: 0.032, max: 0.055 },
    },
    dark: {
      alt: { min: 0.014, max: 0.038 },
      subtle: { min: 0.038, max: 0.07 },
      muted: { min: 0.07, max: 0.105 },
    },
  },
  expressive: {
    light: {
      alt: { min: 0.014, max: 0.03 },
      subtle: { min: 0.03, max: 0.055 },
      muted: { min: 0.04, max: 0.065 },
    },
    dark: {
      alt: { min: 0.018, max: 0.045 },
      subtle: { min: 0.045, max: 0.08 },
      muted: { min: 0.08, max: 0.115 },
    },
  },
};

const RANGE_BY_CATEGORY = {
  light: {
    background: { lMin: 0.96, lMax: 0.995, cMax: 0.015 },
    surfaceAlt: { lMin: 0.92, lMax: 0.985, cMax: 0.02 },
    surfaceMuted: { lMin: 0.9, lMax: 0.97, cMax: 0.02 },
    surfaceSubtle: { lMin: 0.91, lMax: 0.975, cMax: 0.02 },
    surface: { lMin: 0.84, lMax: 0.97, cMax: 0.05 },
    foreground: { lMin: 0.08, lMax: 0.32, cMax: 0.05 },
    foregroundMuted: { lMin: 0.28, lMax: 0.6, cMax: 0.04 },
    border: { lMin: 0.62, lMax: 0.9, cMax: 0.04 },
    accent: { lMin: 0.36, lMax: 0.72, cMin: 0.05, cMax: 0.23 },
    status: { lMin: 0.32, lMax: 0.72, cMin: 0.06, cMax: 0.24 },
    syntaxComment: { lMin: 0.3, lMax: 0.6, cMax: 0.03 },
  },
  dark: {
    background: { lMin: 0.06, lMax: 0.2, cMax: 0.03 },
    surfaceAlt: { lMin: 0.12, lMax: 0.3, cMax: 0.02 },
    surfaceSubtle: { lMin: 0.14, lMax: 0.33, cMax: 0.02 },
    surfaceMuted: { lMin: 0.16, lMax: 0.36, cMax: 0.024 },
    surface: { lMin: 0.1, lMax: 0.3, cMax: 0.05 },
    foreground: { lMin: 0.72, lMax: 0.95, cMax: 0.06 },
    foregroundMuted: { lMin: 0.46, lMax: 0.78, cMax: 0.05 },
    border: { lMin: 0.2, lMax: 0.48, cMax: 0.05 },
    accent: { lMin: 0.5, lMax: 0.84, cMin: 0.04, cMax: 0.24 },
    status: { lMin: 0.5, lMax: 0.82, cMin: 0.06, cMax: 0.25 },
    syntaxComment: { lMin: 0.42, lMax: 0.75, cMax: 0.03 },
  },
};

function parseArgs(argv) {
  const args = {
    palette: '',
    variant: 'both',
    normalization: 'balanced',
    outDir: DEFAULT_OUT_DIR,
    register: true,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--palette') args.palette = argv[i + 1], i += 1;
    else if (token === '--variant') args.variant = argv[i + 1], i += 1;
    else if (token === '--normalization') args.normalization = argv[i + 1], i += 1;
    else if (token === '--out-dir') args.outDir = argv[i + 1], i += 1;
    else if (token === '--no-register') args.register = false;
    else if (token === '--help' || token === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/themes/palettes/palette-to-theme.cjs --palette <palette.json> [options]',
    '',
    'Options:',
    '  --variant <light|dark|both>          Which variants to generate (default: both)',
    '  --normalization <tight|balanced|expressive>  Normalization level (default: balanced)',
    '  --out-dir <path>                     Output directory for generated theme files',
    '  --no-register                        Skip presets.ts auto-registration',
    '  --help                               Show this help',
  ].join('\n');
}

function makeImportVariableName(themeId) {
  const base = themeId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safeBase = /^[a-z_]/.test(base) ? base : `_${base}`;
  return `${safeBase}_Raw`;
}

function insertImportLine(source, importLine) {
  const lines = source.split(/\r?\n/);
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*import\s/.test(lines[i])) lastImportLine = i;
  }
  if (lastImportLine === -1) {
    throw new Error('Unable to find import block in presets.ts');
  }
  lines.splice(lastImportLine + 1, 0, importLine);
  return lines.join('\n');
}

function insertPresetEntry(source, entryLine) {
  const lines = source.split(/\r?\n/);
  const arrayStartIndex = lines.findIndex((line) => /^\s*export\s+const\s+presetThemes\b/.test(line));
  if (arrayStartIndex === -1) {
    throw new Error('Unable to find presetThemes declaration in presets.ts');
  }

  const arrayEndIndex = lines.findIndex(
    (line, index) => index > arrayStartIndex && (line.includes('].map(') || /^\s*\];\s*$/.test(line)),
  );
  if (arrayEndIndex === -1) {
    throw new Error('Unable to find presetThemes array end in presets.ts');
  }

  lines.splice(arrayEndIndex, 0, entryLine);
  return lines.join('\n');
}

function registerThemesInPresets(themeIds) {
  if (!fs.existsSync(PRESETS_PATH)) {
    throw new Error(`presets.ts not found at: ${PRESETS_PATH}`);
  }

  const sortedIds = [...new Set(themeIds)].sort();
  let source = fs.readFileSync(PRESETS_PATH, 'utf8');
  let updated = false;

  for (const themeId of sortedIds) {
    const importVar = makeImportVariableName(themeId);
    const importLine = `import ${importVar} from './${themeId}.json';`;
    const arrayEntry = `${importVar} as Theme`;

    if (!source.includes(importLine)) {
      source = insertImportLine(source, importLine);
      updated = true;
    }

    if (!source.includes(arrayEntry)) {
      source = insertPresetEntry(source, `  ${arrayEntry},`);
      updated = true;
    }
  }

  if (updated) {
    fs.writeFileSync(PRESETS_PATH, source);
  }

  return { updated, count: sortedIds.length };
}

function stripJsonComments(input) {
  let result = input.replace(/\/\*[\s\S]*?\*\//g, '');
  result = result.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return result;
}

function loadJsonWithComments(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const cleaned = stripJsonComments(raw);
  return JSON.parse(cleaned);
}

function stripCommentKeys(value) {
  if (Array.isArray(value)) return value.map(stripCommentKeys);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '$comment' || k === '_comment' || k.endsWith('_comment')) continue;
    out[k] = stripCommentKeys(v);
  }
  return out;
}

function tokenValue(token, fallback) {
  if (typeof token === 'string') return token;
  if (token && typeof token === 'object' && typeof token.value === 'string') return token.value;
  return fallback;
}

function normalizeHex(hex) {
  if (typeof hex !== 'string') return null;
  const value = hex.trim().replace(/^#/, '');
  if (![3, 4, 6, 8].includes(value.length) || !/^[0-9a-fA-F]+$/.test(value)) return null;
  if (value.length === 3 || value.length === 4) {
    const full = value.split('').map((s) => `${s}${s}`).join('');
    return `#${full.slice(0, 6).toLowerCase()}`;
  }
  return `#${value.slice(0, 6).toLowerCase()}`;
}

function hexToRgb(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) throw new Error(`Invalid hex color: ${hex}`);
  const raw = normalized.slice(1);
  return {
    r: parseInt(raw.slice(0, 2), 16) / 255,
    g: parseInt(raw.slice(2, 4), 16) / 255,
    b: parseInt(raw.slice(4, 6), 16) / 255,
  };
}

function rgbToHex({ r, g, b }) {
  const toByte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `#${toByte(r).toString(16).padStart(2, '0')}${toByte(g).toString(16).padStart(2, '0')}${toByte(b).toString(16).padStart(2, '0')}`;
}

function withAlpha(hex, alpha) {
  const base = normalizeHex(hex);
  if (!base) throw new Error(`Cannot apply alpha to invalid hex: ${hex}`);
  const byte = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return `${base}${byte.toString(16).padStart(2, '0')}`;
}

function linearSrgb(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function srgbFromLinear(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function rgbToOklch({ r, g, b }) {
  const rl = linearSrgb(r);
  const gl = linearSrgb(g);
  const bl = linearSrgb(b);

  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.sqrt(a * a + b2 * b2);
  let H = (Math.atan2(b2, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return { L, C, H };
}

function oklchToRgb({ L, C, H }) {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const rl = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gl = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: srgbFromLinear(Math.max(0, Math.min(1, rl))),
    g: srgbFromLinear(Math.max(0, Math.min(1, gl))),
    b: srgbFromLinear(Math.max(0, Math.min(1, bl))),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function adjustLightness(hex, delta) {
  const oklch = rgbToOklch(hexToRgb(hex));
  return rgbToHex(oklchToRgb({ ...oklch, L: clamp(oklch.L + delta, 0, 1) }));
}

function adjustOklch(hex, options = {}) {
  const color = rgbToOklch(hexToRgb(hex));
  const dL = typeof options.dL === 'number' ? options.dL : 0;
  const dC = typeof options.dC === 'number' ? options.dC : 0;
  const dH = typeof options.dH === 'number' ? options.dH : 0;
  const lMin = typeof options.lMin === 'number' ? options.lMin : 0;
  const lMax = typeof options.lMax === 'number' ? options.lMax : 1;
  const cMin = typeof options.cMin === 'number' ? options.cMin : 0;
  const cMax = typeof options.cMax === 'number' ? options.cMax : 0.37;

  const next = {
    L: clamp(color.L + dL, lMin, lMax),
    C: clamp(color.C + dC, cMin, cMax),
    H: (color.H + dH + 360) % 360,
  };

  return rgbToHex(oklchToRgb(next));
}

function hueDistance(a, b) {
  let delta = Math.abs(a - b) % 360;
  if (delta > 180) delta = 360 - delta;
  return delta;
}

function colorDistance(aHex, bHex) {
  const a = rgbToOklch(hexToRgb(aHex));
  const b = rgbToOklch(hexToRgb(bHex));
  const dL = a.L - b.L;
  const dC = a.C - b.C;
  const dH = (2 * Math.sin((hueDistance(a.H, b.H) * Math.PI) / 360)) * 0.42;
  return Math.sqrt(dL * dL + dC * dC + dH * dH);
}

function resolveDistinctSyntaxColor(candidateHex, existingHexes, options) {
  const {
    backgroundHex,
    variant,
    minContrast,
    minDistance,
  } = options;

  let candidate = ensureContrast(candidateHex, backgroundHex, minContrast, variant);
  let threshold = minDistance;

  for (let i = 0; i < 72; i += 1) {
    const duplicate = existingHexes.some((hex) => hex === candidate);
    const tooClose = existingHexes.some((hex) => colorDistance(hex, candidate) < threshold);

    if (!duplicate && !tooClose) return candidate;

    const hueStep = (i % 2 === 0 ? 1 : -1) * (10 + Math.floor(i / 2) * 6);
    const lightStep = ((i % 5) - 2) * 0.008;
    const chromaStep = ((i % 4) - 1.5) * 0.01;

    candidate = adjustOklch(candidate, {
      dH: hueStep,
      dL: lightStep,
      dC: chromaStep,
      lMin: variant === 'light' ? 0.2 : 0.55,
      lMax: variant === 'light' ? 0.8 : 0.95,
      cMin: 0.02,
      cMax: 0.29,
    });
    candidate = ensureContrast(candidate, backgroundHex, minContrast, variant);
    threshold = Math.max(0.008, minDistance - i * 0.00025);
  }

  return candidate;
}

function buildDistinctSyntaxColors(shared, neutral, variant, profile) {
  const background = neutral.surface;
  const baseMinDistance = profile === 'tight' ? 0.022 : profile === 'balanced' ? 0.018 : 0.014;
  const defaultContrast = variant === 'light' ? 4.1 : 3.8;
  const lowContrast = variant === 'light' ? 3.2 : 3.0;

  const seeds = {
    baseForeground: neutral.text,
    baseComment: neutral.syntaxComment,
    baseKeyword: shared.accentSecondary,
    baseString: shared.syntaxString,
    baseNumber: shared.syntaxNumber,
    baseFunction: adjustOklch(shared.accentPrimary, { dH: 8, dC: 0.012 }),
    baseVariable: adjustOklch(neutral.text, { dH: 14, dC: 0.02, dL: variant === 'light' ? 0.01 : -0.01 }),
    baseType: shared.syntaxType,
    baseOperator: shared.statusError,
    tokenCommentDoc: adjustOklch(neutral.textDim, { dH: -8, dC: 0.01 }),
    tokenStringEscape: adjustOklch(neutral.text, { dH: 18, dC: 0.018 }),
    tokenKeywordImport: adjustOklch(shared.statusError, { dH: -10, dC: 0.01 }),
    tokenStorageModifier: adjustOklch(shared.accentSecondary, { dH: 10, dC: 0.014 }),
    tokenFunctionCall: adjustOklch(shared.accentPrimary, { dH: -10, dC: 0.01 }),
    tokenMethod: adjustOklch(shared.statusSuccess, { dH: 8, dC: 0.014 }),
    tokenVariableProperty: adjustOklch(shared.accentSecondary, { dH: 25, dC: 0.02 }),
    tokenVariableOther: adjustOklch(shared.statusSuccess, { dH: -14, dC: 0.015 }),
    tokenVariableGlobal: shared.syntaxSpecial,
    tokenVariableLocal: adjustOklch(neutral.surfaceSubtle, { dH: 25, dC: 0.03 }),
    tokenParameter: adjustOklch(neutral.text, { dH: 34, dC: 0.018 }),
    tokenConstant: adjustOklch(neutral.text, { dH: -24, dC: 0.022 }),
    tokenClass: adjustOklch(shared.accentPrimary, { dH: 18, dC: 0.016 }),
    tokenClassName: adjustOklch(shared.accentPrimary, { dH: 32, dC: 0.02 }),
    tokenInterface: adjustOklch(shared.syntaxType, { dH: -15, dC: 0.01 }),
    tokenStruct: adjustOklch(shared.accentPrimary, { dH: -20, dC: 0.015 }),
    tokenEnum: adjustOklch(shared.accentPrimary, { dH: 45, dC: 0.018 }),
    tokenTypeParameter: adjustOklch(shared.accentPrimary, { dH: -36, dC: 0.015 }),
    tokenNamespace: adjustOklch(shared.syntaxType, { dH: 16, dC: 0.015 }),
    tokenModule: adjustOklch(shared.statusError, { dH: 20, dC: 0.015 }),
    tokenTag: shared.syntaxTag,
    tokenJsxTag: adjustOklch(shared.syntaxSpecial, { dH: 12, dC: 0.012 }),
    tokenTagAttribute: adjustOklch(shared.syntaxType, { dH: -28, dC: 0.012 }),
    tokenTagAttributeValue: adjustOklch(shared.syntaxString, { dH: 20, dC: 0.014 }),
    tokenBoolean: adjustOklch(shared.syntaxType, { dH: 34, dC: 0.016 }),
    tokenDecorator: adjustOklch(shared.syntaxType, { dH: -42, dC: 0.018 }),
    tokenLabel: adjustOklch(shared.syntaxSpecial, { dH: -16, dC: 0.014 }),
    tokenPunctuation: adjustOklch(neutral.textDim, { dH: 10, dC: 0.008 }),
    tokenMacro: adjustOklch(shared.accentSecondary, { dH: -24, dC: 0.012 }),
    tokenPreprocessor: adjustOklch(shared.syntaxSpecial, { dH: 30, dC: 0.02 }),
    tokenRegex: adjustOklch(shared.syntaxString, { dH: -16, dC: 0.012 }),
    tokenUrl: adjustOklch(shared.accentSecondary, { dH: 42, dC: 0.018 }),
    tokenKey: adjustOklch(shared.accentPrimary, { dH: 58, dC: 0.016 }),
    tokenException: adjustOklch(shared.syntaxSpecial, { dH: 48, dC: 0.02 }),
  };

  const tokenOrder = [
    ['baseForeground', defaultContrast],
    ['baseComment', lowContrast],
    ['baseKeyword', defaultContrast],
    ['baseString', defaultContrast],
    ['baseNumber', defaultContrast],
    ['baseFunction', defaultContrast],
    ['baseVariable', defaultContrast],
    ['baseType', defaultContrast],
    ['baseOperator', defaultContrast],
    ['tokenCommentDoc', lowContrast],
    ['tokenStringEscape', defaultContrast],
    ['tokenKeywordImport', defaultContrast],
    ['tokenStorageModifier', defaultContrast],
    ['tokenFunctionCall', defaultContrast],
    ['tokenMethod', defaultContrast],
    ['tokenVariableProperty', defaultContrast],
    ['tokenVariableOther', defaultContrast],
    ['tokenVariableGlobal', defaultContrast],
    ['tokenVariableLocal', lowContrast],
    ['tokenParameter', defaultContrast],
    ['tokenConstant', defaultContrast],
    ['tokenClass', defaultContrast],
    ['tokenClassName', defaultContrast],
    ['tokenInterface', defaultContrast],
    ['tokenStruct', defaultContrast],
    ['tokenEnum', defaultContrast],
    ['tokenTypeParameter', defaultContrast],
    ['tokenNamespace', defaultContrast],
    ['tokenModule', defaultContrast],
    ['tokenTag', defaultContrast],
    ['tokenJsxTag', defaultContrast],
    ['tokenTagAttribute', defaultContrast],
    ['tokenTagAttributeValue', defaultContrast],
    ['tokenBoolean', defaultContrast],
    ['tokenDecorator', defaultContrast],
    ['tokenLabel', defaultContrast],
    ['tokenPunctuation', lowContrast],
    ['tokenMacro', defaultContrast],
    ['tokenPreprocessor', defaultContrast],
    ['tokenRegex', defaultContrast],
    ['tokenUrl', defaultContrast],
    ['tokenKey', defaultContrast],
    ['tokenException', defaultContrast],
  ];

  const resolved = {};
  const used = [];

  for (const [key, minContrast] of tokenOrder) {
    const seed = normalizeHex(seeds[key]);
    if (!seed) continue;
    const distinct = resolveDistinctSyntaxColor(seed, used, {
      backgroundHex: background,
      variant,
      minContrast,
      minDistance: baseMinDistance,
    });
    resolved[key] = distinct;
    used.push(distinct);
  }

  return {
    base: {
      background: neutral.surface,
      foreground: resolved.baseForeground,
      comment: resolved.baseComment,
      keyword: resolved.baseKeyword,
      string: resolved.baseString,
      number: resolved.baseNumber,
      function: resolved.baseFunction,
      variable: resolved.baseVariable,
      type: resolved.baseType,
      operator: resolved.baseOperator,
    },
    tokens: {
      commentDoc: resolved.tokenCommentDoc,
      stringEscape: resolved.tokenStringEscape,
      keywordImport: resolved.tokenKeywordImport,
      storageModifier: resolved.tokenStorageModifier,
      functionCall: resolved.tokenFunctionCall,
      method: resolved.tokenMethod,
      variableProperty: resolved.tokenVariableProperty,
      variableOther: resolved.tokenVariableOther,
      variableGlobal: resolved.tokenVariableGlobal,
      variableLocal: resolved.tokenVariableLocal,
      parameter: resolved.tokenParameter,
      constant: resolved.tokenConstant,
      class: resolved.tokenClass,
      className: resolved.tokenClassName,
      interface: resolved.tokenInterface,
      struct: resolved.tokenStruct,
      enum: resolved.tokenEnum,
      typeParameter: resolved.tokenTypeParameter,
      namespace: resolved.tokenNamespace,
      module: resolved.tokenModule,
      tag: resolved.tokenTag,
      jsxTag: resolved.tokenJsxTag,
      tagAttribute: resolved.tokenTagAttribute,
      tagAttributeValue: resolved.tokenTagAttributeValue,
      boolean: resolved.tokenBoolean,
      decorator: resolved.tokenDecorator,
      label: resolved.tokenLabel,
      punctuation: resolved.tokenPunctuation,
      macro: resolved.tokenMacro,
      preprocessor: resolved.tokenPreprocessor,
      regex: resolved.tokenRegex,
      url: resolved.tokenUrl,
      key: resolved.tokenKey,
      exception: resolved.tokenException,
    },
  };
}

function buildMarkdownHeadingScale(neutral, variant, profile) {
  const minMain = PROFILE_CONFIG[profile].minContrastMain;
  const minMuted = PROFILE_CONFIG[profile].minContrastMuted;
  const bg = neutral.canvas;

  const textOklch = rgbToOklch(hexToRgb(neutral.text));
  const mutedOklch = rgbToOklch(hexToRgb(neutral.textMuted));
  const dimOklch = rgbToOklch(hexToRgb(neutral.textDim));

  const withAnchorHue = (from, to, t) =>
    rgbToHex(
      oklchToRgb({
        L: mix(from.L, to.L, t),
        C: mix(from.C, to.C, t),
        H: textOklch.H,
      }),
    );

  let heading1 = neutral.text;
  let heading2 = withAnchorHue(textOklch, mutedOklch, 0.35);
  let heading3 = withAnchorHue(textOklch, mutedOklch, 0.7);
  let heading4 = withAnchorHue(mutedOklch, dimOklch, 0.65);

  heading1 = ensureContrast(heading1, bg, minMain, variant);
  heading2 = ensureContrast(heading2, bg, Math.max(minMuted + 0.6, 4.8), variant);
  heading3 = ensureContrast(heading3, bg, Math.max(minMuted + 0.2, 4.2), variant);
  heading4 = ensureContrast(heading4, bg, minMuted, variant);

  return { heading1, heading2, heading3, heading4 };
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

function ensureContrast(foreground, background, minContrast, variant) {
  let current = normalizeHex(foreground);
  const bg = normalizeHex(background);
  if (!current || !bg) return foreground;
  if (contrastRatio(current, bg) >= minContrast) return current;

  let oklch = rgbToOklch(hexToRgb(current));
  const bgL = rgbToOklch(hexToRgb(bg)).L;

  for (let i = 0; i < 24; i += 1) {
    const step = 0.02;
    if (variant === 'dark') {
      oklch.L = oklch.L >= bgL ? clamp(oklch.L + step, 0, 1) : clamp(oklch.L - step, 0, 1);
    } else {
      oklch.L = oklch.L <= bgL ? clamp(oklch.L - step, 0, 1) : clamp(oklch.L + step, 0, 1);
    }

    current = rgbToHex(oklchToRgb(oklch));
    if (contrastRatio(current, bg) >= minContrast) return current;
  }

  return current;
}

function normalizeByCategory(hex, category, variant, profile, pullOverride) {
  const norm = normalizeHex(hex);
  if (!norm) throw new Error(`Invalid color for ${category}: ${hex}`);
  const settings = PROFILE_CONFIG[profile];
  const pull = typeof pullOverride === 'number' ? pullOverride : settings.pull;
  const range = RANGE_BY_CATEGORY[variant][category];

  const oklch = rgbToOklch(hexToRgb(norm));
  const targetL = clamp(oklch.L, range.lMin, range.lMax);
  const nextL = mix(oklch.L, targetL, pull);

  let nextC = oklch.C;
  if (typeof range.cMax === 'number') {
    nextC = mix(nextC, Math.min(nextC, range.cMax), pull);
  }
  if (typeof range.cMin === 'number') {
    nextC = mix(nextC, Math.max(nextC, range.cMin), pull);
  }
  nextC = clamp(nextC * settings.chromaScale, 0, 0.37);

  return rgbToHex(oklchToRgb({ L: nextL, C: nextC, H: oklch.H }));
}

function enforceSurfaceLadder(neutral, variant, profile) {
  const canvasL = rgbToOklch(hexToRgb(neutral.canvas)).L;
  const step = PROFILE_CONFIG[profile].ladderStep;
  const offsets = SURFACE_OFFSETS[profile][variant];

  const clampByOffset = (sourceHex, offsetRange) => {
    const base = rgbToOklch(hexToRgb(sourceHex));
    if (variant === 'light') {
      const minL = clamp(canvasL - offsetRange.max, 0, 1);
      const maxL = clamp(canvasL - offsetRange.min, 0, 1);
      return { base, L: clamp(base.L, minL, maxL) };
    }
    const minL = clamp(canvasL + offsetRange.min, 0, 1);
    const maxL = clamp(canvasL + offsetRange.max, 0, 1);
    return { base, L: clamp(base.L, minL, maxL) };
  };

  let alt = clampByOffset(neutral.surfaceAlt, offsets.alt);
  let subtle = clampByOffset(neutral.surfaceSubtle, offsets.subtle);
  let muted = clampByOffset(neutral.surface, offsets.muted);

  if (variant === 'light') {
    subtle.L = Math.min(subtle.L, alt.L - step);
    muted.L = Math.min(muted.L, subtle.L - step);
  } else {
    subtle.L = Math.max(subtle.L, alt.L + step);
    muted.L = Math.max(muted.L, subtle.L + step);
  }

  alt.L = clamp(alt.L, 0, 1);
  muted.L = clamp(muted.L, 0, 1);
  subtle.L = clamp(subtle.L, 0, 1);

  neutral.surfaceAlt = rgbToHex(oklchToRgb({ ...alt.base, L: alt.L }));
  neutral.surface = rgbToHex(oklchToRgb({ ...muted.base, L: muted.L }));
  neutral.surfaceSubtle = rgbToHex(oklchToRgb({ ...subtle.base, L: subtle.L }));
}

function resolveVariantPalette(rawPalette, variant) {
  const clean = stripCommentKeys(rawPalette || {});
  const sharedSource = clean.shared || {};
  const variantSource = clean[variant] || {};
  const neutralSource = variantSource.neutral || {};

  const shared = {};
  for (const [key, fallback] of Object.entries(DEFAULTS.shared)) {
    shared[key] = normalizeHex(tokenValue(sharedSource[key], fallback));
  }

  const neutral = {};
  const fallbackNeutral = DEFAULTS[variant].neutral;
  for (const [key, fallback] of Object.entries(fallbackNeutral)) {
    neutral[key] = normalizeHex(tokenValue(neutralSource[key], fallback));
  }

  return { shared, neutral };
}

function normalizePalette(resolved, variant, profile) {
  const shared = { ...resolved.shared };
  const neutral = { ...resolved.neutral };
  const neutralPull = PROFILE_CONFIG[profile].neutralPull;
  const subtlePull = Math.max(0.08, neutralPull * (variant === 'light' ? 0.35 : 0.45));

  neutral.canvas = normalizeByCategory(neutral.canvas, 'background', variant, profile, neutralPull);
  neutral.surface = normalizeByCategory(neutral.surface, 'surfaceMuted', variant, profile, neutralPull);
  neutral.surfaceAlt = normalizeByCategory(neutral.surfaceAlt, 'surfaceAlt', variant, profile, neutralPull);
  neutral.surfaceSubtle = normalizeByCategory(neutral.surfaceSubtle, 'surfaceSubtle', variant, profile, subtlePull);
  neutral.text = normalizeByCategory(neutral.text, 'foreground', variant, profile, neutralPull);
  neutral.textMuted = normalizeByCategory(neutral.textMuted, 'foregroundMuted', variant, profile, neutralPull);
  neutral.textDim = normalizeByCategory(neutral.textDim, 'foregroundMuted', variant, profile, neutralPull);
  neutral.border = normalizeByCategory(neutral.border, 'border', variant, profile, neutralPull);
  neutral.borderStrong = normalizeByCategory(neutral.borderStrong, 'border', variant, profile, neutralPull);
  neutral.syntaxComment = normalizeByCategory(neutral.syntaxComment, 'syntaxComment', variant, profile, neutralPull);

  shared.accentPrimary = normalizeByCategory(shared.accentPrimary, 'accent', variant, profile);
  shared.accentSecondary = normalizeByCategory(shared.accentSecondary, 'accent', variant, profile);
  shared.accentTertiary = normalizeByCategory(shared.accentTertiary, 'accent', variant, profile);
  shared.syntaxString = normalizeByCategory(shared.syntaxString, 'accent', variant, profile);
  shared.syntaxNumber = normalizeByCategory(shared.syntaxNumber, 'accent', variant, profile);
  shared.syntaxType = normalizeByCategory(shared.syntaxType, 'accent', variant, profile);
  shared.syntaxTag = normalizeByCategory(shared.syntaxTag, 'accent', variant, profile);
  shared.syntaxSpecial = normalizeByCategory(shared.syntaxSpecial, 'accent', variant, profile);
  shared.statusSuccess = normalizeByCategory(shared.statusSuccess, 'status', variant, profile);
  shared.statusWarning = normalizeByCategory(shared.statusWarning, 'status', variant, profile);
  shared.statusError = normalizeByCategory(shared.statusError, 'status', variant, profile);
  shared.statusInfo = normalizeByCategory(shared.statusInfo, 'status', variant, profile);

  enforceSurfaceLadder(neutral, variant, profile);

  neutral.text = ensureContrast(neutral.text, neutral.canvas, PROFILE_CONFIG[profile].minContrastMain, variant);
  neutral.textMuted = ensureContrast(neutral.textMuted, neutral.canvas, PROFILE_CONFIG[profile].minContrastMuted, variant);
  neutral.border = ensureContrast(neutral.border, neutral.canvas, 1.5, variant);
  neutral.borderStrong = ensureContrast(neutral.borderStrong, neutral.canvas, 1.8, variant);

  return { shared, neutral };
}

function buildTheme(metadata, normalized, variant, profile) {
  const { shared, neutral } = normalized;
  const isDark = variant === 'dark';
  const idBase = (metadata.id || metadata.name || 'palette-theme').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const name = metadata.name || 'Palette Theme';
  const description = metadata.description || 'Generated from OpenChamber palette';

  const primaryHover = adjustLightness(shared.accentPrimary, isDark ? 0.05 : 0.06);
  const primaryActive = adjustLightness(shared.accentPrimary, isDark ? 0.1 : -0.06);
  const focusRingBase = shared.accentPrimary;
  const markdownHeadings = buildMarkdownHeadingScale(neutral, variant, profile);
  const syntaxColors = buildDistinctSyntaxColors(shared, neutral, variant, profile);

  return {
    metadata: {
      id: `${idBase}-${variant}`,
      name,
      description: `${description} (${variant}, ${profile} normalization)`,
      author: metadata.author || 'Palette author',
      version: metadata.version || '1.0.0',
      variant,
      tags: [...new Set([variant, 'palette', 'generated', ...(Array.isArray(metadata.tags) ? metadata.tags : [])])],
    },
    colors: {
      primary: {
        base: shared.accentPrimary,
        hover: primaryHover,
        active: primaryActive,
        foreground: neutral.canvas,
        muted: withAlpha(shared.accentPrimary, 0.5),
        emphasis: adjustLightness(shared.accentPrimary, isDark ? 0.08 : 0.04),
      },
      surface: {
        background: neutral.canvas,
        foreground: neutral.text,
        muted: neutral.surface,
        mutedForeground: neutral.textMuted,
        elevated: neutral.surfaceAlt,
        elevatedForeground: neutral.text,
        overlay: withAlpha(neutral.overlay, isDark ? 0.5 : 0.12),
        subtle: neutral.surfaceSubtle,
      },
      interactive: {
        border: neutral.border,
        borderHover: neutral.borderStrong,
        borderFocus: shared.accentPrimary,
        selection: withAlpha(neutral.selection, isDark ? 0.16 : 0.18),
        selectionForeground: neutral.text,
        focus: shared.accentPrimary,
        focusRing: withAlpha(focusRingBase, isDark ? 0.35 : 0.3),
        cursor: neutral.text,
        hover: withAlpha(neutral.selection, isDark ? 0.12 : 0.1),
        active: withAlpha(neutral.selection, isDark ? 0.16 : 0.14),
      },
      status: {
        error: shared.statusError,
        errorForeground: neutral.canvas,
        errorBackground: withAlpha(shared.statusError, 0.14),
        errorBorder: withAlpha(shared.statusError, 0.35),
        warning: shared.statusWarning,
        warningForeground: neutral.canvas,
        warningBackground: withAlpha(shared.statusWarning, 0.14),
        warningBorder: withAlpha(shared.statusWarning, 0.35),
        success: shared.statusSuccess,
        successForeground: neutral.canvas,
        successBackground: withAlpha(shared.statusSuccess, 0.14),
        successBorder: withAlpha(shared.statusSuccess, 0.35),
        info: shared.statusInfo,
        infoForeground: neutral.canvas,
        infoBackground: withAlpha(shared.statusInfo, 0.14),
        infoBorder: withAlpha(shared.statusInfo, 0.35),
      },
      pr: {
        open: shared.statusSuccess,
        draft: neutral.textDim,
        blocked: shared.statusWarning,
        merged: shared.accentTertiary,
        closed: shared.statusError,
      },
      syntax: {
        base: syntaxColors.base,
        tokens: syntaxColors.tokens,
        highlights: {
          diffAdded: shared.statusSuccess,
          diffAddedBackground: withAlpha(shared.statusSuccess, 0.14),
          diffRemoved: shared.statusError,
          diffRemovedBackground: withAlpha(shared.statusError, 0.14),
          diffModified: shared.statusInfo,
          diffModifiedBackground: withAlpha(shared.statusInfo, 0.14),
          lineNumber: neutral.borderStrong,
          lineNumberActive: neutral.text,
        },
      },
      markdown: {
        heading1: markdownHeadings.heading1,
        heading2: markdownHeadings.heading2,
        heading3: markdownHeadings.heading3,
        heading4: markdownHeadings.heading4,
        link: shared.accentSecondary,
        linkHover: shared.statusInfo,
        inlineCode: shared.syntaxString,
        inlineCodeBackground: neutral.surfaceAlt,
        blockquote: neutral.textDim,
        blockquoteBorder: neutral.border,
        listMarker: withAlpha(shared.syntaxType, 0.6),
      },
      chat: {
        userMessage: neutral.text,
        userMessage: neutral.text,
        userMessageBackground: neutral.chatUserBubble,
        assistantMessage: neutral.text,
        assistantMessageBackground: neutral.canvas,
        timestamp: neutral.textDim,
        divider: neutral.border,
      },
      tools: {
        background: withAlpha(neutral.toolsBackground, 0.3),
        border: withAlpha(neutral.border, 0.5),
        headerHover: withAlpha(neutral.borderStrong, 0.3),
        icon: neutral.textDim,
        title: neutral.text,
        description: neutral.textMuted,
        edit: {
          added: shared.statusSuccess,
          addedBackground: withAlpha(shared.statusSuccess, 0.15),
          removed: shared.statusError,
          removedBackground: withAlpha(shared.statusError, 0.15),
          modified: shared.statusInfo,
          modifiedBackground: withAlpha(shared.statusInfo, 0.15),
          lineNumber: neutral.borderStrong,
        },
      },
    },
    config: {
      fonts: {
        sans: '"IBM Plex Mono", monospace',
        mono: '"IBM Plex Mono", monospace',
        heading: '"IBM Plex Mono", monospace',
      },
      radius: {
        none: '0',
        sm: '0.125rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
      transitions: {
        fast: '150ms ease',
        normal: '250ms ease',
        slow: '350ms ease',
      },
    },
  };
}

function writeTheme(theme, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `${theme.metadata.id}.json`;
  const outputPath = path.join(outDir, fileName);
  fs.writeFileSync(outputPath, `${JSON.stringify(theme, null, 2)}\n`);
  return outputPath;
}

function run() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.palette) throw new Error('Missing required argument: --palette <path>');
  if (!['light', 'dark', 'both'].includes(args.variant)) {
    throw new Error(`Invalid variant: ${args.variant}. Use light|dark|both`);
  }
  if (!Object.keys(PROFILE_CONFIG).includes(args.normalization)) {
    throw new Error(`Invalid normalization level: ${args.normalization}`);
  }

  const palettePath = path.resolve(args.palette);
  if (!fs.existsSync(palettePath)) throw new Error(`Palette file does not exist: ${palettePath}`);

  const source = loadJsonWithComments(palettePath);
  const metadata = stripCommentKeys(source.metadata || {});
  const palette = source.palette || {};
  const variants = args.variant === 'both' ? ['light', 'dark'] : [args.variant];
  const resolvedOutDir = path.resolve(args.outDir);
  const defaultThemesDir = path.resolve(DEFAULT_OUT_DIR);

  const outputs = [];
  const generatedThemeIds = [];
  for (const variant of variants) {
    const resolved = resolveVariantPalette(palette, variant);
    const normalized = normalizePalette(resolved, variant, args.normalization);
    const theme = buildTheme(metadata, normalized, variant, args.normalization);
    generatedThemeIds.push(theme.metadata.id);
    outputs.push(writeTheme(theme, resolvedOutDir));
  }

  let registration = null;
  if (args.register) {
    if (resolvedOutDir === defaultThemesDir) {
      registration = registerThemesInPresets(generatedThemeIds);
    } else {
      console.log('Skipped presets.ts auto-registration because --out-dir is not the themes directory.');
    }
  }

  console.log(`Generated ${outputs.length} theme file(s):`);
  outputs.forEach((output) => console.log(`  - ${output}`));

  if (registration) {
    if (registration.updated) {
      console.log(`Updated presets.ts with ${registration.count} generated theme id(s).`);
    } else {
      console.log('No presets.ts updates needed (all generated themes already registered).');
    }
  }
}

try {
  run();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
