# Registro de licencias de los datos

Una fila por fuente activa del pipeline (`pipeline/sources/`, más ETOPO1 dentro de `tools/prep_raster.py`).
Textos de licencia y avisos legales leídos con una petición real el 2026-11-26. «Verificada = sí»: se leyó el
texto; «parcial»: se leyó, pero falta un dato que se dice en la columna. PrazaGal (CC BY-NC-SA) no entra (D-002).

Publicar es un paso aparte, con un sí explícito de Miguel (D-002). Antes de publicar hay que resolver los
avisos de la sección final, sobre todo AENA y Puertos del Estado.

## Tabla

| Fuente (módulo) | Datos | Editor | Licencia | Compartir igual | No comercial | Atribución exacta | Verificada | URL de la licencia |
|---|---|---|---|---|---|---|---|---|
| `ign_limites` | Límites de los 313 concellos y de las provincias de Asturias, León y Zamora (WFS INSPIRE «Unidades administrativas», `au:AdministrativeUnit`); Portugal: Natural Earth 1:10m (países, v5.1.2) | IGN (concellos y provincias); Natural Earth (Portugal) | IGN: CC BY 4.0 (campo AccessConstraints del WFS: «CC BY 4.0 ign.es»; Fees: «No se aplican condiciones»). Natural Earth: dominio público | No | No | IGN: «© Instituto Geográfico Nacional» (con «CC BY 4.0 ign.es»), en la leyenda del mapa y en la página de presentación. Natural Earth: ninguna obligatoria | Sí (GetCapabilities leído el 2026-11-26; los datos se simplifican a ~55 m, hay que decir que son una obra derivada) | https://www.ign.es/wfs-inspire/unidades-administrativas?service=WFS&request=GetCapabilities ; https://www.naturalearthdata.com/about/terms-of-use/ |
| `ige_comarcas`, `ige_pib`, `ige_paro`, `ige_afiliacion`, `ige_poboacion`, `ige_censo`, `ige_ramas`, `ige_unidades` | Comarcas (2246), PIB (9958), paro (742), afiliación (11497), padrón por edad, origen y edad media (144, 143, 723), censo de estudios y ocupación (11253, 11265), afiliación por ramas (10058), unidades locales por división CNAE (9002) | Instituto Galego de Estatística (IGE), Xunta de Galicia | CC BY-SA 4.0 según el registro de la API en datos.gob.es; el aviso legal del IGE solo pide cita | **Sí** (registro CC BY-SA) | No | «Fuente: IGE: https://www.ige.gal». Con la API, además: «Este producto emplea la API de datos del Instituto Galego de Estatística (IGE), pero no está certificado o aprobado por el IGE» | Sí (los dos textos no coinciden: ver avisos) | https://www.ige.gal/web/avisolegal.jsp?idioma=es ; https://creativecommons.org/licenses/by-sa/4.0/deed.es |
| `ine_padron` | Padrón a 1 de enero de 2025, por concello (llega por la tabla 589 del IGE) | INE, difundido por el IGE | Condiciones del IGE (fila anterior); el INE da CC BY 4.0 a lo suyo | Sí, si rige el registro del IGE | No | «Fuente: IGE: https://www.ige.gal» y «Elaboración propia con datos extraídos del sitio web del INE: www.ine.es» | Parcial (el registro CC BY-SA es de la API en conjunto, no de la tabla 589) | https://www.ine.es/ss/Satellite?L=es_ES&c=Page&cid=1254735849170&p=1254735849170&pagename=Ayuda%2FINELayout |
| `ine_adrh` | Atlas de Distribución de Renta de los Hogares 2024, capa municipal | INE | Aviso legal del INE: reutilización comercial o no comercial con cita | No | No | «Elaboración propia con datos extraídos del sitio web del INE: www.ine.es», con la fecha de actualización | Sí | https://www.ine.es/ss/Satellite?L=es_ES&c=Page&cid=1254735849170&p=1254735849170&pagename=Ayuda%2FINELayout |
| `meteogalicia` | Observaciones mensuales de 167 estaciones (temperatura, lluvia, viento, sol, humedad) | MeteoGalicia, Consellería de Medio Ambiente e Cambio Climático, Xunta de Galicia | Aviso legal sin licencia con nombre: uso libre y gratuito citando la fuente | No consta | No consta | «Fuente: MeteoGalicia e Consellería de Medio Ambiente e Cambio Climático da Xunta de Galicia» | Parcial (el aviso cubre la web; los servicios JSON `mgrss` no traen aviso propio) | https://www.meteogalicia.gal/web/aviso-legal |
| `mdt_ign` | Relieve: MDT200 del IGN (WCS) | IGN / CNIG | CC BY 4.0 (Orden FOM/2807/2015) | No | No | «Obra derivada de MDT200 2015 CC-BY 4.0 ign.es», visible al pie del mapa | Parcial (el año 2015 sale de la tabla de productos; no se comprobó el año del WCS) | https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf |
| `mdt_ign` (parte, en `tools/prep_raster.py`) | Mar y Portugal: NOAA ETOPO1 (ERDDAP `etopo180`) | NOAA NCEI | Sin licencia con nombre: uso y redistribución libres | No | No | Cita sugerida: Amante, C. y Eakins, B. W., 2009, ETOPO1 1 Arc-Minute Global Relief Model, NOAA Technical Memorandum NESDIS NGDC-24 | Parcial (el texto dice uso libre, no «dominio público») | https://coastwatch.pfeg.noaa.gov/erddap/info/etopo180/index.html |
| `worldcover` | Cobertura del suelo, ESA WorldCover 2021 v200 | ESA y consorcio WorldCover | CC BY 4.0 | No | No | «© ESA WorldCover project / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium» | Sí (texto leído en el README oficial; la web de ESA no respondió) | https://creativecommons.org/licenses/by/4.0/ |
| `osm_rios` | Ríos y embalses (Overpass) | OpenStreetMap Foundation y colaboradores | ODbL 1.0 | **Sí** | No | «© colaboradores de OpenStreetMap», enlazado a https://www.openstreetmap.org/copyright, en una esquina del mapa | Sí | https://www.openstreetmap.org/copyright |
| `effis` | Perímetros quemados 2016-2025 (WFS) | Comisión Europea, JRC, Copernicus EMS | CC BY 4.0 (política de reutilización de la Comisión) | No | No | «© Unión Europea, EFFIS, https://forest-fire.emergency.copernicus.eu», con aviso de que los datos se modificaron | Sí | https://forest-fire.emergency.copernicus.eu/about-effis/data-license |
| `snczi` | Láminas de inundación T=100 (WFS) | MITECO | Uso libre y gratuito con cita; el registro de la IDEE dice CC BY 4.0 | No | No | «Fuente: © Ministerio para la Transición Ecológica y el Reto Demográfico» | Sí | https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/zi-lamina.html |
| `natural_earth` | Registrada, pero ningún builder la usa (los ríos salen de OSM; Portugal se lee en `ign_limites`) | Natural Earth | Dominio público | No | No | Ninguna obligatoria | Sí | https://www.naturalearthdata.com/about/terms-of-use/ |
| `osm_vias`, `osm_aeropuertos` | Autopistas, autovías, vías rápidas y ferrocarril (Overpass); nombre y centro de los tres aeródromos (`aeroway=aerodrome`) | OpenStreetMap Foundation y colaboradores | ODbL 1.0 | **Sí** | No | «© colaboradores de OpenStreetMap», enlazado a https://www.openstreetmap.org/copyright | Sí | https://www.openstreetmap.org/copyright |
| `wikidata_puertos` (antes `puertos_estado`) | Nombre y posición (P625) de los 6 puertos de interés general. **Las cifras de tráfico de Puertos del Estado ya no se usan**: su aviso legal exige autorización escrita previa | Wikidata, Fundación Wikimedia | CC0 | No | No | Ninguna obligatoria | Sí | https://www.wikidata.org/wiki/Wikidata:Licensing |
| `osm_aeropuertos` (antes `aena`) | Nombre y posición de los 3 aeropuertos (OSM). **Las cifras de Aena (pasajeros, operaciones, mercancías) ya no se usan**: su aviso legal exige autorización escrita previa | OpenStreetMap Foundation y colaboradores | ODbL 1.0 | **Sí** | No | «© colaboradores de OpenStreetMap», enlazado a https://www.openstreetmap.org/copyright | Sí | https://www.openstreetmap.org/copyright |
| `xunta_eolica` | Aerogeneradores (IDEG, `enerxia_eolica_v2`, capa 4) | Xunta de Galicia | Licencia por defecto del geoportal, compatible con CC BY 4.0 | No | No | «Cartografía cedida por © [departamento]. Xunta de Galicia» | Parcial (sin ficha propia; falta el departamento) | https://mapas.xunta.gal/gl/aviso-legal ; https://mapas.xunta.gal/gl/axuda |
| `visaf_bic` | Bienes de Interés Cultural (VISAF `PatrimonioCultural`) | Xunta de Galicia | Licencia por defecto del geoportal, compatible con CC BY 4.0. El ODS de BIC de abertos.xunta.gal es CC BY-SA 4.0 y no se usa | No (según el geoportal) | No | «Cartografía cedida por © [departamento]. Xunta de Galicia» | Parcial (sin ficha propia; falta el departamento) | https://mapas.xunta.gal/gl/aviso-legal ; https://mapas.xunta.gal/gl/axuda |
| `igme_bdmin` | Explotaciones de rocas y minerales industriales (BDMIN) | CN IGME, CSIC | Licencia de uso CN IGME 2022: uso comercial y no comercial. El servicio pide contactar antes de montar un servicio de pago | No consta | No (un servicio de pago exige contacto) | «Origen de los datos: ©CN Instituto Geológico y Minero de España (IGME)», con fecha de consulta y https://info.igme.es/bdmin | Sí (los dos textos difieren) | https://www.igme.es/condiciones-de-uso/ ; https://info.igme.es/media/Pdfs/LicUsoIGME_GENERICA_2022.pdf |
| `pesca_lonxas` | Primera venta de pesca fresca 2025 (CSV anual) | Xunta de Galicia, Consellería do Mar | Aviso legal del portal: reutilización comercial y no comercial con cita. Un conjunto abierto relacionado es CC BY-SA 4.0 | No según el aviso (decisión pendiente) | No | «Fonte: Pesca de Galicia, Xunta de Galicia» (fórmula propia: el aviso solo obliga a citar) | Sí | https://www.pescadegalicia.gal/gl/aviso-legal |
| `mitma_movilidad` | Viajes origen-destino por zonas municipales, un día (12-03-2025) | Ministerio de Transportes (MITMA) | Licencia de datos abiertos del MITMA (2020) | **Sí para los datos que se redistribuyen**; una obra derivada con valor añadido puede usar otra | No | «Basado en datos abiertos MITMA», con enlace a la página de descarga. Pide mostrar información «siempre actualizada» | Sí | https://movilidad-opendata.mitma.es/LICENCIA%20de%20datos%20abiertos%20del%20MITMA%2020201203.pdf |
| `ign_ppnn` | Límite del Parque Nacional das Illas Atlánticas | IGN (servicio) con dato del OAPN, MITECO | Metadatos del OAPN: CC BY 4.0; aviso del IGN compatible con CC BY 4.0 | No | No | «Fuente: Organismo Autónomo Parques Nacionales» y «© Instituto Geográfico Nacional de España» | Parcial (que la capa del IGN sea el fichero del OAPN es una inferencia) | https://www.miteco.gob.es/content/dam/miteco/es/parques-nacionales-oapn/red-parques-nacionales/sig/l%C3%ADmites-parques/Metadatos_Limites_PN.pdf ; https://www.ign.es/web/ign/portal/info-aviso-legal |
| `wikidata_unesco` | Bienes con identificador UNESCO (P757) en Galicia | Wikidata, Fundación Wikimedia | CC0 | No | No | Ninguna obligatoria | Sí | https://www.wikidata.org/wiki/Wikidata:Licensing |

## Avisos antes de publicar

1. **GISCO retirado (2026-11-26).** Los límites de GISCO LAU 2023 (© EuroGeographics) eran no comerciales: su página dice «the data
   will not be used for commercial purposes» y remite a EuroGeographics para el uso comercial
   (https://ec.europa.eu/eurostat/web/gisco/geodata/administrative-units, leída el 2026-11-26). Sustituidos por
   `ign_limites` (IGN, CC BY 4.0; Portugal de Natural Earth). El módulo `gisco_lau` ya no existe. Queda resuelto.
2. **Compartir igual.** El IGE (registro CC BY-SA 4.0) y OSM (ODbL) piden la misma licencia para una obra
   derivada. Falta decidir si los JSON publicados en `web/data/` son obra derivada y con qué licencia salen.
3. **IGE: dos textos.** El aviso legal pide solo cita; el registro de datos.gob.es de la API dice CC BY-SA 4.0.
   Se toma el más estricto.
4. **Sin verificar:** año real del MDT200 que sirve el WCS; condiciones propias de los servicios JSON de
   MeteoGalicia y del WFS de EFFIS frente a sus avisos generales.
5. `natural_earth` sigue en `sources.json` (Almanaque) aunque ningún builder lee sus lagos y ríos. Los países de Portugal
   se leen ahora desde `ign_limites` (fichero 1:10m propio), no desde `natural_earth`. Decidir si retirar `natural_earth`.
6. **AENA y Puertos del Estado: cifras retiradas (2026-11-26).** Los dos piden autorización escrita previa para
   cualquier uso; como el sitio se va a publicar, el pipeline ya no descarga ni usa sus datos (tonelaje, pasajeros,
   operaciones, mercancías). Puertos y aeropuertos siguen en el mapa solo con nombre y posición (Wikidata CC0 y
   OSM ODbL), todos del mismo tamaño. Si se obtiene la autorización, se pueden recuperar las cifras. Queda resuelto.
7. **MITMA** pide información «siempre actualizada». El mapa enseña un solo día y escribe su fecha; no está
   resuelto si eso basta. Los datos redistribuidos mantienen la licencia del MITMA.
8. **Xunta (eólica y BIC):** falta el departamento para la fórmula de atribución. **Pesca de Galicia:** decidir
   si se trata como CC BY-SA 4.0 por el conjunto abierto relacionado.
9. **IGME:** un servicio de pago sobre sus datos exige contactar antes.
10. La atribución de las capas nuevas sale en los avisos emergentes y en el Almanaque. Falta un pie de créditos
    visible en el mapa (OSM, IGN, MITMA) antes de publicar.

## Código

Componentes de terceros copiados en el repo. La base del visor (usaciv, MIT) se cubre en `LICENSE`.

| Componente | Dónde | Autor | Licencia | Atribución exacta | Verificada | Origen |
|---|---|---|---|---|---|---|
| Three.js 0.185.1 | `web/vendor/three/`, usado por `web/js/ext/relief3d/` | three.js authors | MIT | «Copyright © 2010-2026 three.js authors», con el texto de `web/vendor/three/LICENSE` | Sí (`LICENSE` del paquete de npm, SHA-512 comprobado el 2026-11-26) | https://registry.npmjs.org/three/-/three-0.185.1.tgz |

## Datos derivados del relieve 3D

`tools/prep_relief3d.py` genera un fichero a partir de fuentes de la tabla de arriba (ninguna nueva). La atribución
sale en la leyenda de la vista cuando el detalle es «alto».

| Fichero | Fuentes que contiene | Licencias que arrastra | Atribución que se muestra |
|---|---|---|---|
| `web/data/relief3d_detalle.bin` | MDT200 (IGN), ETOPO1 (NOAA), ESA WorldCover 2021 (leído a unos 100 m), ríos de OpenStreetMap simplificados | CC BY 4.0 (IGN y WorldCover); uso libre (ETOPO1); **ODbL para los ríos, con compartir igual** | «Obra derivada de MDT200 2015 CC-BY 4.0 ign.es»; «Mar y Portugal: NOAA ETOPO1»; «© ESA WorldCover project / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium»; «© colaboradores de OpenStreetMap» |
