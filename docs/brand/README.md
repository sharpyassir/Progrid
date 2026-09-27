# Progrid brand assets

The official logo is the file `progrid-logo.pdf` in this folder. Everything else here is derived from it.

| File | Use |
|---|---|
| `progrid-logo.pdf`, `progrid-logo.jpg` | The source logo as delivered. |
| `progrid-mark.svg` | The grid mark on white or light backgrounds. Used in the website footer, docs header and console. |
| `progrid-mark-white.svg` | The grid mark on dark backgrounds. Used in the website header. |
| `progrid-logo.png` | Horizontal lockup, mark plus wordmark. Used on invoices and in email headers. |
| `favicon.svg`, `favicon-64.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Browser and home screen icons. |
| `og-image.png` | Social preview image, 1200 by 630. |

Colors: logo blue `#0b47c9`, light square `#e4ecf9`, cyan dot `#1bb9e0`, navy for the CLOUD lettering `#0f2f78`. Tailwind `blue-600` and `cyan-400` are mapped to these in both apps.

Copies live in `apps/www/public/brand`, `apps/console/public/brand` and `apps/api/assets` so each app ships its own. Regenerate the rasters after changing an SVG by running the Playwright script used in the session, or any renderer at the sizes listed above.
