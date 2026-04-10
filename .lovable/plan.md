

## Plano: Gravar tokens Z-API do Campos Altos no Firestore via Edge Function

O `setupZapiConfig` criado nas Cloud Functions precisa de deploy via GitHub Actions, o que não é imediato. A alternativa é criar uma Edge Function no Supabase que grava diretamente no Firestore usando a secret `FIREBASE_SERVICE_ACCOUNT_KEY` já configurada.

### O que será feito

1. **Criar Edge Function `setup-zapi-config`** em `supabase/functions/setup-zapi-config/index.ts`
   - Inicializa Firebase Admin com a secret existente (`FIREBASE_SERVICE_ACCOUNT_KEY`) usando REST mode
   - Grava o documento `zapi_config/AyGEjmRvU1bQiKQruiiE` com:
     - `instanceId: "3ECD22ED86FE925D5A7772442EF70706"`
     - `instanceToken: "9D350B8542F495AC919995C1"`
     - `clientToken: "Ff94d05bcd8b546afb957fc52d8e33ebaS"`
     - `apiUrl: "https://api.z-api.io"`
     - `tenantId: "AyGEjmRvU1bQiKQruiiE"`
     - `ownerId: "AyGEjmRvU1bQiKQruiiE"`

2. **Deploy e executar** a Edge Function imediatamente para persistir os dados

3. **Verificar** chamando a função e confirmando o resultado

### Resultado
Após execução, o webhook `zapiWebhook` conseguirá resolver a instância `3ECD22ED86FE925D5A7772442EF70706` para o tenant Campos Altos, e as mensagens WhatsApp serão roteadas corretamente.

### Arquivos criados
- `supabase/functions/setup-zapi-config/index.ts`

