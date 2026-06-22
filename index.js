import { Login, GetSecrets } from './bao.js';
import * as core from '@actions/core';
import fs from 'fs';
import path from 'path';

async function resolveSecretReferences(secrets, domain, token, baseSecretPath) {
  const resolvedSecrets = { ...secrets };
  const cache = {}; // Cache per evitare chiamate ripetute allo stesso path
  const refRegex = /^\${{\s*(.*?)\s*}}$/g; // Cerca i pattern ${{...}}
  const allowedEngine = baseSecretPath.split('/')[0] + '/' + baseSecretPath.split('/')[1] + '/' + baseSecretPath.split('/')[2]; // Es: prog1/data/environment1

  for (const [key, value] of Object.entries(resolvedSecrets)) {
    if (typeof value !== 'string') continue;

    const match = value.match(refRegex);
    
    if (match) {
      const fullMatch = match[0];       // es: ${{prog1/data/db/password}}
      const refString = match[1].trim();// es: prog1/data/db/password

      // Assumiamo che tutto ciò che c'è prima dell'ultimo '/' sia il path, 
      // e la parte finale sia la chiave da estrarre
      const lastSlashIndex = refString.lastIndexOf('/');
      if (lastSlashIndex === -1) {
        core.warning(`⚠️ Formato riferimento non valido (manca la chiave): ${fullMatch}`);
        continue;
      }

      const refPath = refString.substring(0, lastSlashIndex);
      const refKey = refString.substring(lastSlashIndex + 1);

      const requestedEngine = refPath.split('/')[0] + '/' + refPath.split('/')[1] + '/' + refPath.split('/')[2]; // Es: prog1/data/environment1

      if (requestedEngine !== allowedEngine) {
        core.warning(`⚠️ Riferimento '${fullMatch}' ignorato: environment '${requestedEngine}' non corrisponde a quello del secret principale '${allowedEngine}'`);
        continue;
      }

      try {
        if (!cache[refPath]) {
          core.info(`🔍 Risoluzione riferimento, recupero da path: ${refPath}`);
          cache[refPath] = await GetSecrets({ secretPath: refPath, domain, token });
        }

        const refData = cache[refPath];

        // Sostituisce il template con il valore reale
        if (refData && refData[refKey] !== undefined) {
           // Sostituisce solo il blocco iniziale trovato
           resolvedSecrets[key] = value.replace(fullMatch, refData[refKey]);
        } else {
           core.warning(`⚠️ Chiave '${refKey}' non trovata nel path '${refPath}'`);
        }
      } catch (err) {
        core.warning(`❌ Errore nel recupero del riferimento ${fullMatch}: ${err.message}`);
      }
    }
  }

  return resolvedSecrets;
}

async function run() {
  try {
    const baoUrl = core.getInput('baoUrl', { required: true }).replace(/\/$/, '');
    const roleId = core.getInput('roleId', { required: true });
    const secretId = core.getInput('secretId', { required: true });
    const secretPath = core.getInput('secretPath', { required: true });
    let outputFile = core.getInput('outputFile') || 'openbao_secrets.env';

    if (outputFile.startsWith('/')) {
      outputFile = outputFile.substring(1);
    }
    const workspace = process.env.GITHUB_WORKSPACE || '.';
    const fullPath = path.join(workspace, outputFile);
    const dirPath = path.dirname(fullPath);
    fs.mkdirSync(dirPath, { recursive: true });

    core.info('Avvio autenticazione AppRole su OpenBao...');

    const clientToken = await Login({ roleId, secretId, domain: baoUrl });

    core.info(`Autenticazione riuscita. Recupero secret dal path: ${secretPath}`);

    const secrets = await GetSecrets({ secretPath, domain: baoUrl, token: clientToken });

    if (!secrets || Object.keys(secrets).length === 0) {
      core.warning('La chiamata API ha avuto successo, ma non sono stati trovati secret nel path.');
    }

    const finalSecrets = await resolveSecretReferences(secrets, baoUrl, clientToken);

    // 4. Salvataggio su File (in formato .env)
    const fileContent = Object.keys(secrets).map((key) => `${key}=${secrets[key]}`).join("\n") + "\n";
    fs.writeFileSync(fullPath, fileContent, 'utf8');

    core.info(`✅ Secret recuperati e salvati con successo in: ${outputFile}`);

  } catch (error) {
    // In caso di errore, fallisce l'azione restituendo un messaggio chiaro
    core.setFailed(`Errore durante l'esecuzione dell'action: ${error.message}`);
  }
}

run();