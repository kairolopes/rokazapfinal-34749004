"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const admin = __importStar(require("firebase-admin"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const superlogicaConfig_1 = require("../superlogicaConfig");
if (!admin.apps.length)
    admin.initializeApp();
function arg(name, def = "") {
    const i = process.argv.indexOf(`--${name}`);
    if (i >= 0 && process.argv[i + 1])
        return String(process.argv[i + 1]);
    return def;
}
function cleanCpf(cpf) {
    return String(cpf || "").replace(/\D/g, "");
}
async function resolveCondoId(headers, idOrName) {
    const s = String(idOrName || "").trim();
    if (/^\d+$/.test(s))
        return s;
    const resp = await (0, node_fetch_1.default)(`${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/condominios/get?id=-1&somenteCondominiosAtivos=1&apenasColunasPrincipais=1`, { method: "GET", headers });
    if (!resp.ok)
        throw new Error(`condominios ${resp.status}`);
    const arr = await resp.json();
    const norm = (x) => (x || "").toLowerCase().trim();
    const found = arr.find((c) => norm(c.st_fantasia_cond || c.st_nome_cond) === norm(s));
    if (!found)
        throw new Error("condominio não encontrado");
    return String(found.id_condominio_cond);
}
async function run() {
    const tenantId = arg("tenant") || process.env.TENANT_ID || "";
    const condo = arg("condo");
    const cpfRaw = arg("cpf");
    const status = arg("status", "pendentes");
    const dtInicio = arg("dtInicio", "01/01/1900");
    const dtFim = arg("dtFim", "31/12/2099");
    const appTokenArg = arg("appToken") || process.env.SUPERLOGICA_APP_TOKEN || "";
    const accessTokenArg = arg("accessToken") || process.env.SUPERLOGICA_ACCESS_TOKEN || "";
    if (!condo || !cpfRaw) {
        console.error("uso: node lib/cli/searchBoletosCli.js --tenant TENANT --condo CONDO --cpf CPF [--status pendentes|validos|abertos] [--dtInicio DD/MM/YYYY] [--dtFim DD/MM/YYYY]");
        process.exit(1);
    }
    const cpf = cleanCpf(cpfRaw);
    if (cpf.length < 11) {
        console.error("CPF inválido");
        process.exit(1);
    }
    let headers = {};
    if (appTokenArg && accessTokenArg) {
        headers = { "Content-Type": "application/json", app_token: appTokenArg, access_token: accessTokenArg };
    }
    else {
        const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantId);
        headers = { "Content-Type": "application/json", app_token: cfg.appToken, access_token: cfg.accessToken };
    }
    const condoId = await resolveCondoId(headers, condo);
    const unitsUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${condoId}&pesquisa=${cpf}&exibirDadosDosContatos=1`;
    let units = [];
    try {
        const r = await (0, node_fetch_1.default)(unitsUrl, { method: "GET", headers });
        if (r.ok)
            units = await r.json();
    }
    catch (_a) { }
    if (!Array.isArray(units))
        units = [];
    const unitIds = units.map((u) => String(u.id_unidade_uni)).filter(Boolean);
    const cobrancas = [];
    const encInicio = encodeURIComponent(dtInicio);
    const encFim = encodeURIComponent(dtFim);
    const pushUnits = async (st) => {
        for (const unitId of unitIds) {
            let pagina = 1;
            while (true) {
                const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${condoId}&status=${st}&UNIDADES[0]=${unitId}&dtInicio=${encInicio}&dtFim=${encFim}&filtrarpor=vencimento&comDadosDasUnidades=1&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                const resp = await (0, node_fetch_1.default)(url, { method: "GET", headers });
                if (!resp.ok)
                    break;
                let page = [];
                try {
                    page = await resp.json();
                }
                catch (_a) {
                    page = [];
                }
                if (!Array.isArray(page) || page.length === 0)
                    break;
                for (const c of page) {
                    c.unitId = unitId;
                    const mu = units.find((u) => String(u.id_unidade_uni) === unitId);
                    c.unitLabel = (mu === null || mu === void 0 ? void 0 : mu.st_fantasia_uni) || (mu === null || mu === void 0 ? void 0 : mu.st_unidade_uni) || `Unidade ${unitId}`;
                }
                cobrancas.push(...page);
                if (page.length < 50)
                    break;
                pagina++;
                if (pagina > 10)
                    break;
            }
        }
    };
    const pushSearch = async (st) => {
        let pagina = 1;
        while (true) {
            const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${condoId}&status=${st}&pesquisa=${cpf}&dtInicio=${encInicio}&dtFim=${encFim}&filtrarpor=vencimento&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
            const resp = await (0, node_fetch_1.default)(url, { method: "GET", headers });
            if (!resp.ok)
                break;
            let page = [];
            try {
                page = await resp.json();
            }
            catch (_a) {
                page = [];
            }
            if (!Array.isArray(page) || page.length === 0)
                break;
            cobrancas.push(...page);
            if (page.length < 50)
                break;
            pagina++;
            if (pagina > 10)
                break;
        }
    };
    if (unitIds.length > 0) {
        await pushUnits(status);
        if (cobrancas.length === 0)
            await pushUnits("validos");
        if (cobrancas.length === 0)
            await pushUnits("abertos");
    }
    if (cobrancas.length === 0) {
        await pushSearch(status);
        if (cobrancas.length === 0)
            await pushSearch("validos");
        if (cobrancas.length === 0)
            await pushSearch("abertos");
    }
    const seen = new Set();
    const unique = cobrancas.filter((c) => {
        const id = String(c.id_recebimento_recb || "");
        if (!id || seen.has(id))
            return false;
        seen.add(id);
        return true;
    });
    const items = unique.map((c) => {
        var _a;
        const raw = String(c.dt_vencimento_recb || "").split(" ")[0];
        let ddmmyyyy = raw;
        if (raw.includes("-")) {
            const [y, m, d] = raw.split("-");
            ddmmyyyy = `${d}/${m}/${y}`;
        }
        else if (raw.includes("/")) {
            const p = raw.split("/");
            if (p[2] && p[2].length === 4)
                ddmmyyyy = `${p[1]}/${p[0]}/${p[2]}`;
        }
        const valor = c.vl_total_recb ? Number(c.vl_total_recb) : 0;
        return {
            id: String(c.id_recebimento_recb || ""),
            vencimento: ddmmyyyy,
            valor,
            unidade: String(c.unitLabel || ""),
            status: String((_a = c.fl_status_recb) !== null && _a !== void 0 ? _a : ""),
        };
    });
    const out = { count: items.length, items };
    console.log(JSON.stringify(out, null, 2));
    process.exit(items.length > 0 ? 0 : 2);
}
run().catch((e) => {
    console.error(String(e && e.message) || String(e));
    process.exit(1);
});
//# sourceMappingURL=searchBoletosCli.js.map