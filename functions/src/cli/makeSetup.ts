import fetch from "node-fetch";

function arg(name: string, def = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]);
  return def;
}

async function api(zone: string, token: string, path: string, init?: any) {
  const url = `https://${zone}/api/v2${path}`;
  const headers = {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
    Accept: "*/*",
    "User-Agent": "rokazap-make-cli/1.0",
  };
  const resp = await fetch(url, { ...init, headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText} ${body}`);
  }
  return resp.json();
}

async function main() {
  const token = arg("token") || process.env.MAKE_TOKEN || "";
  const zone = arg("zone") || process.env.MAKE_ZONE || "us1.make.com";
  const teamIdArg = arg("teamId");
  const activateArg = arg("activate");
  const scenarioIdArg = arg("scenarioId");
  const onDemandArg = arg("onDemand");
  const addHttpArg = arg("addHttp");
  const urlArg = arg("url");
  const fixJsonParseArg = arg("fixJsonParse");
  const runArg = arg("run");
  const execStatusArg = arg("execStatus");
  const printBlueprintArg = arg("printBlueprint");
  const orderHttpFirstArg = arg("orderHttpFirst");
  const removeJsonParseArg = arg("removeJsonParse");
  const simplifyHttpArg = arg("simplifyHttp");
  if (!token) {
    console.error("Informe --token ou defina MAKE_TOKEN");
    process.exit(1);
  }
  const me = await api(zone, token, "/users/me", { method: "GET" }).catch((e) => {
    throw new Error(`Falha ao autenticar no Make API: ${String(e.message || e)}`);
  });
  console.log(JSON.stringify({ me }, null, 2));

  if (scenarioIdArg && activateArg) {
    const sid = Number(scenarioIdArg);
    if (!Number.isFinite(sid)) {
      console.error("scenarioId inválido");
      process.exit(1);
    }
    const teamIdParam = teamIdArg ? `?teamId=${Number(teamIdArg)}` : "";
    const act = await api(zone, token, `/scenarios/${sid}/start${teamIdParam}`, { method: "POST" });
    console.log(JSON.stringify({ activatedScenario: act }, null, 2));
    return;
  }

  if (scenarioIdArg && onDemandArg) {
    const sid = Number(scenarioIdArg);
    if (!Number.isFinite(sid)) {
      console.error("scenarioId inválido");
      process.exit(1);
    }
    const upd = await api(zone, token, `/scenarios/${sid}?confirmed=true`, {
      method: "PATCH",
      body: JSON.stringify({ scheduling: JSON.stringify({ type: "on-demand" }) }),
    });
    console.log(JSON.stringify({ onDemand: upd?.scenario?.scheduling ?? { type: "on-demand" } }, null, 2));
    return;
  }

  if (scenarioIdArg && addHttpArg) {
    const sid = Number(scenarioIdArg);
    if (!Number.isFinite(sid)) {
      console.error("scenarioId inválido");
      process.exit(1);
    }
    if (!urlArg) {
      console.error("Informe --url para adicionar módulo HTTP");
      process.exit(1);
    }
    const bp = await api(zone, token, `/scenarios/${sid}/blueprint`, { method: "GET" });
    const blueprint = bp?.response?.blueprint || bp?.blueprint;
    if (!blueprint || !Array.isArray(blueprint.flow)) {
      throw new Error("Blueprint inválido");
    }
    const nextId = Math.max(0, ...blueprint.flow.map((m: any) => Number(m.id) || 0)) + 1;
    const httpModule = {
      id: nextId,
      module: "http:ActionSendData",
      version: 3,
      parameters: { handleErrors: false },
      mapper: {
        ca: "",
        qs: [],
        url: urlArg,
        gzip: true,
        method: "get",
        headers: [],
        timeout: "",
        authPass: "",
        authUser: "",
        bodyType: "",
        shareCookies: false,
        parseResponse: false,
        followRedirect: true,
        useQuerystring: false,
        rejectUnauthorized: true
      },
      metadata: { designer: { x: 140, y: 60, messages: [] } },
    };
    blueprint.flow.push(httpModule);
    const body = { blueprint: JSON.stringify(blueprint) };
    const upd = await api(zone, token, `/scenarios/${sid}?confirmed=true`, { method: "PATCH", body: JSON.stringify(body) });
    console.log(JSON.stringify({ updated: true, usedPackages: upd?.scenario?.usedPackages || [], id: sid }, null, 2));
    return;
  }

  if (scenarioIdArg && fixJsonParseArg) {
    const sid = Number(scenarioIdArg);
    if (!Number.isFinite(sid)) {
      console.error("scenarioId inválido");
      process.exit(1);
    }
    const bp = await api(zone, token, `/scenarios/${sid}/blueprint`, { method: "GET" });
    const blueprint = bp?.response?.blueprint || bp?.blueprint;
    if (!blueprint || !Array.isArray(blueprint.flow)) {
      throw new Error("Blueprint inválido");
    }
    const http = blueprint.flow.find((m: any) => m.module === "http:ActionSendData");
    const httpId = http?.id;
    if (!httpId) {
      console.error("Módulo HTTP não encontrado no cenário.");
      process.exit(1);
    }
    const jsonMods = blueprint.flow.filter((m: any) => m.module === "json:ParseJSON");
    if (jsonMods.length === 0) {
      console.error("Módulo JSON > Parse JSON não encontrado para ajustar.");
      process.exit(1);
    }
    for (const jm of jsonMods) {
      jm.parameters = jm.parameters || {};
      jm.mapper = jm.mapper || {};
      // Mapear o campo obrigatório 'json' a partir do corpo do HTTP
      // Em Make blueprints, uso de referência simples ao bundle anterior:
      // '{{<id>.body}}' quando parseResponse=false.
      if (!jm.mapper.json) {
        jm.mapper.json = `{{${httpId}.body}}`;
      }
    }
    const body = { blueprint: JSON.stringify(blueprint) };
    await api(zone, token, `/scenarios/${sid}?confirmed=true`, { method: "PATCH", body: JSON.stringify(body) });
    console.log(JSON.stringify({ fixed: true, id: sid, adjusted: jsonMods.map((m: any) => m.id) }, null, 2));
    return;
  }

  if (scenarioIdArg && runArg) {
    const sid = Number(scenarioIdArg);
    if (!Number.isFinite(sid)) {
      console.error("scenarioId inválido");
      process.exit(1);
    }
    const runRes = await api(zone, token, `/scenarios/${sid}/run?wait=true`, { method: "POST", body: JSON.stringify({}) });
    console.log(JSON.stringify({ run: "started", id: sid, response: runRes }, null, 2));
    return;
  }

  if (scenarioIdArg && execStatusArg) {
    const sid = Number(scenarioIdArg);
    if (!Number.isFinite(sid)) {
      console.error("scenarioId inválido");
      process.exit(1);
    }
    const eid = String(execStatusArg);
    const st = await api(zone, token, `/scenarios/${sid}/executions/${encodeURIComponent(eid)}`, { method: "GET" });
    console.log(JSON.stringify({ id: sid, executionId: eid, status: st }, null, 2));
    return;
  }

  if (scenarioIdArg && printBlueprintArg) {
    const sid = Number(scenarioIdArg);
    if (!Number.isFinite(sid)) {
      console.error("scenarioId inválido");
      process.exit(1);
    }
    const bp = await api(zone, token, `/scenarios/${sid}/blueprint`, { method: "GET" });
    console.log(JSON.stringify(bp, null, 2));
    return;
  }

  if (scenarioIdArg && orderHttpFirstArg) {
    const sid = Number(scenarioIdArg);
    if (!Number.isFinite(sid)) {
      console.error("scenarioId inválido");
      process.exit(1);
    }
    const bp = await api(zone, token, `/scenarios/${sid}/blueprint`, { method: "GET" });
    const blueprint = bp?.response?.blueprint || bp?.blueprint;
    if (!blueprint || !Array.isArray(blueprint.flow)) {
      throw new Error("Blueprint inválido");
    }
    const httpMods = blueprint.flow.filter((m: any) => m.module && String(m.module).startsWith("http:"));
    const others = blueprint.flow.filter((m: any) => !(m.module && String(m.module).startsWith("http:")));
    // Reordenar: HTTP primeiro, demais depois (mantendo ordem relativa)
    blueprint.flow = [...httpMods, ...others];
    const body = { blueprint: JSON.stringify(blueprint) };
    await api(zone, token, `/scenarios/${sid}?confirmed=true`, { method: "PATCH", body: JSON.stringify(body) });
    console.log(JSON.stringify({ reordered: true, id: sid, order: blueprint.flow.map((m: any) => `${m.id}:${m.module}`) }, null, 2));
    return;
  }

  if (scenarioIdArg && removeJsonParseArg) {
    const sid = Number(scenarioIdArg);
    if (!Number.isFinite(sid)) {
      console.error("scenarioId inválido");
      process.exit(1);
    }
    const bp = await api(zone, token, `/scenarios/${sid}/blueprint`, { method: "GET" });
    const blueprint = bp?.response?.blueprint || bp?.blueprint;
    if (!blueprint || !Array.isArray(blueprint.flow)) {
      throw new Error("Blueprint inválido");
    }
    const before = blueprint.flow.length;
    blueprint.flow = blueprint.flow.filter((m: any) => m.module !== "json:ParseJSON");
    // Garantir que o módulo HTTP parseie resposta automaticamente
    for (const m of blueprint.flow) {
      if (m.module === "http:ActionSendData") {
        m.mapper = m.mapper || {};
        m.mapper.parseResponse = true;
      }
    }
    const body = { blueprint: JSON.stringify(blueprint) };
    await api(zone, token, `/scenarios/${sid}?confirmed=true`, { method: "PATCH", body: JSON.stringify(body) });
    const after = blueprint.flow.length;
    console.log(JSON.stringify({ removed: before - after, id: sid, remaining: after }, null, 2));
    return;
  }

  if (scenarioIdArg && simplifyHttpArg) {
    const sid = Number(scenarioIdArg);
    if (!Number.isFinite(sid)) {
      console.error("scenarioId inválido");
      process.exit(1);
    }
    const bp = await api(zone, token, `/scenarios/${sid}/blueprint`, { method: "GET" });
    const blueprint = bp?.response?.blueprint || bp?.blueprint;
    if (!blueprint || !Array.isArray(blueprint.flow)) {
      throw new Error("Blueprint inválido");
    }
    for (const m of blueprint.flow) {
      if (m.module === "http:ActionSendData") {
        m.mapper = {
          url: m?.mapper?.url || "",
          method: "get",
          gzip: true,
          parseResponse: true,
          followRedirect: true,
          useQuerystring: false,
          rejectUnauthorized: true,
        };
        m.parameters = { handleErrors: false };
      }
    }
    const body = { blueprint: JSON.stringify(blueprint) };
    await api(zone, token, `/scenarios/${sid}?confirmed=true`, { method: "PATCH", body: JSON.stringify(body) });
    console.log(JSON.stringify({ simplified: true, id: sid }, null, 2));
    return;
  }

  if (teamIdArg) {
    const teamId = Number(teamIdArg);
    if (!Number.isFinite(teamId)) {
      console.error("teamId inválido");
      process.exit(1);
    }
    const blueprintObj = {
      name: "Consulta Boletos por CPF (HTTP)",
      flow: [
        {
          id: 2,
          module: "json:ParseJSON",
          version: 1,
          metadata: { designer: { x: -46, y: 47, messages: [] } },
        },
      ],
      metadata: {
        version: 1,
        scenario: { roundtrips: 1, maxErrors: 3, autoCommit: true, autoCommitTriggerLast: true, sequential: false, confidential: false, dataloss: false, dlq: false, freshVariables: false },
        designer: { orphans: [] },
      },
    };
    const schedulingObj = { type: "indefinitely", interval: 900 };
    const body = {
      blueprint: JSON.stringify(blueprintObj),
      teamId,
      scheduling: JSON.stringify(schedulingObj),
    };
    const created = await api(zone, token, "/scenarios", { method: "POST", body: JSON.stringify(body) });
    const scenarioId = created?.scenario?.id || created?.response?.scenario?.id || created?.id;
    console.log(JSON.stringify({ zone, teamId, scenarioId, created }, null, 2));
    if (activateArg && scenarioId) {
      const act = await api(zone, token, `/scenarios/${scenarioId}/start`, { method: "POST" });
      console.log(JSON.stringify({ activatedScenario: act }, null, 2));
    }
    return;
  }
  // Try to list organizations with different query hints to avoid false 403s
  let orgs;
  try {
    orgs = await api(zone, token, "/organizations?cols[]=id&cols[]=name&pg[limit]=100", { method: "GET" });
  } catch (e) {
    orgs = await api(zone, token, "/organizations?zone=" + encodeURIComponent(zone), { method: "GET" });
  }
  console.log(JSON.stringify({ organizationsRaw: orgs }, null, 2));
  const organizations: any[] = (orgs && (orgs.organizations || orgs.response?.organizations)) ? (orgs.organizations || orgs.response.organizations) : (Array.isArray(orgs) ? orgs : []);
  if (!organizations.length) throw new Error("Nenhuma organização encontrada");
  const preferredOrg = organizations.find((o: any) => String(o.name || "").toLowerCase().includes("agenteiros")) || organizations[0];
  const organizationId = Number(preferredOrg.id || preferredOrg.organizationId || preferredOrg.organization?.id);
  // Attempt to get teamId via scenarios listing by organization
  let teams: any[] = [];
  try {
    const scResp = await api(zone, token, `/scenarios?organizationId=${organizationId}&pg[limit]=100`, { method: "GET" });
    console.log(JSON.stringify({ scenariosPeek: scResp?.scenarios?.slice?.(0, 3) || scResp?.scenarios || scResp }, null, 2));
    if (Array.isArray(scResp?.scenarios) && scResp.scenarios.length > 0) {
      const teamIds = Array.from(new Set(scResp.scenarios.map((s: any) => s.teamId).filter(Boolean)));
      teams = teamIds.map((id: any) => ({ id }));
    }
  } catch (e) {
    console.log("Scenarios list by organization failed, will create/list teams directly");
  }
  if (teams.length === 0) {
    // Fallback: create a dedicated team if listing is restricted
    const teamName = "Rokazap";
    try {
      const createdTeam = await api(zone, token, `/teams`, {
        method: "POST",
        body: JSON.stringify({ name: teamName, organizationId }),
      });
      console.log(JSON.stringify({ createdTeam }, null, 2));
      teams = [{ id: createdTeam?.team?.id || createdTeam?.id }];
    } catch (e) {
      console.log("Create team error:", (e as any)?.message || String(e));
      // As a last resort, attempt teams listing
      let teamsResp;
      try {
        const teamsPath = `/teams?organizationId=${organizationId}&pg[limit]=100`;
        console.log(JSON.stringify({ teamsCall: teamsPath }, null, 2));
        teamsResp = await api(zone, token, teamsPath, { method: "GET" });
      } catch (e2) {
        console.log("Teams call with organizationId failed, retrying without organizationId");
        teamsResp = await api(zone, token, `/teams`, { method: "GET" });
      }
      teams = teamsResp?.teams || teamsResp?.response?.teams || teamsResp || [];
    }
  }
  if (!teams.length) throw new Error("Nenhum time encontrado");
  const teamId = Number(teams[0].id || teams[0].teamId);
  const blueprintObj = {
    name: "Consulta Boletos por CPF (HTTP)",
    flow: [
      {
        id: 2,
        module: "json:ParseJSON",
        version: 1,
        metadata: { designer: { x: -46, y: 47, messages: [] } },
      },
    ],
    metadata: {
      version: 1,
      scenario: { roundtrips: 1, maxErrors: 3, autoCommit: true, autoCommitTriggerLast: true, sequential: false, confidential: false, dataloss: false, dlq: false, freshVariables: false },
      designer: { orphans: [] },
    },
  };
  const schedulingObj = { type: "indefinitely", interval: 900 };
  const body = {
    blueprint: JSON.stringify(blueprintObj),
    teamId,
    scheduling: JSON.stringify(schedulingObj),
  };
  const created = await api(zone, token, "/scenarios", { method: "POST", body: JSON.stringify(body) });
  const scenarioId = created?.scenario?.id || created?.response?.scenario?.id || created?.id;
  console.log(JSON.stringify({ zone, organizationId, teamId, scenarioId, created }, null, 2));
}

main().catch((e) => {
  console.error(String(e && e.message) || String(e));
  process.exit(1);
});
