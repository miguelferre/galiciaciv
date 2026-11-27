# Contratos de datos (v2)
El pipeline (Python, `pipeline/`) y el navegador (`web/js/`) comparten los ficheros de `web/data/`. Un contrato se
cambia primero aquí y después en los dos lados. Los recuentos y rangos marcados como "hoy" describen los datos del
2026-11-26: no son reglas. La regla es lo que construye el builder y valida `check`.

## Convenciones
* **Coordenadas**: km de mapa. Origen arriba a la izquierda, **y** hacia abajo. Proyección Albers equivalente en área
  (esférica, R = 6371.0088 km), con los parámetros de `world.json` `projection`:
  `{min_x, max_y, margin, lat1: 42, lat2: 43.5, lat0: 42.8, lon0: -8}`.
  `x = albers_x - min_x + margin`, `y = max_y - albers_y + margin` (`pipeline/core/geo.py`).
* **Rejilla**: se lee de `world.json` `grid`, no se fija en el código. Hoy `{radius: 1.0, cols: 151, rows: 182}`
  (27 482 casillas, D-004). Hexágonos de punta arriba, disposición odd-r (`pipeline/core/hexgrid.py` y `web/js/hex.js`
  son espejo). Centro: `x = √3·radius·(col + 0.5·(row & 1))`, `y = 1.5·radius·row`.
* **Índice de casilla** (`cell`): `row * cols + col`. Los arrays por casilla miden `cols * rows`.
* **Nulos**: `null` es "sin dato". Nunca se escribe `0` por "desconocido".
* **Unidades**: dinero en euros. Las proporciones son fracciones 0..1, salvo `world.json` `pct` (enteros 0..100) y las
  lentes que declaran otra cosa en `unit`.

### Vocabulario y claves
Las claves conservan los nombres de usaciv: `state` es la **comarca** (53), `county` es el **concello** (313), `metro` y
`cbsa` apuntan a la **ciudad** (56 concellos de 10 000 habitantes o más), `nation` es **Galicia**.

| Referencia | Valor | Dónde aparece |
|---|---|---|
| comarca por `fips` | código de 4 cifras, `"1503"` | `world` y `states` `fips`; `cities.states`; `trade` zona `id`, `routes.a/b`, `partners` |
| comarca por `abbr` | 2 a 6 letras, `"BARC"` | `state` en `resources`, `infrastructure`, `wonders`; `trade.zones[].states`; claves de `resources.summary.states` |
| comarca por nombre | `"A Barcala"` | `counties.json` columna `state`; `wonders` `state_name` |
| comarca por índice | 0..52, orden de `world.states` (por nombre) | `world.owner`; `states.json`. `trade.zones` va por `fips`, otro orden |
| concello | código INE de 5 cifras (texto) | `geoid`, `county`, claves de `districts.counties`; `cbsa` y `city` solo si es ciudad; `cities[].id` |
| concello por índice | 0..312, orden de `world.counties` | `world.county` |

Para resolver una comarca en el navegador se usa `stateIndex(w, ref)` de `world.js` (índice, `fips` o `abbr`).

## Ficheros, productores y lectores
| Fichero | Builder | Carga en el navegador | Lectores en `web/js` | Lo valida |
|---|---|---|---|---|
| `world.json` | `world` | núcleo, obligatorio | `world.js`, `render/`, `ui/`, extensiones | `check.py` (obligatorio) |
| `cities.json` | `cities` | núcleo, obligatorio | `main.js`, `render/`, `ui/`, `cityView`, `advisors` | `check.py` (obligatorio) |
| `nation.json` | `cities` | núcleo, obligatorio | `ui/`, `render/banners.js`, `cityView`, `advisors` | `check.py` (obligatorio) |
| `states.json` | `states` | núcleo, opcional | `main.js`, `ui/`, `relief3d`, `cityView`, `advisors` | `check.py` (obligatorio) |
| `lenses.json` | `lenses` | núcleo, opcional | `main.js`, `ui/`, `relief3d`, `cityView`, `advisors` | `check.py` (obligatorio) + builder |
| `sources.json` | `catalog` | núcleo, opcional | `ui/`, `relief3d`, `advisors` | `check.py` (obligatorio) |
| `resources.json` | `resources` | núcleo, opcional | `world.js`, `render/`, `ui/`, `cityView`, `advisors` | `check.py` (opcional) |
| `counties.json` | `counties` | a petición | `cityView`, `advisors` | `check.py` (opcional) |
| `citizens.json` | `citizens` | a petición | `cityView`, `advisors` | builder |
| `districts.json` | `districts` | a petición | `cityView`, `advisors` | builder |
| `infrastructure.json` | `infrastructure` | tras el primer fotograma | `ext/layers`, `advisors` | builder |
| `wonders.json` | `wonders` | tras el primer fotograma | `ext/layers`, `advisors` | builder |
| `trade.json` | `trade` | tras el primer fotograma | `ext/layers`, `advisors` | builder |
| `fp.json` | `fp` | a petición (asesor de Formación profesional) | por escribir | builder (`check` de `build/fp.py`) |
| `relief3d_detalle.bin` | `tools/prep_relief3d.py` | al pedirlo la vista 3D | `ext/relief3d/terrain.js` | nadie |

* **Núcleo**: `main.js` lo carga antes de dibujar. Si falta un opcional, el visor sigue (`lenses` vacío, `sources` `[]`,
  el resto `null`). `check` es más estricto: exige `states`, `lenses` y `sources`.
* **`app.loadData(name) → Promise<data | null>`**: pide `data/<name>.json` una sola vez, lo deja en `app.data[name]` y
  emite `"data"` `{name, data}`. Un 404 o un JSON inválido dan `null`. `app.loadCounties()` = `loadData("counties")`;
  `app.data.counties` empieza en `null`. La carga temprana solo ocurre si `ext/layers` está activa.
* La API de extensiones se resume al final, en "Browser extension API".

### Pipeline y comprobaciones
* Las fuentes (`pipeline/sources/*.py`) y los builders (`pipeline/build/*.py`, con `REQUIRES`, `PRODUCES`, `build()`)
  se descubren solos. El pipeline usa solo la biblioteca estándar; `tools/prep_relief3d.py` necesita rasterio y numpy.
* Un módulo de `build/` puede definir `check(web_dir) -> [(nivel, mensaje)]` (`PASS`, `NOTE`, `WARN`, `FAIL`).
  Lee solo `web_dir` y da `NOTE` si falta su salida. `pipeline check` lo ejecuta; una excepción cuenta como `FAIL`.

## world.json
```jsonc
{ "version": 2, "grid": {"radius": 1.0, "cols": 151, "rows": 182},
  "width": 259.7, "height": 270.2, "margin": 25.0,       // km
  "owner":    [int],  // -1 agua, -2 tierra de fuera (Asturias, León, Zamora, Portugal), >=0 índice en states
  "county":   [int],  // índice en counties; -1 fuera de Galicia
  "elev":     [int],  // m. Tierra: media. Mar: profundidad media (<= 0). Embalse o lago: min(media, 0). -4000 sin muestras
  "elev_max": [int],  // opcional: m, punto de tierra más alto (0 en agua)
  "water":    [int],  // 0 tierra, 1 océano, 2 costa, 3 lago o embalse
  "relief":   [int],  // 0 llano, 1 colinas, 2 montaña, 3 cumbres; 0 en agua
  "cover":    [int],  // id de tables.cover; 0 = ninguno (agua, fuera de Galicia o sin muestras)
  "pct": {"forest": [int], "crop": [int], "pasture": [int], "grass": [int], "shrub": [int],
          "wetland": [int], "developed": [int]},         // 0..100; 0 fuera de Galicia
  "tables": {"water": [{"id", "name", "rule", "color"?}], "relief": [{"id", "name", "rule"}],
             "cover": [{"id", "key", "name", "color"?, "nlcd"?, "rule"}], "notes": {"water", "relief", "cover"}},
  "states":   [{"fips": "1503", "abbr": "BARC", "name": "A Barcala"}],                     // 53
  "counties": [{"geoid": "15001", "name": "Abegondo"}],                                    // 313
  "projection": {"min_x", "max_y", "margin", "lat1", "lat2", "lat0", "lon0"},
  "rivers":   [{"name": "Río Miño", "rank": 2, "pts": [x0, y0, x1, y1, ...]}]              // recortados al mapa
}
```
* Hoy hay 11 314 casillas gallegas, 9 840 de agua y 6 328 de fuera. Dos concellos no tienen casilla propia en
  `county`: A Illa de Arousa y Mondariz-Balneario.
* Ids de cobertura fijos (`check` valida las claves): 0 none, 1 forest_deciduous, 2 forest_evergreen, 3 forest_mixed,
  4 scrub, 5 grassland, 6 pasture, 7 cropland, 8 wetland, 9 urban, 10 barren, 11 ice. La fuente es ESA WorldCover: todo
  el arbolado es `forest_mixed`, el prado se lee como `pasture` y `pct.grass` es 0 hoy. Hoy aparecen 0, 3, 4, 6 a 10.
* Una casilla es **urbana** con 15 % o más de suelo construido (usaciv: 30 %).
* Los `name` y `rule` de `tables` están en inglés y varios citan códigos NLCD. `notes` explica la fuente real.
* `relief`: desviación típica de la altitud >= 31 m (colinas) o >= 85 m (montaña); media >= 900 m (montaña) o
  >= 1 200 m (cumbres). Un fondo de valle puede bajar una clase.
* Ríos: `rank` menor = río mayor (hoy de 2 a 6). `check` exige `rank` entero y al menos dos puntos.

## cities.json
Lista ordenada por población descendente (hoy 56). El perfil económico lo comparten `states.json` y `nation.nation`.
```jsonc
{ "id": "36057", "name": "Vigo", "full": "Vigo, Pontevedra", "states": ["3610"],             // un fips de comarca
  "metro": true,                  // siempre true
  "capital": false,               // true solo en 15078 (Santiago de Compostela)
  "x": 71.7, "y": 201.2,          // centroide del concello
  "cell": 19974,                  // casilla del estandarte: la parte más construida del concello
  // perfil económico
  "population": 294489,                                  // padrón INE 2025
  "yields": {"food", "production", "gold", "science", "culture"},   // número | null
  "jobs": {"agricultura", "industria", "construccion", "servicios"},// afiliados por concello de residencia
  "employed": 120971,                                    // afiliados totales
  "median_income": 16256,         // OJO: renta neta MEDIA por persona (no mediana)
  "unemployment": 0.0513,         // OJO: parados registrados / habitantes (no tasa de paro)
  "gdp": 9759893000, "gdp_year": 2023,                   // euros
  "median_rent": null, "home_value": null, "rent_burden": null, "growth": null, "growth_years": null,
  "gdp_by_industry": null, "gdp_undisclosed": null, "gdp_estimated": null,
  // solo ciudades
  "counties": ["36057"], "footprint": [int], "pop_series": null,
  "ranks": {"population": 1, "gdp": 1, "gdp_per_capita": 6, "growth": null,
            "food": 5, "production": 1, "gold": 1, "science": 2, "culture": 1}, "peers": ["15030", "..."]       // 5 ids
}
```
* `median_rent`, `home_value`, `rent_burden`, `growth`, `growth_years` y `ranks.growth` son siempre `null`. Las claves
  del perfil económico tienen que existir (`check` las exige), pero no hay dato gallego.
* `food` = afiliados en agricultura y pesca; `production` = industria + construcción; `gold` = PIB en euros;
  `science` y `culture` = estimación (porcentaje de una rama, IGE 10058, por el total de afiliados).
* `footprint`: casillas con al menos 4 de 7 muestras en el concello, más la propia `cell`. Lista ordenada, nunca vacía
  (hoy de 7 a 144 casillas; Vigo 41).
* `ranks`: 1 = mayor, `null` si el valor es `null`; los no nulos son 1..N. `peers`: las 5 ciudades de población más
  parecida (por cociente).
* `check` valida: ids únicos de 5 cifras, orden, una sola capital, `cell` en rango, `states` con fips conocidos,
  `footprint` en tierra gallega, `unemployment` en 0..1, `ranks` y `peers`.

## states.json
Lista de 53 comarcas en el orden de `world.states`. Perfil económico como en `cities.json`, más:
```jsonc
{ "fips": "1503", "abbr": "BARC", "name": "A Barcala", "province": "A Coruña",
  "ranks": {"food": 41, "production": 41, "gold": 46, "science": 34, "culture": 38},   // 1..53, solo rendimientos
  "label": {"x": 66.7, "y": 118.5, "angle": 0.0, "size": 14.0},   // grados horarios; size en km, recortado a 14..110
  "land": {"forest": 0.642, "crop": 0.08, "pasture": 0.243, "grass": 0.0, "shrub": 0.029,
           "wetland": 0.0, "developed": 0.007}                    // 0..1, media de world.pct | null
}
```
* Los totales suman concellos. Si el IGE oculta un sector en alguno, la suma es una **cota inferior** (el fichero no lo
  marca). El paro se calcula solo sobre los concellos con dato. `median_income` pondera por población.
* No hay `counties`, `energy`, `footprint` ni `peers`. Hoy `label.size` es 14.0 en las 53: es el mínimo del recorte.
* Mismo orden que `world.states` (alfabético por nombre; `check` compara los `fips`).
* `check`: `abbr` única, `ranks` coherentes, `land` con las claves de `pct`.

## nation.json
```jsonc
{ "name": "Galicia", "currency": "EUR", "year": 2025, "vintage": "…", "gdp_vintage": "IGE PIB por concello 2023",
  "nation": { /* perfil económico, sin ranks */ },
  "yields": [{"key": "food", "icon": "y-food", "emoji": "🌾", "label": "Alimento", "color": "#7fbf3f",
              "unit": "workers",            // "eur" en gold; "workers" en los otros cuatro
              "sectors": ["agro"],          // claves del IGE: production usa "construcion" (sin segunda c)
              "branches"?: ["aapp"],        // solo science y culture
              "industries": ["agricultura"], "description": "…"}],     // industries: claves de jobs
  "industries": {"agricultura": "Agricultura e pesca", "industria": "Industria", "construccion": "Construcción",
                 "servicios": "Servicios"}, "gdp_industries": {}                      // vacío: no hay PIB por rama
}
```
`check` exige `name` = "Galicia", `gold` en `eur`, y que las `yields` de ciudades y comarcas tengan las mismas claves.

## counties.json
Un concello por fila, en el orden de `world.counties`, orientado a columnas.
```jsonc
{"vintage": "…",
 "fields":  [{"key", "label", "format", "unit", "higher_is", "source", "description"}],  // uno por columna
 "columns": ["geoid", "..."],                  // fields[j].key == columns[j]
 "rows":    [["15001", "Abegondo", "..."]]}    // 313 filas, 34 columnas hoy
```
| Columnas (en orden) | Formato y unidad |
|---|---|
| `geoid`, `name`, `state` (nombre de comarca), `province` | `text` |
| `population`; `land_km2`; `density` | `int`; `km2`; `float` hab./km² |
| `gdp`, `gdp_pc` | `eur` (PIB 2023; por habitante de 2025) |
| `affiliates`, `agro`, `industria`, `construccion`, `servicios` | `int`, personas |
| `agro_share`, `industry_share`, `unemployment` | `pct` 0..1 (`unemployment` = parados / habitantes) |
| `renta_pc`; `gini`, `p80p20`; `edad_media` | `eur`; `float`; `years` |
| `nacidos_fuera`, `estudios_superiores` | `pct` |
| `temp`, `precip`, `viento`, `sol`, `humedad` | `float` °C, `int` mm, `float` m/s, `int` horas, `pct` (2025) |
| `forest`, `crop`, `pasture`, `developed` | `pct` |
| `city` | `text`: id en `cities.json` o `null` |
| `cell` | `int`: casilla gallega cercana al centroide, en su comarca si es posible |

* `cell` sirve para localizar el concello; `world.county[cell]` puede ser otro (4 casos hoy).
* `land_km2` se calcula del contorno municipal del IGN, antes de simplificarlo (`pipeline/sources/ign_limites.py`).
* Nulos hoy, aparte de `city`: `unemployment` en Oza-Cesuras y Cerdedo-Cotobade; `construccion` en Baleira y Negueira de
  Muñiz; `agro` y `agro_share` en Mondariz y Mondariz-Balneario; clima y suelo en A Illa de Arousa.
* `check`: columnas obligatorias `geoid, name, state, population, land_km2, density, city`; formatos de lente (menos
  `category`) más `text` y `km2`; `pct` en 0..1.

## lenses.json
```jsonc
{ "vintage": "…", "groups": [{"id": "people", "name": "Población"}],   // people, prosperity, work, climate, risks, land
  "lenses": [{ "id", "group", "name", "icon", "emoji", "unit", "description",
    "format": "int|eur|pct|float|years|category",      // check admite además usd y minutes
    "scale": "log|linear", "higher_is": "good|bad|neutral",
    "domain": [lo, hi],            // percentiles 2 a 98 redondeados hacia fuera; categórica: [0, n-1]
    "ramp": ["#rrggbb"], "source": "id de sources.json",
    "values": [number|null],       // por casilla; null siempre fuera de Galicia
    "note"?: "aviso que la leyenda enseña",            // hoy ninguna lo usa
    "sparse"?: true,                                   // null significa "no hay", no "falta"
    "categories"?: [{"id", "name", "color"}]           // solo category; ramp = sus colores en orden
  }] }
```
| Grupo | Ids (formato) |
|---|---|
| `people` | `density` (int, log), `edad_media` (years), `nacidos_fuera`, `estudios_superiores` (pct) |
| `prosperity` | `gdp_pc`, `renta_pc` (eur), `gini`, `p80p20` (float) |
| `work` | `unemployment` (float), `agro_share`, `industry_share` (pct) |
| `climate` | `temp`, `viento` (float), `precip`, `sol` (int), `humedad` (pct) |
| `risks` | `incendios`, `inundacion` (pct), `incendio_anyo` (category, `sparse`: índice 0..9 = 2016..2025) |
| `land` | `forest`, `farmland` (cultivo + pasto), `developed` (pct), `elevation` (int, m) |

* **OJO**: la lente `unemployment` va en parados por 100 habitantes; la columna del mismo nombre en `counties.json` y
  el campo de `cities.json` son fracciones 0..1.
* Las lentes de concello reparten cada valor a sus casillas, ponderado por población. El clima se interpola desde
  estaciones. `density` = personas / área de tierra de la casilla; `check` compara su suma con el padrón (±0,5 %, solo
  si existen los datos intermedios).
* El check del builder avisa si faltan lentes, da `FAIL` si queda alguna de usaciv (`faith`, `veterans`, `disasters`,
  `amenities`, `income`, `home`, `health`) y exige unidad de `density` que empiece por "habitantes".

## resources.json
```jsonc
{ "types": [{"id", "name", "category": "energy|mineral|agri", "emoji", "icon", "color",
             "unit": "aerogeneradores|explotaciones|€", "description", "source"}],   // el orden es el rango
  "items": [{"type", "name", "x", "y", "cell", "value": number|null, "detail": "texto",
             "state": "abbr" | null, "cbsa": "id de ciudad" | null}],
  "summary": {"note", "national": {"<type>": {"count", "value", "unit"}},            // todos los tipos
              "states": {"<abbr>": {"<type>": {"count", "value", "unit"}}}}         // solo los presentes
}
```
* Ítem = una casilla (o un concello en `lonja`), no una instalación. Hoy 1 150: `eolico` 734, `granito` 153,
  `otras_rocas` 60, `pizarra` 58, `lonja` 47, `cuarzo` 42, `arcilla` 37, `caliza` 19.
* `eolico`: `value` = aerogeneradores (mínimo 2 por casilla; no hay potencia ni estado). Canteras: explotaciones activas
  del grupo (mínimo 1). `lonja`: euros de primera venta del año.
* `summary.count` cuenta ítems y `value` suma sus valores. Todo es aditivo, solo sobre lo que se ve en el mapa.
* `check`: formas, `state` y `cbsa` conocidos, resumen igual a los ítems; `WARN` si un ítem cae fuera del mapa.

## Capas de mapa y vista de ciudad
`citizens`, `districts`, `infrastructure`, `wonders` y `trade` llevan `version: 1`, `vintage` (texto o `{parte: texto}`)
y `sources` (ids de `sources.json`). En los sitios: `x`, `y` en km (posición real), `cell` casilla gallega, `county`
código INE, `cbsa` id de ciudad o `null`, `state` `abbr` de comarca. Las reglas de selección viajan en `rule`/`rules`
para que la interfaz las cite. Los tres de carga temprana avisan (`WARN`) por encima de 300 kB.

## citizens.json (a petición)
Censo 2021 (ocupación y estudios) y Padrón 2025 (edad y lugar de nacimiento). No hay fila de desplazamientos.
```jsonc
{ "version": 1, "vintage", "year": 2025, "census_year": 2021, "sources": ["ige_poboacion", "ige_censo"],
  "figures": {"workforce": 20, "age": 10, "education": 10, "nativity": 10},   // figuras por fila
  "rows":   {"<fila>": "título"},
  "groups": {"<fila>": [{"key", "label", "short", "art"}]},                   // art = figura que se dibuja
  "rule":   {"specialist_high": 1.25, "specialist_low": 0.8, "min_share": 0.01, "max_high": 4, "max_low": 2, "text"},
  "national": {/* fila de ciudad; specialists: [] */}, "cities": {"<id>": {
      "workforce": {"total", "counts", "shares", "figures", "unclassified"} | null,
      "age":       {"total", "counts", "shares", "figures", "mean"} | null,    // mean: edad media
      "education": {"total", "counts", "shares", "figures"} | null,
      "nativity":  {"total", "counts", "shares", "figures"} | null,
      "foreign_nationals": 0.0763,                                             // nacionalidad extranjera, 0..1
      "specialists": [{"row", "key", "share", "national", "ratio"}] } | null} }
```
| Fila | Claves (`art`) |
|---|---|
| `workforce` | `cno1` (executive), `cno2` (scholar), `cno3` (engineer), `cno4` (clerk), `cno5` (service), `cno6` (farmer), `cno7` (builder), `cno8` (maker), `cno9` (elementary) |
| `age` | `child`, `young`, `midlife`, `elder` (mismo `art`) |
| `education` | `primary` (less_than_hs), `lower_secondary` (high_school), `upper_secondary` (some_college), `higher` (bachelors) |
| `nativity` | `same_concello` (born_in_state), `galicia` (other_state), `spain` (native_abroad), `abroad` (foreign_born) |

* `counts` son personas; `shares` = count / total (4 decimales); `figures` usa restos mayores y suma exacto. Una fila con
  un valor oculto es `null` entera. `unclassified` ("Non consta") queda fuera de las partes de ocupación.
* Los totales salen de tablas del IGE distintas de la población de `cities.json` y no coinciden con ella.
* `check`: claves, orden de categorías, sumas, y los mismos ids que `cities.json`.

## districts.json (a petición)
IGE tabla 9002, **establecimientos** (unidades locales) por división CNAE-09. **No son empleos**: nunca escribir
"empleos" ni "trabajos". No hay salarios, sector primario ni administración pública.
```jsonc
{ "version": 1, "vintage", "year": 2024, "sources": ["ige_unidades"],
  "rule": {"min_lq": 1.25, "min_units": 10, "min_excess": 10, "z": 2.0, "specialty_lq": 3.0, "max_per_city": 5,
           "badge_lq": 6.0, "badge_share": 0.03, "text": "…"},
  "catalog": [{"id", "name", "short", "icon", "color", "divisions": ["10"], "sub": {"10": "Alimentación"},
               "badge": {"id", "label", "labels": {"10": "…"}}, "description"}],
  "divisions": {"<cnae>": {"title", "units"}},        // units de Galicia; 81 divisiones hoy
  "national": {"units": 219755}, "cities": {"<id>": { "units": 26079,
      "top": [{"div", "units", "lq"}],                // hasta 8, con 10 establecimientos o más
      "districts": [{"id", "lq", "units", "share", "excess", "strength",
                     "sub": "cnae" | null, "sub_lq", "sub_units", "via": "broad|specialty"}],
      "badge": {"id", "label", "district", "text"} | null } | null},
  "counties": {"<geoid>": {"units", "districts": [["id", lq, units]]}}                  // los 313
}
```
| Id (en orden) | `divisions` CNAE |
|---|---|
| `industry`, `quarry`, `transport`, `commerce` | 10 a 33; 07 a 09; 49, 52, 53; 46, 47 |
| `offices`, `tech`, `tourism` | 64, 65, 66, 69, 70, 71, 73; 62, 63, 72; 55, 56 |
| `culture`, `utilities` | 59, 60, 90, 91; 35 a 39 |

* `lq` = parte del concello / parte de Galicia. Un distrito pasa con `lq >= 1.25`, 10 unidades o más y un exceso de al
  menos `max(10, 2·√esperado)` (`broad`), o por una especialidad con `lq >= 3` y los mismos mínimos (`specialty`: el
  `lq` del distrito puede quedar por debajo de 1,25).
* Orden por `strength` (exceso de unidades), máximo 5 (hoy ninguna ciudad pasa de 3). Sin distritos, `badge` es `null`
  ("diversificada"; 15 ciudades hoy). El `badge` sale del primero, salvo otro con `lq >= 6` y 3 % de las unidades.
* Una división oculta anula la medida (el distrito no aparece); nunca cuenta como 0.
* `check`: ids del catálogo, mismos ids que `cities.json`, máximo 5, mínimo de unidades, `top.div` conocido y `badge`
  presente y coherente cuando hay distritos.

## infrastructure.json (tras el primer fotograma)
```jsonc
{ "version": 1, "vintage": {"roads", "rail", "ports", "airports"},
  "sources": ["osm_vias", "wikidata_puertos", "osm_aeropuertos"], "rules": {"roads", "rail", "ports", "airports"},
  "road_classes": [{"id": "autovia"}, {"id": "via_rapida"}],     // con name
  "rail_tiers":   [{"id": "principal"}, {"id": "secundaria"}],
  "roads": [[a, b, clase, "A-52" | null]],     // casillas vecinas, a < b, par único
  "rail":  [[a, b, nivel]], "ports": [{"id", "name", "authority", "type": "coastal",
             "x", "y", "cell", "county", "cbsa", "state"}],              // 6 hoy, por nombre; sin cifras de tráfico
  "airports": [{"id": "SCQ", "icao", "name", "city",
                "x", "y", "cell", "county", "cbsa", "state"}]            // 3 hoy, por nombre; sin cifras de tráfico
}
```
* Las vías son dibujo del mapa (OpenStreetMap ajustado a enlaces), no el trazado. Hoy: 1 590 enlaces de carretera y
  649 de ferrocarril. Puertos y aeropuertos no llevan cifras (toneladas, pasajeros, operaciones, mercancía): Puertos del Estado y Aena exigen autorización escrita previa (D-002). Regla de tamaño: todos iguales (nivel 1) y ordenados por nombre; el `check` falla si aparece `tons`, `passengers`, `operations`, `cargo_t`, `teus`, `rank` o `hub`.
* `check`: enlaces vecinos, ordenados, sin duplicados y con un extremo gallego; sitios en tierra gallega, cerca de su
  `x`/`y`, con ids únicos y `county`/`cbsa` conocidos.

## wonders.json (tras el primer fotograma)
```jsonc
{ "version": 1, "vintage": {"unesco", "bic", "park"}, "sources": ["wikidata_unesco", "visaf_bic", "ign_ppnn"],
  "rules": [{"id": "unesco|bic|parque_nacional", "kind", "kinds": [], "name", "year", "text"}],
  "national": {"bic": 653, "bic_monuments": 183, "camino_elements": 126},
  "wonders": [{"id", "name", "short", "kind": "landmark|natural", "rule", "rank",     // rank 1..N dentro de la regla
               "motif", "metrics": {}, "cells": [int] | null, "curated": false, "state_name": "comarca" | null,
               "x", "y", "cell", "county", "cbsa", "state"}]                          // 25 hoy
}
```
| `rule` | Hoy | `metrics` | Orden |
|---|---|---|---|
| `unesco` | 6 | `{unesco_id, concello}` | alfabético |
| `bic` | 18 | `{category, protected_km2, register_id, concello}` | superficie protegida |
| `parque_nacional` | 1 | `{area_km2, declared}` (`declared`: año, texto) | único |

* No hay visitas, universidades ni selección a mano. `protected_km2` mide terreno protegido, no importancia.
* Parque nacional (Illas Atlánticas): `cells` tiene 32 casillas (solo 2 de tierra gallega), `state_name` es `null` y
  hoy `cell` cae en tierra, con `county`/`cbsa` "36057" y `state` "VIGO". El builder pone esos tres a `null` si `cell`
  cae fuera de tierra gallega, y `check` permite esa `cell` en agua solo para esta regla.
* `check`: reglas con texto, `kind` dentro de `kinds`, `rank`, casillas, ids; `WARN` fuera de 20 a 25 maravillas.

## trade.json (tras el primer fotograma)
Viajes de personas entre comarcas (MITMA, **un solo día laborable**, 12 de marzo de 2025). No son mercancías.
```jsonc
{ "version": 1, "vintage", "year": 2025, "date": "2025-03-12", "date_text", "sources": ["mitma_movilidad"],
  "rule", "path_note", "attribution": {"text": "Basado en datos abiertos MITMA", "url"},   // mostrar los tres
  "units": {"trips", "km"}, "modes": [], "commodities": {},
  "purposes": [{"id": "trabajo_estudio|casa|frecuente|no_frecuente", "name"}],
  "national_trips": {"galicia", "internal", "outbound", "inbound", "intrazonal"},
  "zones": [{"id": "fips", "mitma": [], "name", "short", "kind": "comarca", "states": ["abbr"],
             "cities": ["id"], "counties": 4,                    // counties: número de concellos
             "anchor": {"cell", "x", "y", "city": "id" | null} | null,
             "partners": [["fips", viajes, null]],               // 5 principales
             "totals_trips": {"within", "other_zones", "inbound", "outbound"}}],          // 53, por id
  "routes": [{"a", "b", "rank", "trips", "trips_ab", "trips_ba",
              "km",              // km medios por viaje, en línea recta
              "dist_km",         // distancia entre anclas
              "modes": null, "top_mode": null, "top_commodity": null,
              "purposes": {"<id>": 0..1},                        // suman 1
              "path": [cell]}]                                   // 30 hoy, por trips
}
```
* `inbound` y `outbound` son viajes desde y hacia fuera de Galicia. `path` es una ayuda de dibujo sobre las carreteras.
* Se excluyen pares con anclas a menos de 5 km. El ancla es la `cell` de la mayor ciudad de la comarca o, sin ciudad,
  la del concello más poblado.
* `check`: zonas y anclas, `trips` = ida + vuelta, propósitos, `path` entre anclas por vecinas, `rank` y pares únicos.

## camino.json (al encender la capa «Camino de Santiago»)

```
{ version: 1,
  vintage: "IGN-CNIG, Caminos de Santiago (FEAACS), consulta del 2026-11-27",
  sources: ["ign_camino"],
  attribution: "Caminos de Santiago: CC-BY 4.0 FEAACS, vía IGN-CNIG",
  rule: "texto del método",
  total_km: 1805.6,                 // sin contar dos veces lo compartido
  routes: [{ id: "ES01c", name: "Camino Francés", full_name: "...nombre del IGN",
             color: "#f2c14e", km_galicia: 205.3 }],   // orden por id
  lines:  [{ routes: ["ES01c","ES03a"], pts: [x0,y0,x1,y1,...] }],  // km del mapa, 2 decimales
  by_concello: { "15078": { km: 60.0, routes: ["ES01c", ...] } } }  // código INE de 5 cifras; solo concellos con km > 0
```

`check()` valida: claves, version 1, rutas con km, líneas con rutas conocidas y puntos pares, concellos conocidos, puntos dentro del mapa, suma por concello igual a `total_km` (±1 km).

## fires.json (al abrir el asesor Territorio)

```
{
  "version": 1,
  "vintage": "<texto de la fuente EFFIS>",
  "sources": ["effis"],
  "years": [2016, ..., 2025],
  "by_year": [{"n": int, "ha": int, "cells_touched": int}, ...],   // una por año, mismo orden
  "cells": [ [[cell, share], ...], ... ]                          // una lista por año
}
```

- `n`, `ha`: perímetros y hectáreas del año, iguales a `by_year` del interim `effis` (ha redondeadas).
- `cells[k]`: casillas de tierra gallega (`owner >= 0`) con parte quemada en el año `years[k]`; `cell` es índice de la malla (0 <= cell < cols*rows); `share` en [0.001, 1], 3 decimales; las casillas bajo 0.001 no se guardan.
- `cells_touched == len(cells[k])`.
- Los perímetros de un año se unen antes de repartir: un fuego solapado cuenta una vez dentro del año. Entre años no hay unión.
- Builder: REQUIRES `_world`, `effis`; PRODUCES `fires.json`.

## fp.json (al abrir el asesor de Formación profesional)

Salida CC BY-SA 4.0 (deriva de Abert@s). Builder `fp`; REQUIRES `_world`, `ign_limites`, `ige_comarcas`, `ige_poboacion`,
`ige_unidades`, `xunta_centros`, `xunta_oferta_fp`, `xunta_pie`; PRODUCES `fp.json`. Cifras de 2026-11-27 (no son reglas).

```
{ version: 1,
  vintage: "texto con fecha de cada fuente",
  sources: ["xunta_centros","xunta_oferta_fp","xunta_pie","ige_unidades","ige_poboacion","ige_comarcas","ign_limites"],
  license: "CC BY-SA 4.0",
  attribution: "Fonte dos datos: Xunta de Galicia (...) · Fonte: Xunta de Galicia, Consellería de Educación (...) · ...",  // texto a mostrar
  rule: "texto del método",
  limits: ["plazas = curso completo ordinario...", ...],          // avisos para mostrar junto a las cifras
  est_years: [2014, 2024],                                         // años de las claves est_2014 y est_2024
  thresholds: { est_min_share: 0.02, trend_min_units: 10 },
  families: [{ id: "SAN", name: "Sanidad", places: 1234, centres: 40, note?: "por qué la cifra de empresas queda corta" }],  // 27, orden por id
  bridge: { "86": [["SAN", 0.9], ["SSC", 0.1]], ... },             // división CNAE-09 -> [familia, peso]; [] sin familia
  centres: [{ code: "15021430", name, type: "CIFP"|"IES"|"otro", type_code: "CPR", ownership: "publica"|"privada",
              concertado: bool, address, concello: "15036", comarca: "1508", x, y /*km del mapa*/, lon, lat,
              located: "point"|"concello", places: 0,
              offer: [{ family: "FME", grade: "basico"|"medio"|"superior"|"especializacion", level: "basico"|"medio"|"superior",
                        cycle: "nombre", places: 30, shift: "manana"|"tarde", code: "D3FME000100" }] }],    // solo centros con oferta
  by_comarca: { "1508": {                                          // 53, clave = fips de 4 cifras
      name, abbr, centres: 13, young_15_24: 13676, places: 1839, places_per_1000: 134.5,
      by_grade: { basico, medio, superior, especializacion },      // plazas
      by_family: { "FME": { places, offer_share, est_share, ratio, est_2014, est_2024, trend } },
      nearest_km: { "SAN": 0.0 } } },
  galicia: { centres, cifp, young_15_24, places, places_per_1000, by_grade, by_family, establishments: { first, last, mapped_to_family_last } },
  pie: [{ company, project, concello: "15001", concellos: [...], comarca, x, y, investment_meur, jobs_total, jobs_note,
          status, status_text, dog: [url], families: ["FME",...], concello_note }] }
```

* `places`: plazas del primer curso, curso completo ordinario 2026-27 (el dossier de la Consellería da 29 071; el PDF suma 29 059). No incluyen modular, dual intensiva, acelerada ni semipresencial.
* `young_15_24`: grupos 15-19 y 20-24 del padrón (IGE 144, 2025), sumados por comarca. `places_per_1000 = places / young_15_24 * 1000` (1 decimal); los centros cuentan donde están, no donde vive el alumno.
* `by_family` solo trae familias con plazas o con empresas en la comarca. `offer_share` = plazas de la familia entre plazas de la comarca (`null` sin plazas). `est_share` = establecimientos de la familia (IGE 9002, repartidos con `bridge`) entre los de la comarca que tienen familia. `ratio = offer_share / est_share`, `null` si `est_share < thresholds.est_min_share` o no hay plazas (1 = oferta como el tejido de empresas). `est_2014` y `est_2024` son establecimientos ponderados (decimales); `trend = est_2024 / est_2014 - 1`, `null` si `est_2014 < thresholds.trend_min_units`.
* `nearest_km`: km en línea recta del centro de población de la comarca (centros de concello ponderados por habitantes) al centro más cercano que ofrece la familia (cualquier grado). Una entrada por familia ofrecida en Galicia; 0 no es «hay centro en la comarca»: mirar `by_family[f].places`.
* `bridge` es criterio propio (la tabla del INCUAL no se puede reutilizar): sirve para comparar, no para medir. El directorio no incluye el sector primario ni la administración: `families[].note` avisa de las familias afectadas (AGA, MAP, SAN, SSC, IAD).
* `centres[].located = "concello"`: sin coordenadas fiables; el centro va en el centro de su concello. Si el punto y el nombre de concello del directorio no coinciden, manda el nombre.
* `pie[].jobs_total` es el empleo total anunciado (directo más indirecto), no el empleo directo. `x`,`y` son el centro del concello (la media si son varios), no la parcela. `families` es criterio propio por tipo de proyecto. `status`: `aprobado`, `declarado`, `ambiental_finalizada`, `informacion_publica_finalizada`, `en_tramitacion_ambiental`.
* `check()` valida: claves y licencia, 27 familias de `bridge`, 53 comarcas de `world.json`, centros completos y dentro del mapa, sumas de plazas, centros y jóvenes iguales entre centros, comarcas y Galicia, `places_per_1000` y `ratio` recalculados, `offer_share` suma 1, `est_share` suma 1, `nearest_km` en rango, PIE en el mapa. Avisa (WARN) si cambian 216 centros, 28 CIFP o ~29 000 plazas.

## sources.json
Bibliografía generada por `build/catalog.py` desde el registro de fuentes y sus manifiestos (hoy 32).
```jsonc
[{"id", "title", "publisher", "homepage", "license", "description", "used_for": [], "vintage",
  "files": [{"file", "url", "retrieved", "sha256", "bytes"}]}]
```
`check` exige esas claves e ids únicos, y avisa si una fuente no cita ficheros (hoy `mdt_ign` y `worldcover`).

## relief3d_detalle.bin
Malla fina solo para la vista 3D, con la misma proyección que `world.json`. Se genera fuera del pipeline con
`tools/prep_relief3d.py`; hay que repetirlo si cambian la rejilla o la proyección. `check` no lo valida.

| Bytes (little-endian) | Contenido |
|---|---|
| 4 | `"R3D1"` |
| uint32 | `L`, longitud de la cabecera (rellenada para que los arrays empiecen en múltiplo de 4) |
| `L` | cabecera JSON UTF-8 |
| int16 × n | `elev`, m. Tierra: media (>= 0). Mar: profundidad (<= 0). Lago: cota de la superficie (>= 1) |
| uint16 × n | `parent`: casilla de juego que contiene el centro; 65535 = fuera |
| uint8 × n | `cover`: clase WorldCover de la tierra (10..100); 80 = mar, 81 = lago o embalse |

* Cabecera: `{version: 1, date, grid: {radius, cols, rows}, count, game: {grid, projection, width, height}, layers,
  sources, rivers: [{name, rank, pts}]}`. Hoy `radius` 0.5, 301 × 362, `count` 108 962.
* `terrain.js` rechaza el fichero si el tamaño no es `8 + L + 5n`, o si `projection`, `width` o `height` no coinciden con
  `world.json`. Si solo cambia la rejilla de juego, recalcula `parent` en el navegador. Sin `rivers`, usa los de
  `world.json`.

## Browser module boundaries (web/js)
Fronteras entre módulos del navegador.

* `world.js`: `prepareWorld(world, cities, extras) → w`, con `w.grid`, `w.raw`, `w.stateColor[]` y
  `w.cityByCell: Map<cell, city>`. `applyLens(w, lens, band = null)` rellena `w.colors` y `w.rgb`.
  `stateIndex(w, ref)` devuelve el índice de comarca o -1. Exporta `WATER = -1` y `FOREIGN = -2`.
* `camera.js`: `Camera` con `fit()`, `toScreen()`, `toWorld()`, `zoomAt()`, `zoomBy()`, `panBy()`, `centerOn()`,
  `flyTo(x, y, scale, ms)`, `stop()`, `view()` y `step(dt) → bool` (sigue en movimiento). `x`, `y` en km; `scale` en
  px CSS por km.
* `render/*` dibuja el mapa y los estandartes. `main.js` es dueño de la entrada, el estado y el cableado. `ui/*` es
  dueño de los paneles DOM. `app/*` tiene la búsqueda, compartir, la ayuda, el hash y las piezas de la API.
* Objeto `state` (`app.state`; no es una comarca). Es de `main.js` y lo lee `render/*`: `cities`; `lens` (una lente de
  `lenses.json`, o `null` = terreno); `band` (`[t0, t1]` en 0..1 de la escala de la lente, o `null`: las casillas de
  fuera se atenúan); `hoverCell`; `selectedCity` (ciudad o `null`); `selectedState` (índice de comarca o `null`;
  `app.selectState(ref)` acepta cualquier referencia de `stateIndex`: índice, `fips`, `abbr` no ambigua u objeto
  `{index|abbr|fips}`); `showResources`; `highlight` y `resourceFilter` (o `null`).
* `render/snapshot.js`: `renderToCanvas(target, cam, w, state, nation, opts) → {cam, hits}` dibuja un fotograma
  completo fuera de pantalla sin tocar la caché visible. `target` es un canvas, un OffscreenCanvas o un contexto 2D.
  `opts`: `banners = true`, `overlay = true`, `dpr = 1`, `fit = "contain"|"cover"|"same"` o `scale` (px CSS por km),
  `x`, `y` explícitos; además `overlays = []`, `staticLayers = []` y `app`.

## Browser extension API (window.__app; main.js "extension API", app/api.js)
Las extensiones viven en `web/js/ext/<nombre>/index.js` y exportan `install(app)`. `ext/index.js` instala, por este
orden, `layers` (carreteras, ferrocarril, puertos, aeropuertos, maravillas y rutas de viajes), `cityView`, `advisors` y
`relief3d`. Aquí va lo principal; el resto (overlays, resaltado, selección, cámara, eventos, `ui.dock`, modos) está
documentado en `web/js/main.js` ("extension API"), `web/js/app/api.js` y `web/js/render/overlays.js`.

`relief3d` añade el botón `btn-relief3d`, el modo `"relief3d"` y `app.relief3d` (`open()`, `close()`, `isOpen`,
`view`). Importa la vista 3D la primera vez que se abre. No registra claves de hash.

**Datos.**
* `app.data.<nombre>`: los ficheros del núcleo se cargan antes de ejecutar nada. `counties` empieza en `null`; los demás
  opcionales son `undefined` hasta cargarse y `null` si faltan o no son JSON válido.
* `app.loadData(name)`, `app.loadCounties()` y el evento `"data"`: ver "Ficheros, productores y lectores", que dice
  también qué se pide solo tras el primer fotograma. Un nombre fuera de `[a-z0-9_-]` rechaza la promesa.

**Capas estáticas** (dibujo que forma parte del mapa en caché, una vez por render de la caché):

```js
const off = app.registerStaticLayer({
  id: "roads",                 // único; registrar otra vez el mismo id sustituye la capa
  z: 55,                       // posición entre los pasos propios (app.layerZ = Z de render/map.js)
  draw(ctx, vp, w, o) {},      // obligatorio. ctx empieza en km de mapa (con save/restore alrededor)
  visible() { return on; },    // opcional; false = ni se dibuja ni se prueba (entra en la clave de caché)
  sig() { return "v1"; },      // opcional; texto que cambia cuando hay que volver a dibujar (clave de caché)
  minRpx: 6, maxRpx: Infinity, // opcional: radio de hexágono en px CSS (se dibuja si minRpx <= Rpx < maxRpx)
  hit(xKm, yKm, Rpx) { return item | null; },   // opcional: prueba de puntero (hover y clic), en km
  tooltip(item) { return "<b>html</b>" | {text: "plano"} | null; },  // opcional; un string es HTML: escapar los datos
  click(item, ev) { return true; },             // opcional; true consume el clic (ver abajo)
  warm(ctx, vp, w, o) {},      // opcional: pinta en tiempo ocioso los sprites del zoom de vp
  snapshot: true,              // por defecto true: sale también en las imágenes para compartir
});
off();   // o app.unregisterStaticLayer("roads" | capa)
```

* `o` = `{Rpx, Gpx, s, dpr, lod, lens, selectedCity, showResources, snapshot, app, cells, range: {r0, r1, c0, c1},
  world(), screen(), toScreen(x, y) → [px CSS]}`. `s` son px CSS por km. `cells` son las casillas visibles.
  `o.screen()` pasa `ctx` a px CSS del canvas de caché y `o.world()` vuelve a km. Para algo más que unos trazos,
  usar sprites (`getSprite` y `drawSprite` de `render/art/sprites.js`).
* `Rpx` = `grid.radius` × `s`: con la malla de 1 km coincide con `s`. `Gpx` = `REF_KM` (2,5) × `s`
  (`render/art/lod.js`) no depende de la rejilla. Un umbral geográfico pensado en `Gpx` se pasa a `minRpx`
  multiplicando por `grid.R / REF_KM`, como hace `ext/layers`.
* Pasos propios (z): `WATER 10`, `LAND 20`, `GRID 30`, `GLYPHS 40` (terreno), `RIVERS_BORDERS 50`, `CITIES 60`,
  `FOG 70` (niebla del borde), `RESOURCES 80` (iconos), `LABELS 90` (nombres de comarca). Una capa con z entre dos pasos
  se dibuja después del menor; con z igual a un paso, justo después. Huecos sugeridos: 45 mejoras del terreno, **55
  carreteras y ferrocarril**, 58 tramas de suelo protegido, **65 sitios** (puertos, aeropuertos, maravillas, placas),
  **85 rutas de viajes**.
* `ext/layers` registra `roads` 55, `rail` 56, `protected` 57, `restricted` 58, `hubs` 65, `forts` 66, `wonders` 67,
  `plates` 68 y `trade` 85. `restricted` y `forts` son herencia militar: nunca son visibles.
* La clave de caché incluye `id`, `visible()` y `sig()` de cada capa: activar o cambiar una capa redibuja la caché. Un
  error en `draw`, `hit`, `sig`, etc. se registra una vez por capa y la capa se salta mientras falle.
* **Rendimiento**: nada se anima de forma continua (un mapa en reposo no dibuja fotogramas, salvo el realce de la
  comarca seleccionada); cada capa por debajo de unos 3 ms por render a zoom habitual (medir con
  `drawStatic(..., {layers: app.staticLayers(), timings: T})`, que informa `layer:<id>`); precalcular la geometría una
  vez; recortar a `vp`.
* `app.staticLayers()` lista las capas; `app.hitLayer(mx, my)` (px CSS de pantalla) → `{layer: id, item} | null`.

**Hover y clic.** El tooltip pregunta a las capas (de mayor a menor z, solo las dibujadas a ese zoom) después de los
estandartes de ciudad: gana el primer `hit()` no nulo y se enseña su `tooltip(item)` (si no devuelve nada, el de la
casilla). El evento `"hover"` lleva `{cell, city, resource, x, y, layer, item}` (`layer` = id o `null`). Un clic crea
`ev = {cell, city, resource, state, x, y, pointerType, layer, item}` (`state` = índice de comarca o `null`). Sin modo
activo va primero el `click(item, ev)` de la capa (true lo consume), luego los manejadores de `"mapclick"` y por último
la selección de ciudad o comarca. Con un modo activo (vista de ciudad, asesores, relieve 3D) van primero los
`"mapclick"` y después el `click` de la capa.

**Conmutadores del mapa.** `app.ui.addMapToggle({id, label, icon, get() → bool, set(on), title?, default?})` devuelve
la función que lo quita. Es un interruptor del menú "Mapa", junto al de recursos. `set` es de la extensión (cambia el
estado que lee `visible()`); `main` redibuja. La clave de hash `layers` lista los interruptores encendidos
(`#layers=roads,rail,trade`, `layers=none`) y solo se escribe si alguno difiere de su valor por defecto; los que se
añaden después de cargar toman su estado del hash, y los id aún sin registrar siguen en la URL.
`app.ui.mapToggles()` → `[{id, label, on}]`. `app.ui.setMapToggle(id, on) → bool` hace lo mismo que el menú (redibuja
y actualiza el hash); `false` si no existe ese id. Los de `ext/layers` son `roads`, `rail`, `hubs`, `wonders` y
`trade`, todos encendidos por defecto menos `trade`.

**URL.** Claves del núcleo: `lens`, `city` (código INE de la ciudad), `state` y `at`. De extensiones: `layers`,
`view=city` (vista de la ciudad de `city`) y `advisor` (id de asesor o `council`). Se registran con
`app.hash.register(key, {get, set})`.
* `#state=` acepta el `fips` (`1503`), una `abbr` no ambigua (en mayúsculas o minúsculas) o el nombre de la comarca (con
  tildes; `+` o `_` valen de espacio). El enlace conserva la forma con la que se abrió; la app escribe el `fips`.
* `at=x,y,z`: `x`, `y` son el punto en km del centro de la vista (redondeado al km) y
  `z` = **log2(escala de la cámara ÷ escala en la que cabe Galicia entera)**: `0` = país entero, `1` = el doble de cerca,
  negativo = más lejos. En un móvil en vertical la vista inicial es 1,3 veces esa escala. No es la escala absoluta (px
  CSS por km) de `app.flyTo(x, y, scale)` y `camera.scale`: `scale = fitScale × 2^z`, donde `fitScale` es la de "cabe
  entera" (`cam.fitScale` la guarda al encuadrar el inicio). `at` solo se escribe tras mover la cámara.
* Cuándo se escribe: durante un vuelo el enlace nombra ya el **destino** (350 ms de espera); tras arrastrar o hacer zoom,
  350 ms después de que la cámara se pare; `app.setMode` lo escribe en la siguiente tarea. Los cambios de lente,
  selección y claves de extensión añaden una entrada al historial (Atrás los deshace); los de cámara sustituyen la
  actual. `app.hash.flush()` escribe ya (Compartir lo llama antes de copiar).

**Estado opcional y asas de depuración** (no son contratos de datos; no depender de ellos desde otra extensión sin
acordarlo):
* `state.cityBadges`: `Map<id de ciudad, {label, color: "#rrggbb"}>` opcional; `render/banners.js` dibuja con él una
  pestaña de tipo de ciudad en los estandartes que enseñan rendimientos. Lo rellena `ext/cityView` desde
  `districts.json`; si falta, no hay pestañas.
* `app.cityView`: `open`, `close()`, `city` y `model` (modelo actual de la vista de ciudad, solo lectura; `ext/layers`
  lo lee para apartar sus rótulos). `app.advisors`: `list`, `open(id, params)`, `current`, `data()`, `ensureData`.
* `app.mapArt = {model, on, layers}`, de `ext/layers`. `model` tiene `ports`, `airports`, `wonders` (cada elemento
  `{kind, data (fila del JSON), cell, x, y}`, con `x`, `y` = dónde se dibuja), `net`, `parks` y `routes`;
  `installations` y `ranges` quedan vacíos. Los `item` de las capas son `{kind: "port"|"airport"|"wonder"|"route", data}`
  (en las rutas, `data.route` es la fila de `trade.json`, con `a` y `b`). Los asesores usan esa forma para enlazar mapa
  y panel: mantenerla.

**Quién lee qué.** Al renombrar un campo, actualizar `web/js/ext/advisors` y `web/js/ext/cityView`.
* Asesores: de `counties.json`, todas las columnas declaradas en `fields`; de `districts.json`, `cities` y `counties`
  (con `catalog`, `divisions`, `national`); de `citizens.json`, `cities` y `national` (con `groups` y `rows`).
* Vista de ciudad: `citizens.json` (`cities`, `national`, `groups`, `figures`, `rule`), `districts.json` (`cities`,
  `catalog`, `divisions`, `rule`), `counties.json` (hoy `land_km2`, `density`, `gini` y `nacidos_fuera`, buscando
  `geoid` = id de la ciudad) y el `cbsa` de los ítems de `resources.json`.

**Lentes.** Las marcas de la leyenda llevan el número y como mucho una unidad corta. En `int` y `float`, una `unit` de
más de 4 caracteres sale una sola vez bajo las marcas (la densidad, `int` en habitantes, lleva `/km²`), así que `unit`
debe ser una frase simple, no parte del número. `lens.note` se enseña en la leyenda; `format: "category"` usa una
leyenda de muestras de color.

## Diferencias con usaciv que inducen a error
* No existen `military.json` ni `disasters.json` (`loadData` da `null`): no hay capa militar.
* Sin dato gallego: vivienda, crecimiento, serie de población, PIB por rama, `states.energy`, religión, bienestar CDC,
  veteranos y banda ancha.
* `trade.json` cuenta viajes, no dólares ni toneladas. `districts.json` cuenta establecimientos, no empleos.
  `citizens.json` no tiene fila de desplazamientos.
* `infrastructure.json`: puertos y aeropuertos solo tienen nombre y posición; no hay ninguna cifra de tráfico.
