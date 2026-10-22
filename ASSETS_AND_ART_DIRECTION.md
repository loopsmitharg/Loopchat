# ASSETS_AND_ART_DIRECTION.md — Dirección visual de Loopchat

## 1. Personalidad visual y experiencia

**Loopchat es una herramienta de trabajo cotidiana, de alta densidad funcional**. Debe transmitir orden, eficacia, control, atención humana e inteligencia bien integrada. Se inspira en la identidad de Loop Smiths (https://loop-smith.com), NO en un CRM blanco genérico ni en una landing de IA. Prima la legibilidad durante largas sesiones, con UI rápida y calmada.

**Prioridad visual:** bandeja + chat + contexto comercial, luego pipeline y constructor visual. Estilo moderno, preciso, con espacios controlados, jerarquía tipográfica clara y color de marca reservado a lo que requiere atención.

## 2. Paleta y procedimiento de verificación

**Paleta histórica comprobada** en `https://github.com/cosmear/LoopSmithWeb/blob/main/styles.css`, NO necesariamente idéntica a la versión publicada vigente:

| Token de referencia | Hex | Uso propuesto |
|---|---|---|
| `brand-lime` | `#C7EA46` | selección, CTA, badges acotados, foco |
| `brand-deep-green` | `#307351` | acento secundario, fondos selectivos |
| `ink` | `#1A1A1A` | texto principal / superficies oscuras |
| `warm-cream` | `#DBD2C8` | fondos alternativos cálidos |
| `warm-taupe` | `#8B8589` | secundarios, borde/acento neutro |
| `soft-cyan` | `#A8DADC` | estados informativos poco frecuentes |
| `brand-purple` | `#631D76` | acento histórico, no saturar dashboard |

**Acción obligatoria de fase inicial:** abrir la web publicada en navegador, inspeccionar CSS variables/assets/logo/fonts reales, capturar desktop/mobile y guardar evidencia (`docs/brand-audit.md`). Si existe diferencia entre web real y paleta histórica, prevalece la web real y documentar discrepancia. Si no se puede verificar por red, usar paleta histórica marcada *provisional*; no afirmar que la identidad final fue verificada.

Definir roles semánticos (`--background`, `--surface`, `--text-primary`, `--text-muted`, `--border`, `--brand`, `--brand-foreground`, `--focus`, `--danger`, `--success`, `--warning`) y sus variantes contrastadas. No usar el lima como fondo de párrafos largos. No usar color solamente para codificar estados de negocio.

## 3. Tipografía, espacio y formas

- Tipografía: **extraer la de Loop Smiths actual**; fallback Inter/system-ui (Inter aparece en CSS histórico). Tipografía de cuerpo legible a 14–16px; labels/metadata secundarios no bajar de legibilidad real.
- Escala espaciado: base 4px, incrementos 4/8/12/16/24/32; paddings de filas densas 10–14px según área. No crear tarjetas enormes en cada acción.
- Bordes/sombras: superficies discretas, bordes de 1px, radios moderados (6–10px); sombra solo para overlays/popovers. Nada de sombras flotantes en cada tarjeta.
- Layout desktop: navegación lateral estrecha, topbar con tenant/search/account, paneles de inbox de lista/chat/contexto; navegación consistente. Al abrir chat usar ancho generoso; panel lateral plegable.
- Pipeline: columnas suficientes para estado y valor; drag-and-drop con feedback; acciones alternativas accesibles para teclado/táctil.
- Editor visual: nodos con tipología inequívoca y conectores legibles; validación inline; panel de propiedades, zoom, minimap solo cuando ayuden. Aplicar patrón de diseño funcional, no lienzo decorativo.

## 4. Iconos, assets y contenidos

- Iconografía consistente, trazo uniforme, preferentemente Lucide; acompañar iconos ambiguos de labels/tooltips; no emojis como iconografía estructural.
- Logos e identidad real de Loop Smiths. Copiar assets propios del repo de marca **solo** cuando sus derechos y versión estén claros. Nombre visible: **Loopchat**; atribución discreta “by Loop Smiths” donde corresponda.
- Evitar fotografías de stock en la app. Avatares con iniciales, adjuntos reales o placeholders neutrales. Gráficos solo para preguntas concretas.
- Datos demo creíbles de negocio y claramente rotulados `DEMO`, nunca aparentar mensajes reales; usar nombres ficticios sin datos sensibles.

## 5. Estados y microinteracciones

- UI completa para: loading/skeleton proporcionado, lista vacía, primera conexión, conversación no encontrada, sin permiso, offline, error de Meta, falla de IA, cupo agotado, bot pausado, envío en curso/entregado/fallido, webhook duplicado/reintento, conexión desconectada y modo simulación.
- Foco visible, navegación teclado, acciones accesibles, confirmaciones solo en tareas peligrosas (desconectar número, borrar bot, perder edición), feedback inmediato al guardar y estados persistidos.
- Motion sutil (120–220ms orientativo), transiciones que enseñan jerarquía y no distraen. Respetar `prefers-reduced-motion`; cero animación superflua durante chats intensos.

## 6. Responsive y accesibilidad

- Probar 1440px / 1280px desktop, 768px tablet y 390px / 375px móvil. Desktop es el uso más productivo, móvil es plenamente funcional para responder mensajes, consultar pipeline y asignar.
- En móvil, bandeja → conversación → ficha contextual como pantallas/overlays navegables, no tres columnas comprimidas. Editor visual puede usar controles alternativos de nodos en móvil, sin ocultar operaciones críticas.
- WCAG AA cuando aplique: contraste mínimo, focus, labels de inputs, lectores de pantalla, errores relacionados con campos y jerarquía semántica. Color de marca no sustituye texto de estado.

## 7. What this must NOT look like

- NO “generic SaaS”, “AI slop”, gradientes aleatorios, glassmorphism excesivo o panel entero morado sin relación con Loop Smiths.
- NO landing promocional disfrazada de CRM; no hero gigante con texto comercial dentro del espacio de trabajo.
- NO dashboard cargado de tarjetas/KPIs inútiles; prioridad a conversaciones y seguimiento real.
- NO Chatwoot rebrandeado superficialmente ni copia pixel-perfect de Kommo.
- NO chat con burbujas gigantes o espacios vacíos que reduzcan mensajes útiles por pantalla.
- NO componentes inconsistentes, estados falsos, botones sin función, datos inventados como reales ni animaciones invasivas.
- NO estética videojuego/cyberpunk o iconos IA decorativos; el producto es software B2B.

## 8. Estrategia de assets

Orden: 1) assets verificados de Loop Smiths y proyecto; 2) assets originales creados para Loopchat; 3) bibliotecas con licencia compatible; 4) generación asistida SOLO cuando un gráfico único aporte valor; 5) placeholders exclusivamente en prototipo.

Para assets externos conservar URL de origen, autor, licencia, fecha y atribución en `docs/asset-sources.md`; no hotlinkear imágenes externas a producción. Nunca compartir fuentes tipográficas no redistribuibles. Validar derechos de íconos, logos de Meta y marcas de terceros; no presentarse como asociado oficial sin permiso.

## 9. Control de calidad visual

Para cada vista terminada: captura desktop y móvil, contraste, overflow, acciones, estado vacío y de error; comparar visualmente con branding publicado y revisar coherencia entre inbox, pipeline y bots. Inspeccionar en navegador real cuando esté disponible; código compilado no prueba buen diseño.
