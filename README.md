# OpenBao Secret Fetcher

Un'azione GitHub per autenticarsi su OpenBao (o HashiCorp Vault) tramite **AppRole**, recuperare in modo sicuro i secret da un path specifico e salvarli direttamente in un file locale (in formato `.env`), pronto per essere utilizzato nei tuoi workflow o iniettato nei tuoi container.

---

## 🌟 Funzionalità Principali

* **Autenticazione AppRole**: Sfrutta il metodo `role_id` e `secret_id` nativo di OpenBao per un accesso sicuro non interattivo.
* **Supporto KVv1 e KVv2**: L'azione gestisce autonomamente la struttura dei dati di ritorno, estraendo i secret in modo trasparente.
* **Esportazione .env**: Genera automaticamente un file chiave-valore perfetto per essere passato a Docker/Docker Compose.
* **Risoluzione Dinamica dei Riferimenti**: Permette di comporre secret che puntano ad altri secret (es. `${{prog1/data/db/password}}`), risolvendoli automaticamente prima del salvataggio.

---

## 🚀 Esempio di Utilizzo

Aggiungi questo step al tuo file workflow `.yml` (es. `.github/workflows/deploy.yml`):

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Recupera Secret da OpenBao
        uses: tuo-utente/nome-repo-action@v1 # <- Sostituisci con il tuo percorso
        with:
          baoUrl: '[https://bao.tuodominio.com](https://bao.tuodominio.com)'
          roleId: ${{ secrets.BAO_ROLE_ID }}
          secretId: ${{ secrets.BAO_SECRET_ID }}
          secretPath: 'prog1/data/my-app/config'
          outputFile: '.env' # Opzionale, default: openbao_secrets.env
```

## Input dell'Action

| Nome Input | Descrizione                                                        | Obbligatorio | Default             |
|------------|--------------------------------------------------------------------|--------------|---------------------|
| baoUrl     | L'URL base della tua istanza OpenBao (es. https://vault.mio-dominio.com).  | Sì           |                     |
| roleId     | Il Role ID generato dal metodo di auth AppRole.                    | Sì           |                     |
| secretId   | Il Secret ID generato dal metodo di auth AppRole.                  | Sì           |                     |
| secretPath | Il percorso interno da cui leggere i secret (es. secret/data/app). | Sì           |                     |
| outputFile | Il nome e percorso del file su cui scrivere i risultati esportati. | No           | openbao_secrets.env |
