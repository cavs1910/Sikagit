# SikaGit: contexto para continuar en otra sesión

Este archivo permite trabajar sin el chat original. Leelo antes de cambiar el proyecto y verificá el estado real: las rutas y decisiones siguientes corresponden a esta instalación privada; las versiones y cantidades de pruebas pueden avanzar.

## Proyecto y ubicación

- Código fuente: `/home/codex/projects/sikagit` (`~/projects/sikagit`). Es la única copia de trabajo del fork; los antiguos nombres `sikagit-audit` y `sikagit-web` no son sus rutas actuales.
- Fork: `https://github.com/cavs1910/Sikagit`; rama de trabajo y predeterminada: `hardening/private-server`. Upstream: `https://github.com/AhmedSayedSk/Sikagit`.
- Es un cliente Git web sobre archivos reales del servidor, accesible desde dispositivos de la tailnet. El usuario prefiere componentes existentes y livianos, integrados en la interfaz actual.
- Conservá `LICENSE`: la licencia del proyecto upstream no es MIT. La atribución MIT de models.dev está en `docs/third-party/models.dev.LICENSE` y en el catálogo incluido.

## Código versus instalación

- Instalación privada: `~/.local/share/sikagit/`. Allí están `compose.yaml`, `data/`, `secrets/`, `gitconfig`, `backups/` y `security-reports/`. No deben moverse dentro de `~/projects` ni entrar en Git.
- Compose monta `/home/codex/projects` como `/repos`, sin copiar archivos. Ejemplos: `~/projects/sikagit` → `/repos/sikagit`; `~/projects/cavs1910/cleanui` → `/repos/cavs1910/cleanui`.
- Para agregar repos, crearlos/clonarlos dentro de `~/projects` y registrar su ruta `/repos/...` en la UI. Las carpetas comunes no se convierten automáticamente en repositorios.
- Contenedor: `sikagit-web-sikagit-1`, proyecto Compose `sikagit-web`. Escucha en `127.0.0.1:8448`; Tailscale Serve lo publica por HTTPS en el puerto **8444**. Consultar `PUBLIC_ORIGIN` en el Compose privado para conocer el hostname.
- La app ejecuta el código compilado de la imagen, no el source montado para administrarlo con Git. Editar el source se refleja en Git; cambiar la aplicación requiere reconstruir y recrear el contenedor.
- El Compose del repositorio es una plantilla. El despliegue activo usa `~/.local/share/sikagit/compose.yaml`; comprobar allí la etiqueta de imagen actual.

## Arquitectura y funciones añadidas

- Monorepo npm: `client/` (React 19, Vite, Tailwind, Zustand), `server/` (Express, Socket.IO, simple-git, better-sqlite3), `shared/` (tipos). Node **22** para el backend/AI SDK.
- AI: Vercel AI SDK, ocho proveedores directos y Vercel AI Gateway (administrado o BYOK), conexiones guardadas por proveedor, claves cifradas sólo en el servidor, configuración compartida entre dispositivos. Sugerencias de commit, Smart Commit y guardar para después siguen disponibles. Ver `docs/AI_CONFIGURATION.md`.
- Idiomas de sugerencias: **English** y **Match project**; el default es **Match project** (`auto`). Preferencias antiguas en Español se normalizan a `auto`; English y las claves existentes se conservan.
- Modelos: selector con búsqueda, precios separados de entrada/salida en USD por millón de tokens, caché y fallback incluido. OpenRouter y Vercel AI Gateway usan sus APIs públicas; los proveedores directos restantes, models.dev. Precio desconocido no significa gratis. Mantener el ID manual avanzado para modelos privados.
- Editor: pestaña **Files**, CodeMirror 6 y lenguajes cargados bajo demanda. Edita archivos existentes UTF-8 de hasta 1 MiB, conserva borradores en memoria y detecta cambios externos. Guardar no hace stage/commit. Ver `docs/FILE_EDITOR.md`.

- Estado por repo: cachés en memoria separadas por ruta (hasta 8 repos, historial hasta 1.000 commits), selección sincronizada y respuestas tardías aisladas. Switch de ignorados junto a Files; cabecera móvil con repo/rama/settings; quitar bookmark dentro de Settings. Ver `docs/MOBILE_LAYOUT.md` y `docs/REMOTE_STATUS.md`.

- Ramas: el selector incluye **Merge…** (otra rama → actual) y **Merge To…** (actual → destino local). Merge To exige un árbol limpio, valida la rama activa y cambia/fusiona bajo el mutex. Permanece en destino al terminar o abortar; no hace push. La papelera por rama permite borrar locales (force explícito) y remotas con lease contra el último Fetch, conservando sus contrapartes. **Clean up merged branches…** ofrece vista previa por ascendencia contra main/master, selección local/remota, planes ligados a commits y resultados por rama; nunca fuerza el borrado y omite squash/cherry-picks sin ascendencia. Ver `docs/MOBILE_LAYOUT.md`.

- Publicación: indicador de rama junto a Push y nubes por commit, basados en referencias remotas locales (último Fetch), sin consultas de red por fila. Ver `docs/REMOTE_STATUS.md`.

- Login: formulario propio con `express-session` y sesiones revocables de 365 días en la SQLite existente; `AUTH_FILE` conserva el usuario/contraseña. Shell y assets públicos en el servicio privado, APIs y Socket.IO autenticados. Ver `docs/AUTHENTICATION.md`.

- Mobile: debajo de 768 px usa menú de repositorios y vistas separadas de historial/cambios/detalle. El editor pliega el explorador y los diálogos se adaptan al viewport. Ver `docs/MOBILE_LAYOUT.md`.

## Límites de seguridad que deben conservarse

Leé `docs/SECURITY_REVIEW.md` antes de cambiar Git, autenticación, rutas o Docker. Ese informe describe una base histórica; las funciones posteriores tienen su propia documentación y pruebas.

- Autenticación HTTP/Socket.IO, validación de Origin, cookies firmadas y CSP. Mantener el servicio privado; no abrir el backend a Internet.
- `server/src/security.ts` confina acceso a repositorios y archivos. No habilitar acceso a `.git`, escapes de ruta o symlinks para sortear una validación. El editor además rechaza hard links, binarios y archivos especiales.
- Git usa `git-policy.mjs` y `git-credential.mjs`: no restaurar ejecución de hooks, filtros, comandos configurados por el repo ni entrega de credenciales a hosts arbitrarios. No usar shell interpolado con rutas/revisiones.
- Smart Commit valida un plan ligado a HEAD/index y conserva el staging parcial. Guardados del editor usan revisión y reemplazo atómico. No quitar estos controles para resolver conflictos.
- Runtime: UID/GID 1001, rootfs read-only, capabilities eliminadas, sin Docker socket, límites de recursos. `Dockerfile` y `Dockerfile.reviewed` deben mantenerse equivalentes salvo el comentario del primero.
- Nunca publicar ni imprimir claves, contraseñas, tokens, archivos privados o sus contenidos. Los catálogos públicos no reciben claves ni diffs. No hacer llamadas AI facturables sólo para probar la interfaz: usar mocks.

## Trabajo y verificación

1. Revisar `git status`, instrucciones adicionales y cambios del usuario; no descartarlos ni incluirlos accidentalmente en commits.
2. Mantener cambios acotados, actualizar documentación relevante y guardar el trabajo solicitado en el fork. No hacer pushes de prueba a otros repositorios montados.
3. Para desarrollo: `npm ci --ignore-scripts` y `npm run dev`. La dependencia nativa SQLite se compila dentro del build Docker; no asumir que una instalación sin scripts la vuelve ejecutable en el host.
4. Verificación reproducible en la imagen, sin red ni repos/credenciales reales:

   ```sh
   sh scripts/test-security.sh
   # En este servidor, si hace falta el grupo Docker:
   sg docker -c 'sh scripts/test-security.sh'
   ```

   La última ejecución de referencia pasó **67 pruebas**. Backend TypeScript y Vite compilan. El chequeo estricto del frontend conserva **35 diagnósticos preexistentes**: no declarar que pasa ni confundirlos con regresiones. Comparar contra la base si cambian.
5. Para UI, probar el recorrido en navegador; para escrituras o AI usar fixtures desechables, no datos reales ni llamadas pagas. Para cambios de dependencias/seguridad, revisar npm audit y los escaneos apropiados. Los reportes privados están fuera del source.
6. Para un despliegue de cambios de aplicación solicitado: respaldar SQLite mediante su API de backup (no copiar sólo el `.db` activo), conservar la imagen previa y reconstruir desde el Compose privado:

   ```sh
   cd ~/.local/share/sikagit
   docker compose up -d --build
   ```

   Verificar salud autenticada, imagen activa y funciones afectadas; conservar credenciales y estado. No usar los Compose del source para recrear accidentalmente otra instalación. Un cambio sólo documental no requiere desplegar.

## Pendientes conocidos, todavía sin corregir

- Se reportó una carga lenta al volver después de horas. El contenedor no se había reiniciado ni sufrido OOM; mediciones posteriores eran rápidas. No quedó una traza del navegador que identifique la causa exacta.
- Falta feedback más claro de etapas de carga, tiempos y reintentos; `client/src/lib/api.ts` no establece timeout general. La primera descarga del bundle se observó sin compresión. Auto-fetch puede consultar GitHub al abrir un repo, pero no debe impedir mostrar primero el estado local.
- Hubo errores `bad object` con hashes que existen en cleanui. Ahora se aíslan status, refs, historial, selección y archivos de commit por repositorio, con pruebas A → B → A y respuestas fuera de orden. Esto corrige cruces de estado reproducibles; no confirma la causa exacta de aquel reporte ni de la demora original, ni indica corrupción.
- La demora original y el feedback general de carga siguen pendientes de una traza que permita diagnosticarlos; la separación de estado por repo sí está implementada y probada.
