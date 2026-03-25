import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import fetch from "node-fetch";
import { getSuperlogicaConfig, SUPERLOGICA_BASE_URL } from "./superlogicaConfig";

if (!admin.apps.length) admin.initializeApp();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const normalizeDate = (raw: string) => {
  const d = (raw || "").split(" ")[0];
  if (d.includes("-")) {
    const [y, m, dd] = d.split("-");
    return `${dd}/${m}/${y}`;
  }
  if (/\d{2}\/\d{2}\/\d{4}/.test(d)) {
    const [mm, dd, yyyy] = d.split("/");
    return `${dd}/${mm}/${yyyy}`;
  }
  return d || "";
};

const clean = (s: string) => String(s || "").trim();
const onlyDigits = (s: string) => String(s || "").replace(/\D/g, "");

export const httpBoletoSearch = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.set(corsHeaders).status(204).send("");
      return;
    }
    res.set(corsHeaders);
    try {
      const q: any = req.method === "GET" ? req.query : req.body;
      const condo = clean(q.condo || "");
      const cpfRaw = clean(q.cpf || "");
      const status = clean(q.status || "pendentes");
      const dtInicio = clean(q.dtInicio || "01/01/1900");
      const dtFim = clean(q.dtFim || "12/31/2099");
      const tenantId = clean(q.tenantId || q.tenant || "");
      const appTokenArg = clean(q.appToken || "");
      const accessTokenArg = clean(q.accessToken || "");

      if (!condo || !cpfRaw) {
        res.status(400).json({ error: "condo e cpf são obrigatórios" });
        return;
      }
      const cpf = onlyDigits(cpfRaw);
      if (cpf.length < 11) {
        res.status(400).json({ error: "CPF inválido" });
        return;
      }

      let headers: any = {};
      if (appTokenArg && accessTokenArg) {
        headers = { "Content-Type": "application/json", app_token: appTokenArg, access_token: accessTokenArg };
      } else {
        const cfg = await getSuperlogicaConfig(tenantId);
        headers = { "Content-Type": "application/json", app_token: cfg.appToken, access_token: cfg.accessToken };
      }

      const resolveCondoId = async (idOrName: string): Promise<string> => {
        const s = clean(idOrName);
        if (/^\d+$/.test(s)) return s;
        const resp = await fetch(`${SUPERLOGICA_BASE_URL}/condominios/get?id=-1&somenteCondominiosAtivos=1&apenasColunasPrincipais=1`, { method: "GET", headers });
        if (!resp.ok) throw new Error(`condominios ${resp.status}`);
        const arr: any[] = await resp.json();
        const norm = (x: string) => (x || "").toLowerCase().trim();
        const found = arr.find((c: any) => norm(c.st_fantasia_cond || c.st_nome_cond) === norm(s));
        if (!found) throw new Error("condominio não encontrado");
        return String(found.id_condominio_cond);
      };

      const condoId = await resolveCondoId(condo);
      const unitsUrl = `${SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${condoId}&pesquisa=${cpf}&exibirDadosDosContatos=1`;
      let units: any[] = [];
      try {
        const r = await fetch(unitsUrl, { method: "GET", headers });
        if (r.ok) units = await r.json();
      } catch {}
      if (!Array.isArray(units)) units = [];
      const unitIds = units.map((u: any) => String(u.id_unidade_uni)).filter(Boolean);
      const encInicio = encodeURIComponent(dtInicio);
      const encFim = encodeURIComponent(dtFim);
      const cobrancas: any[] = [];

      const pushUnits = async (st: string) => {
        for (const unitId of unitIds) {
          let pagina = 1;
          while (true) {
            const url = `${SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${condoId}&status=${st}&UNIDADES[0]=${unitId}&dtInicio=${encInicio}&dtFim=${encFim}&filtrarpor=vencimento&comDadosDasUnidades=1&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
            const resp = await fetch(url, { method: "GET", headers });
            if (!resp.ok) break;
            let page: any[] = [];
            try { page = await resp.json(); } catch { page = []; }
            if (!Array.isArray(page) || page.length === 0) break;
            for (const c of page) {
              c.unitId = unitId;
              const mu = units.find((u: any) => String(u.id_unidade_uni) === unitId);
              c.unitLabel = mu?.st_fantasia_uni || mu?.st_unidade_uni || `Unidade ${unitId}`;
            }
            cobrancas.push(...page);
            if (page.length < 50) break;
            pagina++;
            if (pagina > 10) break;
          }
        }
      };
      const pushSearch = async (st: string) => {
        let pagina = 1;
        while (true) {
          const url = `${SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${condoId}&status=${st}&pesquisa=${cpf}&dtInicio=${encInicio}&dtFim=${encFim}&filtrarpor=vencimento&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
          const resp = await fetch(url, { method: "GET", headers });
          if (!resp.ok) break;
          let page: any[] = [];
          try { page = await resp.json(); } catch { page = []; }
          if (!Array.isArray(page) || page.length === 0) break;
          cobrancas.push(...page);
          if (page.length < 50) break;
          pagina++;
          if (pagina > 10) break;
        }
      };

      if (unitIds.length > 0) {
        await pushUnits(status);
        if (cobrancas.length === 0) await pushUnits("validos");
        if (cobrancas.length === 0) await pushUnits("abertos");
      }
      if (cobrancas.length === 0) {
        await pushSearch(status);
        if (cobrancas.length === 0) await pushSearch("validos");
        if (cobrancas.length === 0) await pushSearch("abertos");
      }

      const seen = new Set<string>();
      const unique = cobrancas.filter((c: any) => {
        const id = String(c.id_recebimento_recb || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const items = unique.map((c: any) => ({
        id: String(c.id_recebimento_recb || ""),
        vencimento: normalizeDate(String(c.dt_vencimento_recb || "")),
        valor: c.vl_total_recb ? Number(c.vl_total_recb) : 0,
        unidade: String(c.unitLabel || ""),
        status: String(c.fl_status_recb ?? ""),
      }));
      res.status(200).json({ count: items.length, items });
    } catch (e: any) {
      res.status(500).json({ error: String(e && e.message) || String(e) });
    }
  });
