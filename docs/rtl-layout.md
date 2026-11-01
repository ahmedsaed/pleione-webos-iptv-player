# Right-to-left layout

How the app mirrors its UI for a right-to-left locale. Arabic is the only one
today; the mechanism is keyed off the locale's direction, so Hebrew, Persian,
or Urdu need only a catalog and a flag.

| | |
|---|---|
| **Code** | `src/utils/direction.ts`, `scripts/css-transforms.mjs` (`mirrorStylesheet`), `src/services/theme-service.ts` (`applyDirection`), `src/engine-quirks.ts`, `index.html` |
| **Tests** | `e2e/rtl-layout.spec.ts`, `e2e/arabic-locale.spec.ts`, `src/utils/direction.test.ts`, `scripts/css-transforms.test.mjs` |

## 1. The switch

- A locale with `rtl: true` in `src/i18n/index.ts` reports `localeDirection()`
  `rtl`. The app sets `<html dir="rtl">` and swaps every stylesheet for its
  mirrored copy, then remembers the direction under `iptv_direction`.
- `index.html` reads `iptv_direction` before the first paint and points the
  stylesheet links at the mirrored set, beside the Interface size swap. The
  locale stays the source of truth: a stale cache only costs one swap.
- The pseudo-locale stays left to right.

## 2. Mirrored stylesheets

The build (`esbuild.config.mjs`) writes a mirrored copy of every stylesheet
to `css/rtl/` and `css/rtl/ui-<size>/`, through `mirrorStylesheet`:

- physical sides in property names (`margin-left`, `left`,
  `border-top-left-radius`) swap;
- `left`/`right` keywords (`text-align`, `float`, `transition`) swap;
- the second and fourth values of four-side shorthands, and corner radii,
  swap;
- `translateX`/`translate` and shadow x offsets negate;
- horizontal gradient angles and `to left|right`, and the x of
  `at <position>` and `background-position`, mirror.

Flex and grid rows mirror on their own through `direction`, so only physical
CSS needs the transform. A whole copy, not an overlay of `[dir="rtl"]` rules:
an overlay outranks every rule it does not restate, so its cascade could
never match the left-to-right one. The generated `legacy-webos-base.css`
mirrors with everything else, so its flex-gap margins land on the right side.

Write CSS left to right as usual. Two escape hatches:

- `/* rtl:ignore -- why */` before a declaration, rule, or at-rule keeps it
  as written. Use it for boxes JavaScript places by their left edge (the
  `<video>` preview), and for left-to-right islands (the password field, the
  marquee keyframes `sidebar.ts` signs itself).
- A rule whose selector names `[dir]` is written for one direction and is
  never mirrored (`html[dir="rtl"] .rtl-mirror`).

Inline styles are not transformed. Code that positions along a row writes
`inlineStart()` (`left`, or `right` in RTL) instead of `left`: the virtual
rails, the catalog grid, and the Guide's cells, ruler, and now line.

## 3. What mirrors, and what does not

**Mirrors:** every layout (Home cards, Live's three panes, Settings' page
list on the right, the side panels, overlays and prompts), rails and their
start, progress bars that measure watched content (catalog cards, Live rows,
Guide cells), toggles and segmented controls, and icons that point along the
reading direction: back, chevrons, and previous/next (`.rtl-mirror` on the
SVG, `transform: scaleX(-1)` under `[dir="rtl"]`).

**Stays as it is:** play/pause, media logos, clocks, and other icons that do
not point along the row; numbers, times, ranges, channel numbers, and episode
codes keep their own reading order; the password field, the parental PIN
slots, the typed channel number, and the setup page's pairing code read left
to right as digits do; the `<video>` element's box.

**Text.** `html[dir="rtl"] body * { unicode-bidi: plaintext }` gives every
text block the direction of its first strong character, so a Latin channel
name or a time range keeps its order inside the mirrored layout, and an
Arabic sentence reads right to left. Text aligns right, the layout's start
edge, whichever way it reads. Interpolated values in translated strings stay
isolated with LRM marks (`bidiIsolate`), since Chromium 53 predates the
isolate characters. A marquee name in the player's channel list reads in its
own direction (`dir="auto"`), so a long Latin name shows its start first.

## 4. Keys

Left and Right reach handlers as **logical** actions: in RTL the Left key
arrives as `'right'` (toward the end of a row) and Right as `'left'` (toward
its start). `KeyHandler` applies `logicalAction`; index-based handlers
(previous/next, rails, the side a panel opens from, seek) then need no
direction checks. Geometric code turns the action back into a screen side
with `screenSide`: `SpatialNav.move` and Settings' row peer. New geometric
code must do the same.

Text inputs keep the native caret: `KeyHandler` never maps keys typed into a
field, and `caret-edge.ts` works in screen sides.

## 5. scrollLeft

A right-to-left scroller starts at its right edge, and engines disagree on
what `scrollLeft` reports there:

| Model | At the start (right edge) | At the left end | Engines |
|---|---|---|---|
| standard | `0` | `-(scrollWidth - clientWidth)` | Chromium 85+ |
| default | `scrollWidth - clientWidth` | `0` | Chromium before 85 (webOS 4-6) |

`src/engine-quirks.ts` measures the model at boot with a hidden RTL scroller
and sets `html.q-rtl-scroll-default` for the old one. `src/utils/direction.ts`
reads and writes offsets in either model:

- `scrollStart` / `setScrollStart`: from the row's start, for virtual rails
  (`VirtualScrollGuard`), whose offsets count from the first item;
- `scrollFromLeft` / `setScrollFromLeft`: from the left edge, for geometry
  against `getBoundingClientRect` (rail reveal, edge scroll);
- a relative `scrollLeft += delta` scrolls right in both models and needs no
  helper, which is how the `scrollIntoView` fallback in `src/polyfills.ts`
  works. That fallback also aligns `inline: 'start'` to an RTL row's right
  edge.

Never read or write an absolute horizontal `scrollLeft` directly. The
`chromium-53-simulation` E2E project reports the old model on every RTL
scroller (`removeApis` in `scripts/chromium-53-simulation.mjs`), so the
engine-quirks probe measures it and every RTL rail test runs against both
models.

## 6. The Guide

Native right-to-left program guides mirror the time axis, so the Guide does
too: time runs from right to left, the channel column sits at the right, the
ruler, cells, now line, and a live cell's progress run from the right, and
Left pages to later programs. `cellBox` still returns offsets from the
window's start; the template writes them with `inlineStart()`.

## 7. The player

The seek bar mirrors: it fills from the right with the elapsed time beside
it, the duration at the left, and Left seeks forward. Previous sits right of
Play/Pause and Next left of it, their icons turned; Play is not turned, and
the transport stays centered. This follows Apple's guidance, which mirrors
progress controls and keeps tape-direction glyphs; Material instead keeps
the media timeline left to right. To switch to that, mark the progress row
and the transport `rtl:ignore`, drop `.rtl-mirror` from the previous/next
icons, and turn `seekKey`'s direction back with `screenSide`.

The audio and subtitle menu hangs from the left end of the controls, and the
full-screen channel list opens from the right edge with Right.

## 8. Adding a right-to-left locale

1. Add its catalog and entry in `src/i18n/index.ts` with `rtl: true` (and an
   `intlLocale` if its digits should stay Western, as Arabic's do).
2. Add it to `RTL_LOCALES` in `bundled-service/src/setup/setup-page.html`.
3. Extend `bidiIsolate`'s `RTL_CHAR` and `caret-edge.ts` if the script falls
   outside the Arabic and Hebrew blocks they cover.
4. Run `e2e/rtl-layout.spec.ts` with the new locale, and check the TV's font
   covers the script.

## 9. Needs a TV

- The `q-rtl-scroll-default` probe and the scroll helpers are verified in the
  simulation, which models the old `scrollLeft` arithmetically; the real
  webOS 4-6 engines should be checked once.
- `unicode-bidi: plaintext` must fall back to left to right for text with no
  letters (times, ranges) on Chromium 53, as it does today; the typed
  channel number and PIN slots set `direction: ltr` regardless.
- The `LG Smart UI` font's Arabic shaping and the mirrored glyph widths.
