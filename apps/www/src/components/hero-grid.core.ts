/**
 * The live hero background: a field of rounded squares in the logo's grid. Squares blink on in
 * brand blue at random, slowly, like activity across a cluster. At the end of every loop the
 * squares around the center settle into the Progrid mark (4 by 5 with the cyan dot), hold, and
 * dissolve back into the field. Pure canvas, no dependencies, and it pauses when off screen or
 * when the visitor prefers reduced motion (then it shows the mark, still).
 */

const PITCH = 36; // grid pitch in CSS pixels
const CELL = 22; // square size
const RADIUS = 5;
const LOGO_SCALE = 1.5; // one logo cell spans this many grid cells
const BOTTOM_GAP = 56; // space under the mark, before the hero ends
const LIVE_MS = 9000; // random blinking
const FORM_MS = 1800; // squares converge into the mark
const HOLD_MS = 3200; // the mark stays
const RELEASE_MS = 1400; // back to the field
const LOOP_MS = LIVE_MS + FORM_MS + HOLD_MS + RELEASE_MS;

// B = blue, L = light, C = cyan dot. Same pattern as public/brand/progrid-mark.svg.
const MARK = ['BBBL', 'BLLC', 'BBBL', 'BLLL', 'BLLL'];

const BLUE = [59, 123, 255]; // lit square on the dark hero
const LOGO_BLUE = [43, 109, 240];
const LIGHT = [255, 255, 255];
const CYAN = [27, 185, 224];

type Cell = { x: number; y: number; alpha: number; target: number; nextAt: number; offAt: number; seed: number };

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Starts the animation on a canvas and returns a function that stops it. Framework free so the same code runs in the static preview. */
export function mountHeroGrid(canvas: HTMLCanvasElement): () => void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cells: Cell[] = [];
    let cols = 0, rows = 0, width = 0, height = 0;
    let logo = { x: 0, y: 0, size: 0, pitch: 0 };
    let visible = true;
    let raf = 0;
    const start = performance.now();

    function layout() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / PITCH) + 1;
      rows = Math.ceil(height / PITCH) + 1;
      const offX = (width - (cols - 1) * PITCH) / 2 - CELL / 2;
      const offY = (height - (rows - 1) * PITCH) / 2 - CELL / 2;
      const now = performance.now();
      cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          cells.push({ x: offX + c * PITCH, y: offY + r * PITCH, alpha: 0, target: 0, nextAt: now + Math.random() * 24000, offAt: 0, seed: Math.random() });
        }
      }
      // The mark forms in the clear band at the bottom of the hero, centered, snapped to the grid.
      const lp = PITCH * LOGO_SCALE;
      const size = lp - (PITCH - CELL);
      const w = 4 * lp - (PITCH - CELL), h = 5 * lp - (PITCH - CELL);
      const gx = Math.round((width / 2 - w / 2 - offX) / PITCH), gy = Math.round((height - BOTTOM_GAP - h - offY) / PITCH);
      logo = { x: offX + gx * PITCH, y: offY + gy * PITCH, size, pitch: lp };
    }

    function underLogo(cell: Cell) {
      const w = 4 * logo.pitch, h = 5 * logo.pitch;
      return cell.x + CELL > logo.x - PITCH / 2 && cell.x < logo.x + w - PITCH / 2 + PITCH && cell.y + CELL > logo.y - PITCH / 2 && cell.y < logo.y + h - PITCH / 2 + PITCH;
    }

    function drawLogo(alpha: number, scale: number) {
      if (alpha <= 0) return;
      const w = 4 * logo.pitch - (logo.pitch - logo.size), h = 5 * logo.pitch - (logo.pitch - logo.size);
      ctx!.save();
      ctx!.translate(logo.x + w / 2, logo.y + h / 2);
      ctx!.scale(scale, scale);
      ctx!.translate(-(logo.x + w / 2), -(logo.y + h / 2));
      MARK.forEach((row, ry) => {
        row.split('').forEach((ch, rx) => {
          const x = logo.x + rx * logo.pitch, y = logo.y + ry * logo.pitch, s = logo.size;
          if (ch === 'C') {
            ctx!.fillStyle = rgba(CYAN, alpha);
            ctx!.beginPath(); ctx!.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2); ctx!.fill();
          } else {
            ctx!.fillStyle = ch === 'B' ? rgba(LOGO_BLUE, alpha) : rgba(LIGHT, alpha * 0.22);
            roundedRect(ctx!, x, y, s, s, RADIUS * 1.6); ctx!.fill();
          }
        });
      });
      ctx!.restore();
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const t = (now - start) % LOOP_MS;
      // Phase weights: how much of the mark is showing, and how much the field under it is hidden.
      let mark = 0;
      if (t >= LIVE_MS && t < LIVE_MS + FORM_MS) mark = ease((t - LIVE_MS) / FORM_MS);
      else if (t >= LIVE_MS + FORM_MS && t < LIVE_MS + FORM_MS + HOLD_MS) mark = 1;
      else if (t >= LIVE_MS + FORM_MS + HOLD_MS) mark = 1 - ease((t - LIVE_MS - FORM_MS - HOLD_MS) / RELEASE_MS);
      if (reduced) mark = 1;
      const forming = t >= LIVE_MS;

      ctx!.clearRect(0, 0, width, height);
      for (const cell of cells) {
        // Random blinking: a cell waits, lights for a while, then rests. Slow, so it reads as calm activity.
        if (!reduced) {
          if (cell.target === 0 && now >= cell.nextAt && !forming) {
            cell.target = 0.35 + cell.seed * 0.45;
            cell.offAt = now + 1400 + Math.random() * 2200;
          } else if (cell.target > 0 && now >= cell.offAt) {
            cell.target = 0;
            cell.nextAt = now + 12000 + Math.random() * 30000;
          }
        }
        // During the mark, squares near it gather into it: the field underneath fades out and the mark takes over.
        const hide = underLogo(cell) ? mark : 0;
        const goal = cell.target * (1 - hide) * (forming ? 1 - mark * 0.6 : 1);
        cell.alpha += (goal - cell.alpha) * 0.035;
        const base = 0.06 * (1 - hide);
        ctx!.fillStyle = rgba(LIGHT, base);
        roundedRect(ctx!, cell.x, cell.y, CELL, CELL, RADIUS); ctx!.fill();
        if (cell.alpha > 0.01) {
          ctx!.fillStyle = rgba(BLUE, clamp01(cell.alpha) * 0.85);
          roundedRect(ctx!, cell.x, cell.y, CELL, CELL, RADIUS); ctx!.fill();
        }
      }
      drawLogo(mark, 0.94 + 0.06 * mark);
    }

    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
}
