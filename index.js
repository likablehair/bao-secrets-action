import { Login, GetSecrets } from './bao.js';
import * as core from '@actions/core';
import fs from 'fs';
import path from 'path';

async function resolveSecretReferences(secrets, domain, token, baseSecretPath) {
  const resolvedSecrets = { ...secrets };
  const cache = {}; // Cache per evitare chiamate ripetute allo stesso path
  const refRegex = /^\${{\s*(.*?)\s*}}$/; // Cerca i pattern ${{...}}
  const allowedEngine = baseSecretPath.split('/')[0] + '/' + baseSecretPath.split('/')[1] + '/' + baseSecretPath.split('/')[2]; // Es: prog1/data/environment1

  for (const [key, value] of Object.entries(resolvedSecrets)) {
    if (typeof value !== 'string') continue;

    const matchStr = value.match(refRegex);
    
    if (matchStr) {
      const fullMatch = matchStr[0];       // es: ${{prog1/data/db/password}}
      const refString = matchStr[1].trim();// es: prog1/data/db/password

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

async function fetchAndSaveEnvFile({ targetPath, targetFile, baoUrl, clientToken }) {
  const workspace = process.env.GITHUB_WORKSPACE || '.';
  const fullPath = path.join(workspace, targetFile);
  const dirPath = path.dirname(fullPath);
  fs.mkdirSync(dirPath, { recursive: true });

  core.info(`📥 Recupero secret dal path: ${targetPath}`);
  
  try {
    const secrets = await GetSecrets({ secretPath: targetPath, domain: baoUrl, token: clientToken });

    if (!secrets || Object.keys(secrets).length === 0) {
      core.warning(`Nessun secret trovato in: ${targetPath}`);
      return;
    }

    const finalSecrets = await resolveSecretReferences(secrets, baoUrl, clientToken, targetPath);

    const fileContent = Object.keys(finalSecrets).map((key) => `${key}=${finalSecrets[key]}`).join("\n") + "\n";
    fs.writeFileSync(fullPath, fileContent, 'utf8');

    core.info(`✅ Secret salvati con successo in: ${targetFile}`);
  } catch (error) {
    // Se fallisce il get di un secret (es. cartella vuota o permessi), lanciamo warning invece che bloccare l'azione se ci si trova in una sotto-cartella
    core.warning(`Impossibile processare i secret per '${targetPath}': ${error.message}`);
  }
}

async function run() {
  try {
    const baoUrl = core.getInput('baoUrl', { required: true }).replace(/\/$/, '');
    const roleId = core.getInput('roleId', { required: true });
    const secretId = core.getInput('secretId', { required: true });
    const secretPath = core.getInput('secretPath', { required: true });
    const exportSubdirectories = core.getInput('exportSubdirectories') === 'true' || core.getBooleanInput('export-subdirectories') || false;;
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

    await fetchAndSaveEnvFile({
      targetPath: secretPath,
      targetFile: outputFile,
      baoUrl,
      clientToken
    });

    if (exportSubdirectories){
      core.info(`📂 Scansione sotto-cartelle abilitata per il path: ${secretPath}`);
      const keys = await ListSecrets({ secretPath, domain: baoUrl, token: clientToken });

      const subdirectories = keys.filter(key => key.endsWith('/'));

      if (subdirectories.length === 0) {
        core.info('Nessuna sotto-cartella trovata nel path specificato.');
      } else {
        const cleanBasePath = secretPath.replace(/\/$/, ''); // Rimuove lo slash finale dal path base se presente

        for (const subdir of subdirectories) {
          const cleanSubdirName = subdir.slice(0, -1); // Rimuove lo slash finale es: "service1/" -> "service1"
          
          const subSecretPath = `${cleanBasePath}/${cleanSubdirName}`;
          const subOutputFile = `${outputFile}.${cleanSubdirName}`; // es: openbao_secrets.env.service1

          await fetchAndSaveEnvFile({
            targetPath: subSecretPath,
            targetFile: subOutputFile,
            baoUrl,
            clientToken
          });
        }
      }
    }
  } catch (error) {
    // In caso di errore, fallisce l'azione restituendo un messaggio chiaro
    core.setFailed(`Errore durante l'esecuzione dell'action: ${error.message}`);
  }
}

run();