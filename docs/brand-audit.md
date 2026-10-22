# Auditoría de marca — Loop Smiths → Loopchat

**Fecha:** 2026-10-21 · **Nivel de verificación:** VERIFICADO en el sitio publicado (navegador real del usuario, CSS y fuentes computadas). La paleta histórica del repositorio se contrastó y se documentan diferencias.

## Fuentes inspeccionadas

| Fuente | Método | Resultado |
|---|---|---|
| https://loop-smith.com (publicado) | Navegador integrado: `getComputedStyle`, `css/dist.css`, `<link>`/fuentes, captura móvil | ✅ |
| https://github.com/cosmear/LoopSmithWeb/blob/main/styles.css (histórico) | Lectura del CSS | ✅ (parcial: archivo de 1046 líneas) |
| `assets/images/logo.png`, `favicon.svg` (sitio) | Inspección; el favicon es un PNG embebido en SVG | No se copiaron (ver abajo) |

Evidencia: `docs/evidence/brand-loop-smith-home-mobile.jpg` (captura del sitio publicado, móvil).

## Identidad publicada (prevalece)

| Token del sitio (Tailwind) | Valor | Uso en el sitio |
|---|---|---|
| `primary` | `#A3E635` (lime-400) | CTA, palabra destacada del logo, acentos, `meta theme-color` |
| `primary-dark` | `#4D7C0F` | texto de acento sobre fondo claro |
| `secondary` | `#10B981` (emerald-500) | degradé del isotipo `from-primary to-secondary` |
| `background-light` | `#F0FDF4` | fondo general |
| texto | `#1E293B` / `#0F172A` (slate-800/900) | cuerpo y títulos |
| neutros | slate-500/600 (`#64748B`, `#475569`) | secundarios |

- **Tipografías:** `Inter` (cuerpo, variable, self-hosted) y `Space Grotesk` (display/títulos), ambas SIL OFL. Íconos: Material Icons Round.
- **Logotipo:** cuadrado redondeado con degradé lima→esmeralda y wordmark "Loop**Smith**" con "Smith" en lima.

## Paleta histórica (repo) vs. sitio actual

| Histórico | Hex | ¿En el sitio actual? | Decisión |
|---|---|---|---|
| brand-lime | `#C7EA46` | No (el sitio usa `#A3E635`) | Se usa `#A3E635` |
| brand-deep-green | `#307351` | No (el sitio usa emerald `#10B981` / `#047857`) | Se usa la familia emerald |
| ink | `#1A1A1A` | Similar (slate-900 `#0F172A`) | Se usa slate-900 |
| warm-cream / warm-taupe / soft-cyan / brand-purple | — | No | No se usan |

**Discrepancia documentada:** la paleta histórica quedó desactualizada; según `ASSETS_AND_ART_DIRECTION.md` §2 prevalece la web real.

## Tokens de Loopchat (src/app/globals.css)

- `--brand #A3E635` solo para foco/selección, CTA principal, badges de conteo y marcadores de estado activo; nunca fondo de párrafos.
- `--brand-strong #4D7C0F` (contraste 5,0:1 sobre blanco) para íconos/textos de acento.
- `--secondary #10B981` / `--secondary-strong #047857` para "bot".
- Fondo `#F5F7F3` (derivado neutro del `#F0FDF4` del sitio, menos saturado para jornadas largas), superficies blancas, bordes 1 px.
- Texto principal `#0F172A`, secundario `#334155`, atenuado `#5B6577` (≥ 4,5:1 sobre blanco).
- Estados semánticos (danger/success/warning/info) independientes del color de marca; siempre acompañados de texto.

## Assets

- **No se copió el logo PNG del sitio** (es una imagen de 1200×630 para redes, sin versión vectorial y sin licencia explícita en el repo). Se diseñó un **isotipo original de Loopchat** (lazo continuo sobre el degradé de marca) en `src/components/ui/logo.tsx` y `public/icon.svg`, con atribución "by Loop Smiths".
- Fuentes vía paquetes `@fontsource-variable/inter` y `@fontsource-variable/space-grotesk` (OFL, self-hosted, sin llamadas a Google).
