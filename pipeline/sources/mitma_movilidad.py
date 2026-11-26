"""MITMA mobile-phone mobility: one working day (2025-03-12), origin-destination by municipal zone.

tools/prep_mitma.py downloads the daily matrix and reduces it to dia_galicia.json; see its docstring.
The zones are MITMA's municipal zoning: small concellos are grouped (313 concellos, ~208 zones).
Flows carry zone ids; ids starting with "ext_" are the aggregated ends outside Galicia.
"""

from __future__ import annotations

import json

from ..core.source import Source, SourceInfo
from . import _ige

FILE = "dia_galicia.json"


class MitmaMovilidad(Source):
    """Origin-destination flows prepared by tools/prep_mitma.py (one large download, outside the pipeline)."""

    info = SourceInfo(
        id="mitma_movilidad",
        title="Movilidad diaria con telefonía móvil: viajes entre zonas municipales (un día)",
        publisher="Ministerio de Transportes (MITMA, hoy de Transportes y Movilidad Sostenible)",
        homepage="https://www.transportes.gob.es/ministerio/proyectos-singulares/estudios-de-movilidad-con-big-data/opendata-movilidad",
        license="Basado en datos abiertos MITMA (https://www.mitma.es). Licencia de datos abiertos del MITMA: permite "
        "reutilización comercial y no comercial; exige citar la fuente con enlace; los datos se comparten con la misma "
        "licencia y las obras derivadas pueden usar otra; no sugerir apoyo del Ministerio; no falsear; conservar fecha "
        "y condiciones; pide mantener la información actualizada. Texto: "
        "https://movilidad-opendata.mitma.es/LICENCIA%20de%20datos%20abiertos%20del%20MITMA%2020201203.pdf",
        description="Viajes de más de 500 metros de residentes en España, estimados a partir de líneas móviles de Orange "
        "y expandidos a la población. Un solo día laborable (miércoles 12 de marzo de 2025), todas las horas sumadas, "
        "entre las zonas municipales MITMA (los concellos pequeños van agrupados). Distancias en línea recta. "
        "Los extremos fuera de Galicia se agrupan en resto de España, Portugal, Francia y resto del mundo.",
        used_for=["Rutas comerciales (flujos entre zonas)", "Viajes por zona y por motivo de destino"],
    )

    def fetch(self, force=False):
        if not (self.raw_dir / FILE).exists():
            raise FileNotFoundError(
                f"{self.raw_dir / FILE} missing - run: PYTHONUTF8=1 uv run python tools/prep_mitma.py"
            )

    def process(self):
        path = self.raw_dir / FILE
        if not path.exists():
            raise FileNotFoundError(f"mitma_movilidad: {path} is missing - run: uv run python tools/prep_mitma.py")
        d = json.loads(path.read_text(encoding="utf-8"))

        concellos = [c for z in d["zones"] for c in z["concellos"]]
        if len(concellos) != len(set(concellos)):
            raise RuntimeError("mitma_movilidad: a concello appears in two zones")
        _ige.check_count(concellos, "mitma_movilidad zones")
        galician = {z["id"] for z in d["zones"]}
        known = galician | {z["id"] for z in d["ext_zones"]}
        for o, dest, trips, km, acts in d["flows"]:
            if o not in known or dest not in known or not (o in galician or dest in galician):
                raise RuntimeError(f"mitma_movilidad: unexpected pair {o} -> {dest}")
            if trips < 0 or km < 0 or abs(sum(acts.values()) - trips) > 0.5:
                raise RuntimeError(f"mitma_movilidad: inconsistent values for {o} -> {dest}")
        total = d["galicia_total_trips"]
        summed = sum(f[2] for f in d["flows"])
        # each pair was rounded to 0.1 after summing
        if abs(summed - total) > 0.05 * len(d["flows"]) + 0.1:
            raise RuntimeError(f"mitma_movilidad: flows add up to {summed:,.1f}, total says {total:,.1f}")

        y, m, day = d["date"].split("-")
        months = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split()
        return {
            "vintage": f"MITMA, un día laborable: {int(day)} de {months[int(m) - 1]} de {y}",
            "date": d["date"],
            "zones": d["zones"],
            "ext_zones": d["ext_zones"],
            "flows": d["flows"],
            "galicia_total_trips": total,
            "split": d["split"],
            "breakdowns": d["breakdowns"],
            "columns_source": d["columns_source"],
            "_files": d["raw_files"],  # the downloads; dia_galicia.json is derived from them (not in the manifest)
        }
