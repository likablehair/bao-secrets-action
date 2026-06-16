import { Login, GetSecrets } from './bao.js';
import * as core from '@actions/core';
import fs from 'fs';

async function run() {
  try {
    const baoUrl = core.getInput('bao_url', { required: true }).replace(/\/$/, '');
    const roleId = core.getInput('role_id', { required: true });
    const secretId = core.getInput('secret_id', { required: true });
    const secretPath = core.getInput('secret_path', { required: true });
    const outputFile = core.getInput('output_file') || 'openbao_secrets.env';

    core.info('Avvio autenticazione AppRole su OpenBao...');

    const clientToken = await Login({ roleId, secretId, domain: baoUrl });

    core.info(`Autenticazione riuscita. Recupero secret dal path: ${secretPath}`);

    const secret = await GetSecrets({ secretPath, domain: baoUrl, token: clientToken });

    if (!secrets || Object.keys(secrets).length === 0) {
      core.warning('La chiamata API ha avuto successo, ma non sono stati trovati secret nel path.');
    }

    // 4. Salvataggio su File (in formato .env)
    const fileContent = Object.keys(secrets).map((key) => `${key}=${secrets[key]}`).join("\n");
    fs.writeFileSync(outputFile, envContent, 'utf8');

    core.info(`✅ Secret recuperati e salvati con successo in: ${outputFile}`);

  } catch (error) {
    // In caso di errore, fallisce l'azione restituendo un messaggio chiaro
    core.setFailed(`Errore durante l'esecuzione dell'action: ${error.message}`);
  }
}

run();