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

En el `localStorage` del navegador, bajo la clave `kakeibo:data:v1`. Esto tiene
consecuencias que conviene tener claras:

- Los datos **no salen del dispositivo** y nadie más los ve.
- **No se sincronizan** entre el móvil y el PC.
- Si borras los datos del navegador, se van.

Por eso hay **Ajustes → Exportar datos**, que descarga un `.json` con todo, e
**Importar datos** para restaurarlo en otro dispositivo. Un `.json` exportado es
también la copia de seguridad recomendada.

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

Cada apunte tiene un tipo: **normal**, **recurrente** (cuenta como gasto fijo, y
se puede copiar al mes siguiente) o **extraordinario** (puntual: la mudanza, un
hotel, un vuelo). En las estadísticas se pueden excluir los extraordinarios para
ver la tendencia real.

## Estructura

```
src/
  lib/          calculos, formato, almacenamiento, lector de xlsx (sin React)
  components/   piezas de interfaz y graficos en SVG
  state/        store con useReducer + guardado diferido
  views/        Mes · Estadisticas · Ahorros · Ajustes
  test/         tests de interfaz y fixture del importador
public/         manifest, iconos y service worker
```

Los gráficos son SVG escritos a mano (sin librería de charts) siguiendo una
paleta validada para daltonismo: orden de colores fijo, leyenda siempre
presente, y cada gráfico tiene su **vista de tabla** equivalente.

El fixture del importador se regenera con:

```bash
pip install openpyxl && python3 src/test/fixtures/make-sample.py
```

## Licencia

MIT — ver [LICENSE](LICENSE).
