

export const Login = async ({ roleId, secretId, domain}) => {
    const loginRes = await fetch(`${domain}/v1/auth/approle/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_id: roleId, secret_id: secretId })
    });

    if (!loginRes.ok) {
      const errText = await loginRes.text();
      throw new Error(`Autenticazione fallita (${loginRes.status}): ${errText}`);
    }
    const loginData = await loginRes.json();

    return loginData.auth.client_token;
}

export const GetSecrets = async ({ secretPath, domain, token }) => {
    const secretRes = await fetch(`${domain}/v1/${secretPath}`, {
      method: 'GET',
      headers: { 'X-Vault-Token': token }
    });

    if (!secretRes.ok) {
      const errText = await secretRes.text();
      throw new Error(`Recupero secret fallito (${secretRes.status}): ${errText}`);
    }

    const secretData = await secretRes.json();

    // Gestione dinamica KVv2 vs KVv1:
    // Nel Secret Engine KVv2 di Vault/Bao, i dati reali sono sotto .data.data
    // Nel KVv1 sono semplicemente sotto .data
    return secretData.data.data || secretData.data;
}