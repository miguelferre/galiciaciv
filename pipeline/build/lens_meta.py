"""Metadata (names, units, descriptions, colour ramps) of the Galician lenses, in Spanish. Helper, no build()."""

GROUPS = [
    {"id": "people", "name": "Población"},
    {"id": "prosperity", "name": "Prosperidad"},
    {"id": "work", "name": "Trabajo"},
    {"id": "climate", "name": "Clima"},
    {"id": "risks", "name": "Riesgos"},
    {"id": "land", "name": "Terreno"},
]

DOMAIN_NOTE = " Los colores abarcan del percentil 2 al 98 de las casillas; los valores fuera de ese rango se pintan con los colores de los extremos."

PER_CONCELLO = (" Cada concello aporta su valor a las casillas que cubre, ponderado por la población que "
                "cae en cada casilla; una casilla que mezcla varios concellos muestra la media ponderada.")

# Lenses computed per concello and spread to cells with population weights: id -> metadata.
CONCELLO_LENSES = {
    "gdp_pc": {
        "group": "prosperity", "name": "PIB por habitante", "icon": "l-income", "emoji": "💶",
        "unit": "euros por habitante", "format": "eur", "scale": "linear", "higher_is": "good",
        "source": "ige_pib",
        "ramp": ["#3a1c0b", "#7a4413", "#b8781f", "#e3b23c", "#f6e27f", "#fffbe0"],
        "description": "PIB de 2023 del concello (IGE, tabla 9958, estimación municipal) dividido entre su "
        "población a 1 de enero de 2025 (padrón del INE). El PIB se atribuye al concello donde se produce, así "
        "que los concellos con mucha industria o polígonos salen altos aunque vivan pocas personas."
        + PER_CONCELLO,
    },
    "unemployment": {
        "group": "work", "name": "Paro registrado", "icon": "l-poverty", "emoji": "📉",
        "unit": "parados registrados por 100 habitantes", "format": "float", "scale": "linear",
        "higher_is": "bad", "source": "ige_paro",
        "ramp": ["#03051a", "#4c1d4b", "#a11a5b", "#e83f3f", "#f69c73", "#faebdd"],
        "description": "Personas inscritas como paradas en los servicios públicos de empleo en octubre de 2026 "
        "(IGE, tabla 742) por cada 100 habitantes del padrón de 2025. No es la tasa de paro: el divisor es la "
        "población total, no la población activa. Oza-Cesuras y Cerdedo-Cotobade quedan en blanco: el IGE "
        "da 0 de paro en esos concellos fusionados, que es un dato ausente y no un cero." + PER_CONCELLO,
    },
    "agro_share": {
        "group": "work", "name": "Afiliación agraria", "icon": "l-farmland", "emoji": "🌾",
        "unit": "parte de las afiliaciones en agricultura y pesca", "format": "pct", "scale": "linear",
        "higher_is": "neutral", "source": "ige_afiliacion",
        "ramp": ["#141d05", "#2f4510", "#557019", "#84a02a", "#b8cf55", "#eef7b8"],
        "description": "Personas afiliadas a la Seguridad Social en agricultura y pesca entre todas las "
        "afiliadas que viven en el concello (IGE, tabla 11497, septiembre de 2026; por concello de residencia). "
        "Deja fuera el empleo agrario sin alta en la Seguridad Social." + PER_CONCELLO,
    },
    "industry_share": {
        "group": "work", "name": "Afiliación industrial", "icon": "l-developed", "emoji": "🏭",
        "unit": "parte de las afiliaciones en industria", "format": "pct", "scale": "linear",
        "higher_is": "neutral", "source": "ige_afiliacion",
        "ramp": ["#121218", "#2c2c3c", "#4b4b66", "#727294", "#a3a3c2", "#e2e2f0"],
        "description": "Personas afiliadas a la Seguridad Social en industria entre todas las afiliadas que "
        "viven en el concello (IGE, tabla 11497, septiembre de 2026; por concello de residencia). No incluye "
        "la construcción." + PER_CONCELLO,
    },
    "renta_pc": {
        "group": "prosperity", "name": "Renta por persona", "icon": "l-income", "emoji": "💶",
        "unit": "euros por persona y año", "format": "eur", "scale": "linear", "higher_is": "good",
        "source": "ine_adrh",
        "ramp": ["#1d1030", "#4a2468", "#7f3f8f", "#b9668f", "#e7a37a", "#fbe7b5"],
        "description": "Renta neta media por persona del concello en 2024 (INE, Atlas de Distribución de Renta "
        "de los Hogares, capa municipal, indicador «Renta neta media por persona»). Es una media, no la mediana." + PER_CONCELLO,
    },
    "gini": {
        "group": "prosperity", "name": "Desigualdad (Gini)", "icon": "l-gini", "emoji": "⚖️",
        "unit": "índice de Gini, de 0 a 100", "format": "float", "scale": "linear", "higher_is": "bad",
        "source": "ine_adrh",
        "ramp": ["#0d2a2a", "#1f5a52", "#4f8f6a", "#a9b85a", "#e6a04a", "#d9483b"],
        "description": "Índice de Gini de la renta del concello en 2024 (INE, Atlas de "
        "Distribución de Renta de los Hogares, capa municipal). 0 = todos tienen la misma renta; 100 = una sola "
        "persona tiene toda la renta. En concellos pequeños unos pocos hogares mueven mucho el valor." + PER_CONCELLO,
    },
    "p80p20": {
        "group": "prosperity", "name": "Distancia P80/P20", "icon": "l-p80p20", "emoji": "📏",
        "unit": "veces", "format": "float", "scale": "linear", "higher_is": "bad",
        "source": "ine_adrh",
        "ramp": ["#0d2a2a", "#1f5a52", "#4f8f6a", "#a9b85a", "#e6a04a", "#d9483b"],
        "description": "Cociente entre el percentil 80 y el percentil 20 de la renta del concello en 2024 (INE, Atlas de Distribución de Renta de los Hogares, indicador «Distribución de la "
        "renta P80/P20»). Un valor de 2 dice que el hogar del percentil 80 tiene el doble de renta que el del "
        "percentil 20." + PER_CONCELLO,
    },
    "edad_media": {
        "group": "people", "name": "Edad media", "icon": "l-age", "emoji": "🎂",
        "unit": "años", "format": "years", "scale": "linear", "higher_is": "neutral",
        "source": "ige_poboacion",
        "ramp": ["#0f2b3d", "#1f5f7a", "#4f9a9a", "#a9c98a", "#e8c46a", "#d9783b"],
        "description": "Edad media de la población del concello a 1 de enero de 2025 (IGE, tabla 723, «Idade media», a partir del padrón)." + PER_CONCELLO,
    },
    "nacidos_fuera": {
        "group": "people", "name": "Nacidos fuera de Galicia", "icon": "l-foreign-born", "emoji": "🧳",
        "unit": "parte de la población", "format": "pct", "scale": "linear", "higher_is": "neutral",
        "source": "ige_poboacion",
        "ramp": ["#141022", "#2e2457", "#4b4a8f", "#6f84b8", "#a9c1d9", "#eef3f7"],
        "description": "Personas empadronadas en el concello a 1 de enero de 2025 que nacieron en otra comunidad autónoma o en el extranjero, entre toda la población del concello (IGE, tabla 143, población por lugar de nacimiento)." + PER_CONCELLO,
    },
    "estudios_superiores": {
        "group": "people", "name": "Estudios superiores", "icon": "l-degrees", "emoji": "🎓",
        "unit": "parte de la población de 15 años o más", "format": "pct", "scale": "linear", "higher_is": "neutral",
        "source": "ige_censo",
        "ramp": ["#10162a", "#22345e", "#3a5d8f", "#5f8fbf", "#9cc3e0", "#e6f2fb"],
        "description": "Personas de 15 años o más con educación superior (nivel «Educación superior» de la tabla del IGE) entre toda la población de 15 años o más del concello (IGE, tabla 11253, a partir del Censo de 2021)." + PER_CONCELLO,
    },
}

CLIMATE_LENSES = {
    "temp": {
        "group": "climate", "name": "Temperatura media", "icon": "l-age", "emoji": "🌡️",
        "unit": "°C, media anual de 2025", "format": "float", "scale": "linear", "higher_is": "neutral",
        "source": "meteogalicia",
        "ramp": ["#2b3a8f", "#3f7fbf", "#79b9c9", "#f2e8a0", "#f5a45a", "#cf3a2a"],
        "description": "Temperatura media anual de 2025 (MeteoGalicia, 12 meses validados por estación). Se "
        "interpola a cada casilla con ponderación por el inverso de la distancia al cuadrado de las 6 "
        "estaciones más próximas, tras llevar cada medida a la altitud de la casilla con -6,5 °C por km "
        "(gradiente fijo, aproximado). La altitud de la casilla es la media del relieve (MDT del IGN).",
    },
    "precip": {
        "group": "climate", "name": "Precipitación anual", "icon": "l-broadband", "emoji": "🌧️",
        "unit": "mm, suma anual de 2025", "format": "int", "scale": "linear", "higher_is": "neutral",
        "source": "meteogalicia",
        "ramp": ["#fff3d6", "#bfe0e0", "#6fb3d6", "#3b7fbf", "#2a4a9a", "#1a1f5e"],
        "description": "Precipitación total de 2025 (MeteoGalicia, 12 meses validados por estación), "
        "interpolada a cada casilla con ponderación por el inverso de la distancia al cuadrado de las 6 "
        "estaciones más próximas. Sin corrección por altitud: en la sierra el valor real puede ser mayor. "
        "Un solo año puede alejarse del clima normal.",
    },
    "viento": {
        "group": "climate", "name": "Viento medio", "icon": "r-wind", "emoji": "🌬️",
        "unit": "m/s, media anual de 2025 a 10 m", "format": "float", "scale": "linear", "higher_is": "neutral",
        "source": "meteogalicia",
        "ramp": ["#f4f1e8", "#c9dfe0", "#8fbfcf", "#5a92b8", "#3a5f9a", "#2a2f6e"],
        "description": "Velocidad media del viento a 10 m en 2025 (MeteoGalicia, parámetro VV_AVG_10m, media de "
        "12 meses validados por estación), interpolada a cada casilla con ponderación por el inverso de la "
        "distancia al cuadrado de las 6 estaciones más próximas. Sin corrección por altitud ni por exposición: "
        "el viento depende mucho del sitio exacto de la estación (cumbre, valle, costa), así que el mapa es "
        "orientativo.",
    },
    "sol": {
        "group": "climate", "name": "Horas de sol", "icon": "l-sun", "emoji": "☀️",
        "unit": "horas de sol, total de 2025", "format": "int", "scale": "linear", "higher_is": "neutral",
        "source": "meteogalicia",
        "ramp": ["#2a2f45", "#5a5a6e", "#9a8a6a", "#d9b25a", "#f2d36a", "#fff3b0"],
        "description": "Horas de sol de 2025 (MeteoGalicia, parámetro HSOL_SUM_1.5m, suma de 12 meses validados "
        "por estación), interpolada a cada casilla con ponderación por el inverso de la distancia al cuadrado de "
        "las 6 estaciones más próximas. Sin corrección por altitud. Pocas estaciones miden el sol: lejos de "
        "ellas el valor es menos fiable.",
    },
    "humedad": {
        "group": "climate", "name": "Humedad relativa", "icon": "l-humidity", "emoji": "💧",
        "unit": "humedad relativa, media anual de 2025", "format": "pct", "scale": "linear", "higher_is": "neutral",
        "source": "meteogalicia",
        "ramp": ["#fff3d6", "#d6e8c9", "#9fd0b8", "#5fa9a9", "#337a8f", "#1a4a6e"],
        "description": "Humedad relativa media del aire a 1,5 m en 2025 (MeteoGalicia, parámetro HR_AVG_1.5m, "
        "media de 12 meses validados por estación), interpolada a cada casilla con ponderación por el inverso de "
        "la distancia al cuadrado de las 6 estaciones más próximas. Sin corrección por altitud.",
    },
}

# Station field (meteogalicia interim) and rounding of each climate lens; pct lenses divide by 100.
CLIMATE_FIELDS = {"temp": ("temp_c", 1), "precip": ("precip_mm", 0), "viento": ("wind_ms", 1),
                  "sol": ("sun_h", 0), "humedad": ("humidity_pct", 3)}

FIRE_YEARS = list(range(2016, 2026))
_FIRE_RAMP = ["#3b2a5e", "#5a3a8a", "#7a4aa8", "#9a5ab8", "#b86aa8", "#d47a8a", "#e8906a", "#f2a84a", "#f7c63a", "#fbe66a"]

RISK_LENSES = {
    "incendios": {
        "group": "risks", "name": "Superficie quemada", "icon": "l-fire", "emoji": "🔥",
        "unit": "parte de la casilla quemada de 2016 a 2025", "format": "pct", "scale": "linear", "higher_is": "bad",
        "source": "effis",
        "ramp": ["#1a1410", "#4a2412", "#8a3414", "#c8501a", "#f08a2a", "#ffd76a"],
        "description": "Parte de la superficie de la casilla dentro de al menos un perímetro quemado entre 2016 y "
        "2025 (EFFIS, Copernicus, áreas quemadas cartografiadas por satélite; 977 perímetros en Galicia). Una zona "
        "que ardió dos veces cuenta una sola vez, así que el valor no pasa del 100 %. EFFIS detecta con fiabilidad "
        "los incendios a partir de unas 30 ha; trae algunos menores, pero la mayoría de los incendios pequeños de "
        "Galicia no salen. Las casillas sin incendio registrado valen 0.",
    },
    "incendio_anyo": {
        "group": "risks", "name": "Año del mayor incendio", "icon": "l-fire-year", "emoji": "📅",
        "unit": "año", "format": "category", "scale": "linear", "higher_is": "neutral",
        "source": "effis", "sparse": True,
        "ramp": _FIRE_RAMP,
        "categories": [{"id": str(y), "name": str(y), "color": c} for y, c in zip(FIRE_YEARS, _FIRE_RAMP)],
        "description": "Año del incendio más grande (por hectáreas totales del perímetro) que toca la casilla, "
        "de 2016 a 2025 (EFFIS, Copernicus, perímetros por satélite; la detección es fiable desde unas 30 ha). "
        "En blanco donde EFFIS no registra ningún incendio.",
    },
    "inundacion": {
        "group": "risks", "name": "Zona inundable T=100", "icon": "l-flood", "emoji": "🌊",
        "unit": "parte de la casilla en zona inundable", "format": "pct", "scale": "linear", "higher_is": "bad",
        "source": "snczi",
        "ramp": ["#141a22", "#1f3a52", "#2f5f8a", "#4a8fbf", "#8fc3e6", "#e6f6ff"],
        "description": "Parte de la superficie de la casilla dentro de la lámina de inundación de periodo de "
        "retorno de 100 años (MITECO, Sistema Nacional de Cartografía de Zonas Inundables, láminas de Miño-Sil, "
        "Galicia-Costa, Cantábrico Occidental y Duero). La lámina incluye el propio cauce. Solo hay lámina en "
        "los tramos de río y costa que se estudiaron: un 0 fuera de ellos no quiere decir que no haya riesgo.",
    },
}

LAND_LENSES = {
    "forest": (["forest"], {
        "name": "Bosque", "icon": "l-forest", "emoji": "🌲", "source": "worldcover",
        "ramp": ["#0b1f0f", "#14401c", "#1f6b2b", "#3a9443", "#7fc07a", "#d5efcd"],
        "description": "Parte de la superficie de la casilla cubierta por bosque (ESA WorldCover 2021, clase "
        "árboles). WorldCover no distingue especies: no separa roble, pino ni eucalipto."}),
    "farmland": (["crop", "pasture"], {
        "name": "Cultivo y prado", "icon": "l-farmland", "emoji": "🚜", "source": "worldcover",
        "ramp": ["#141d05", "#2f4510", "#557019", "#84a02a", "#b8cf55", "#eef7b8"],
        "description": "Parte de la superficie de la casilla que es cultivo o pasto (ESA WorldCover 2021, "
        "clases cultivos y pastizales). Los prados gallegos salen como pasto."}),
    "developed": (["developed"], {
        "name": "Suelo urbanizado", "icon": "l-developed", "emoji": "🏙️", "source": "worldcover",
        "ramp": ["#121218", "#2c2c3c", "#4b4b66", "#727294", "#a3a3c2", "#e2e2f0"],
        "description": "Parte de la superficie de la casilla ocupada por edificios, calles y otras superficies "
        "artificiales (ESA WorldCover 2021, clase suelo construido)."}),
}

ELEVATION = {
    "id": "elevation", "group": "land", "name": "Altitud", "icon": "l-forest", "emoji": "⛰️",
    "unit": "metros sobre el nivel del mar", "format": "int", "scale": "linear", "higher_is": "neutral",
    "source": "mdt_ign",
    "ramp": ["#1d4a3a", "#4d8a4a", "#a9b85a", "#d9b46a", "#a87a52", "#f2efe8"],
    "description": "Altitud media de las muestras de tierra de la casilla (Modelo Digital del Terreno del IGN, "
    "malla de 200 m).",
}
