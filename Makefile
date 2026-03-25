.PHONY: boletos help
boletos:
	powershell -NoProfile -ExecutionPolicy Bypass -Command "cd functions; npm run build --silent; node lib/cli/searchBoletosCli.js --tenant '$(TENANT)' --condo '$(CONDO)' --cpf '$(CPF)' --status '$(STATUS)' --dtInicio '$(DTINICIO)' --dtFim '$(DTFIM)' --appToken '$(APP_TOKEN)' --accessToken '$(ACCESS_TOKEN)'"
help:
	powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Output 'Usage:'; Write-Output 'make boletos TENANT=<tenantId> CONDO=<idOrName> CPF=<cpf> [STATUS=pendentes] [DTINICIO=01/01/1900] [DTFIM=31/12/2099] [APP_TOKEN=...] [ACCESS_TOKEN=...]'"
