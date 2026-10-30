# Teaching diagrams: explain a trading concept with candles

When the operator says he does not understand a rule ("pls illustrate with proper candlestick"), the answer
is a DRAWN chart with his own five rules numbered on it — not more prose, and not a screenshot of live
price action that happens to contain the pattern.

## Recipe (no plotting library needed)

1. **Generate an SVG from a small Python script** — candles, levels, callouts are ~10 lines each, and SVG
   gives exact control over label placement (matplotlib is not installed in this repo's venv; do not stop to
   install it for one picture).
2. **Render at 2x with the Playwright chromium:**
   `--headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=<W>,<H>\
   --virtual-time-budget=4000 --screenshot=out.png file:///…/lesson.svg`
   (binary under `~/Library/Caches/ms-playwright/chromium_headless_shell-1243/…`). A few `ERROR` lines on
   stderr are normal; judge the PNG, not the log.
3. **Verify with `vision_analyze` before sending** — ask specifically whether each level label is fully
   visible, whether the target sits inside the canvas, and whether anything overlaps.
4. Send with `MEDIA:/abs/path.png` and three lines of caption: the rule in one sentence, what the inset
   shows, and the Pine expression of the same test.

## Layout rules that cost iterations

- **Reserve a band for insets.** A zoom box placed over the price area covers a level label (it hid the
  sweep-low line). Put insets in a footer band below the plot, next to the one-sentence rule.
- **Fit every level in the y-range before drawing** — `lo = min(candle lows, stop)`, `hi = max(candle highs,
  target)`. A 2R target computed from the entry routinely lands above the candles and disappears off-canvas.
- **Number the callouts to match the operator's own list of rules** (1 session, 2 prior low/liquidity,
  3 sweep, 4 displacement, 5 pullback entry). The diagram is the spec, not a generic "sweep" illustration.
- Left-align the price axis labels, keep the footer in one font size, dark background matching the console.
- The teaching pair for a sweep: prior swing low (dashed), a candle whose **wick** pierces it and whose body
  **closes back above**, then the leg up with 0/50% fib lines, the limit entry at 50%, the stop under the
  wick, and the target beyond. Caption the distinction that matters: a candle that CLOSES below is a
  breakdown, not a sweep, and the setup does not fire.
