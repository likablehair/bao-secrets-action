# OpenBao Secret Fetcher

A Gitea / GitHub Action that authenticates to **OpenBao** (or HashiCorp Vault) via **AppRole**, reads the secrets at a given path and writes them to a `.env` file, ready to be passed to Docker, Docker Compose or later steps of your workflow.

## Contents

- [Features](#features)
- [Usage](#usage)
- [Inputs](#inputs)
- [Secret references](#secret-references)
- [Exporting subdirectories](#exporting-subdirectories)
- [OpenBao setup](#openbao-setup)
- [Error handling](#error-handling)
- [Security notes](#security-notes)
- [Development](#development)

---

## Features

- **AppRole authentication**: non-interactive login with `role_id` and `secret_id`.
- **KV v1 and KV v2**: the response format is detected automatically.
- **`.env` export**: each secret becomes a `KEY=value` line.
- **Secret references**: a value can point to another secret (e.g. `${{ prog1/data/env1/db/password }}`), which is resolved before the file is written.
- **Subdirectories**: optionally exports the child secrets of the given path to separate files.

---

## Usage

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Fetch secrets from OpenBao
        uses: https://gitea.likablehair.it/Likablehair/bao-secrets-action@v1.0.2
        with:
          baoUrl: https://bao.example.com
          roleId: ${{ secrets.BAO_ROLE_ID }}
          secretId: ${{ secrets.BAO_SECRET_ID }}
          secretPath: prog1/data/production/my-app
          outputFile: .env

      - name: Start containers
        run: docker compose --env-file .env up -d
```

> If your Gitea instance has `DEFAULT_ACTIONS_URL = self`, you can use the short form `uses: Likablehair/bao-secrets-action@v1.0.2`.

The resulting file looks like this:

```env
DB_HOST=db.internal
DB_USER=app
DB_PASSWORD=s3cr3t
```

---

## Inputs

| Name                    | Description                                                                                            | Required | Default               |
|-------------------------|--------------------------------------------------------------------------------------------------------|----------|-----------------------|
| `baoUrl`                | Base URL of the OpenBao instance (e.g. `https://bao.example.com`). A trailing slash is removed.         | Yes      |                       |
| `roleId`                | AppRole Role ID.                                                                                       | Yes      |                       |
| `secretId`              | AppRole Secret ID.                                                                                     | Yes      |                       |
| `secretPath`            | API path of the secret, without `/v1/`. For KV v2 include `data/` (e.g. `prog1/data/production/my-app`). | Yes      |                       |
| `outputFile`            | Output file path, relative to the workspace. Missing directories are created.                          | No       | `openbao_secrets.env` |
| `export-subdirectories` | If `true`, also exports the child secrets of `secretPath` to `<outputFile>.<name>` files.              | No       | `false`               |

The action has no outputs: the result is the file written to disk.

---

## Secret references

A secret value stored in OpenBao can reference a key of another secret:

```
${{ <secret-path>/<key> }}
```

Everything before the last `/` is the path; the last segment is the key to read.

**Example**: secret `prog1/data/production/my-app`

| Key           | Value in OpenBao                                |
|---------------|-------------------------------------------------|
| `DB_HOST`     | `db.internal`                                   |
| `DB_PASSWORD` | `${{ prog1/data/production/db/password }}`      |

In the `.env` file, `DB_PASSWORD` will contain the value of `password` read from `prog1/data/production/db`.

Rules:

- The reference must be the **entire value**: `postgres://${{ ... }}@host` is not resolved.
- The reference must be in the **same environment** as the main secret, i.e. share its first three path segments (e.g. `prog1/data/production`). Otherwise it is skipped with a warning. This prevents a production secret from reading, for example, from `staging`.
- Resolution is **not recursive**: if the referenced value is itself a reference, it is written as is.
- If the path or key does not exist, a warning is logged and the original value is kept.

---

## Exporting subdirectories

With `export-subdirectories: true`, after the main secret the action lists the keys under `secretPath` (a `LIST` request; for KV v2 the path is converted from `data/` to `metadata/`) and writes each one to its own file:

```yaml
      - uses: https://gitea.likablehair.it/Likablehair/bao-secrets-action@v1.0.2
        with:
          baoUrl: https://bao.example.com
          roleId: ${{ secrets.BAO_ROLE_ID }}
          secretId: ${{ secrets.BAO_SECRET_ID }}
          secretPath: prog1/data/production
          outputFile: env/.env
          export-subdirectories: true
```

With this structure in OpenBao:

```
prog1/production
├── (main secret)
├── backend
└── frontend
```

the action generates:

```
env/.env
env/.env.backend
env/.env.frontend
```

Only the first level is explored. Secret references also work in the subdirectory files.

---

## OpenBao setup

Example of a minimal policy for the AppRole used by the action (KV v2 mounted at `prog1/`):

```hcl
# Read secrets
path "prog1/data/production/*" {
  capabilities = ["read"]
}

# Only needed with export-subdirectories: true
path "prog1/metadata/production/*" {
  capabilities = ["list"]
}
```

Create the AppRole and get its credentials:

```sh
bao auth enable approle
bao policy write my-app-ci policy.hcl
bao write auth/approle/role/my-app-ci token_policies="my-app-ci" token_ttl=10m

bao read  auth/approle/role/my-app-ci/role-id
bao write -f auth/approle/role/my-app-ci/secret-id
```

Store `role_id` and `secret_id` as repository secrets (`BAO_ROLE_ID`, `BAO_SECRET_ID`).

---

## Error handling

| Situation                                           | Outcome                                     |
|-----------------------------------------------------|---------------------------------------------|
| AppRole login fails                                 | The step **fails**                          |
| Main secret unreadable or empty                     | Warning, no file written, the step passes   |
| Subdirectory unreadable                             | Warning, the remaining ones are processed   |
| Reference invalid, not found or outside environment | Warning, value left unchanged               |

Since a missing secret does not stop the workflow, check that the file exists in later steps if you depend on it.

---

## Security notes

- The `.env` file holds the secrets **in plain text** on the runner. Don't include it in artifacts, caches or Docker images, and delete it at the end of the job if the runner is not ephemeral:

  ```yaml
        - name: Cleanup
          if: always()
          run: rm -f .env .env.*
  ```

- Values are written without quoting or escaping: multi-line secrets or secrets with special characters may not be parsed correctly by every `.env` parser.
- Use AppRoles with policies scoped to the single environment you need and short token TTLs.

---

## Development

The action runs on `node20` and uses the native `fetch`; its only dependency is `@actions/core`. `node_modules` is committed because JavaScript actions run without `npm install`.

```
action.yml   # inputs and runtime definition
index.js     # entrypoint: login, read, reference resolution, file write
bao.js       # HTTP client for OpenBao (login, read, list)
```

To release a new version, create a tag (`git tag v1.0.3 && git push --tags`) and update the `@vX.Y.Z` reference in your workflows.
