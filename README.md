# Kakeibo · control de gastos

Sustituto del Excel de gastos mensuales, con un apartado de estadísticas.
Es una aplicación web estática: **no hay servidor ni base de datos**, los datos
viven en el navegador del dispositivo, así que se puede alojar gratis para
siempre en GitHub Pages.

- Una pestaña por **mes**: cinco categorías editables, importes en yenes y en la
  moneda secundaria, alquiler, extras fijos, límite y balance — las mismas
  cuentas que hacía el Excel.
- Un apartado de **estadísticas**: evolución mensual, composición por categoría,
  reparto del mes, ranking de conceptos, gasto medio por día y ritmo del mes.
- **Ahorros**: fotos del patrimonio por fechas, con deudas y varias divisas.
- **Importador del Excel original**: lee las hojas con las cabeceras japonesas
  (外食, スーパーマーケット, 服装と電車と毎月費消, 娯楽, 部屋のもの) y las
  convierte en meses de la aplicación.
- **Topes por categoría** además del límite del mes, con su aviso al pasarse.
- **Fijos automáticos**: al abrir un mes nuevo hereda alquiler, extras y gastos
  recurrentes del anterior.
- **Tipo de cambio** al día desde el Banco Central Europeo, o a mano.
- **Sincronización opcional** entre móvil y PC con Supabase (plan gratuito).
- Funciona **sin conexión** (PWA instalable) y se ve bien en móvil y en PC.
- Interfaz en español, japonés e inglés.

![Apartado de estadísticas](docs/estadisticas.jpg)

<p>
  <img src="docs/mes-movil.jpg" alt="Vista del mes en móvil" width="260" align="top">
  <img src="docs/estadisticas-oscuro.jpg" alt="Estadísticas en modo oscuro" width="520" align="top">
</p>

## Poner en marcha

```bash
npm install
npm run dev      # http://localhost:5173
```

Otros comandos:

| Comando | Qué hace |
| --- | --- |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Sirve el build para comprobarlo |
| `npm test` | Tests (vitest) |
| `npm run coverage` | Tests + informe de cobertura |
| `npm run lint` | ESLint |
| `npx tsc -b` | Comprobación de tipos |

## Publicar gratis en GitHub Pages

1. Crea un repositorio en GitHub y sube este proyecto:

   ```bash
   git remote add origin git@github.com:USUARIO/kakeibo.git
   git push -u origin main
   ```

2. En **Settings → Pages → Build and deployment**, elige **GitHub Actions**
   como origen (`Source: GitHub Actions`). No hay que crear ninguna rama
   `gh-pages`.

3. Cada `push` a `main` ejecuta `.github/workflows/deploy.yml`: instala, pasa
   los tests y, solo si pasan, publica. La aplicación queda en
   `https://USUARIO.github.io/kakeibo/`.

El workflow calcula la ruta base sola: si el repositorio se llama
`USUARIO.github.io`, o si añades un fichero `public/CNAME` con tu dominio, la
base pasa a ser `/`.

`.github/workflows/ci.yml` se ejecuta en todas las ramas y en cada pull request
(lint, tipos, tests con cobertura y build), y guarda el build y la cobertura
como artefactos.

### Otras opciones gratuitas

Al ser un sitio estático vale cualquier hosting: Cloudflare Pages, Netlify o
Vercel funcionan subiendo `dist/` (comando de build `npm run build`, carpeta
`dist`). En esos casos deja `VITE_BASE` sin definir, porque la app se sirve en
la raíz.

## Dónde se guardan los datos

Primero, siempre, en el navegador del dispositivo (`localStorage`, clave
`kakeibo:data:v1`), con guardado automático 250 ms después de dejar de escribir
y otro al cerrar la pestaña o cambiar de app. No hay botón de guardar.

Eso hace que la app funcione sin cobertura, pero también que cada dispositivo
tenga su copia. Hay dos formas de juntarlas:

- **A mano**: Ajustes → *Exportar datos* descarga un `.json` con todo, e
  *Importar datos* lo restaura en el otro dispositivo. Es también la copia de
  seguridad recomendada.
- **Automática**: la sincronización con Supabase que se describe abajo.

## Sincronizar el móvil y el PC (Supabase, plan gratuito)

1. Crea un proyecto en [supabase.com](https://supabase.com) (plan Free).
2. En **SQL Editor**, pega y ejecuta [`supabase/schema.sql`](supabase/schema.sql).
   Crea la tabla `kakeibo_docs` con RLS: cada usuario solo puede leer y escribir
   su propia fila.
3. En **Project Settings → API**, copia la *Project URL* y la clave *anon*.
4. En **Authentication → URL Configuration**, añade la dirección de la app
   (`https://USUARIO.github.io/kakeibo/`) a *Site URL* y a *Redirect URLs*, o el
   enlace del correo no sabrá volver.
5. En la app: **Ajustes → Sincronización**, pega URL y clave, escribe tu correo
   y pulsa *Enviarme el acceso*. Llega un correo con un enlace; al pulsarlo
   vuelves a la app ya con la sesión abierta. Repite en el otro dispositivo.

Si prefieres el código de seis dígitos en lugar del enlace (más cómodo en el
móvil), añade `{{ .Token }}` a la plantilla *Magic Link* en
**Authentication → Email Templates**; la app tiene el campo para pegarlo.

### Si el enlace del correo apunta a `localhost`

Supabase manda al **Site URL** del proyecto cuando el `redirect_to` que pide la
app no está en la lista blanca, o cuando no hay ninguno; y el Site URL por
defecto es `http://localhost:3000`. Dos causas posibles:

- **La app se está abriendo desde un archivo local** (`file://`, por ejemplo la
  vista previa de un solo fichero). Ahí no hay dirección a la que volver, así
  que la app no manda ninguna y Supabase usa el Site URL. Entra con el código
  de seis dígitos, o publica la app y entra desde su dirección.
- **Falta la dirección en Supabase.** Pon la dirección publicada en *Site URL*
  y añádela a *Redirect URLs*. La app te enseña, en Ajustes → Sincronización,
  la dirección exacta que va a pedir: cópiala tal cual.

En *Redirect URLs* vale también un patrón, útil si sirves la app desde varios
sitios: `https://USUARIO.github.io/kakeibo/**`.

También puedes dejar URL y clave fijas en el build con `VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY` (ver [`.env.example`](.env.example)); en un repositorio
público quedarían a la vista, y por eso por defecto se escriben en Ajustes y se
guardan solo en el dispositivo.

### Cómo se fusionan los cambios

Cada dispositivo sube el documento completo y, al bajar, se fusiona con el
local (`src/lib/sync.ts`):

- un apunte que solo está en un lado se queda;
- un apunte que está en los dos: gana la versión editada más tarde;
- lo que borras deja una marca con la fecha, así que no resucita al
  sincronizar — salvo que se haya editado *después* de borrarlo, caso en el que
  gana la edición, que es lo menos destructivo.

La sincronización ocurre al abrir la app, al volver a ella, al recuperar la
conexión y unos segundos después de cada cambio. Si falla, no pasa nada: los
datos están en local y se reintenta a la siguiente.

La clave *anon* es pública por diseño; lo que protege los datos es la política
RLS del paso 2. Sin esa política, cualquiera con la clave podría leer la tabla:
no te la salte.

## Cómo se calculan las cosas

Réplica de las fórmulas del Excel:

| Concepto | Cálculo |
| --- | --- |
| Total del mes (合計) | suma de los apuntes + alquiler + extras fijos |
| Vida diaria (一日生活の費消) | categorías del grupo «vida diaria» (comer fuera + supermercado) |
| Gastos fijos (毎月ある費消) | apuntes marcados como recurrentes + alquiler + extras |
| Otros gastos (別の費消) | total − gastos fijos |
| Balance (上限) | límite − total |
| Moneda secundaria | importe × tipo de cambio del mes |
| Tope de categoría | suma de la categoría frente a su tope, si tiene |
| Comparación anual | cada mes frente al mismo mes del año anterior, solo con los meses que existen en los dos años |

Cada apunte tiene un tipo: **normal**, **recurrente** (cuenta como gasto fijo, y
se puede copiar al mes siguiente) o **extraordinario** (puntual: la mudanza, un
hotel, un vuelo). En las estadísticas se pueden excluir los extraordinarios para
ver la tendencia real.

## Estructura

```
src/
  lib/          calculos, formato, almacenamiento, lector de xlsx,
                fusion de copias y cliente de Supabase (sin React)
  components/   piezas de interfaz y graficos en SVG
  state/        store con useReducer + guardado diferido + motor de sync
  views/        Mes · Estadisticas · Ahorros · Ajustes
  test/         tests de interfaz y fixture del importador
public/         manifest, iconos y service worker
supabase/       schema.sql para la sincronizacion
```

El cliente de Supabase está escrito con `fetch` (unas 300 líneas en
`src/lib/supabase.ts`) en vez de usar la librería oficial: hacen falta cuatro
llamadas y así el paquete que descarga el móvil no engorda 100 kB.

Los gráficos son SVG escritos a mano (sin librería de charts) siguiendo una
paleta validada para daltonismo: orden de colores fijo, leyenda siempre
presente, y cada gráfico tiene su **vista de tabla** equivalente.

El fixture del importador se regenera con:

```bash
pip install openpyxl && python3 src/test/fixtures/make-sample.py
```

## Licencia

MIT — ver [LICENSE](LICENSE).
