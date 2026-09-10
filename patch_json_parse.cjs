const fs = require('fs');

let code = fs.readFileSync('src/lib/workspaceAuth.ts', 'utf8');

// Fix fetchValidGmailToken
const fetchTokenOriginal = `    const response = await apiFetch('/api/oauth/token', { method: 'GET' });
    const res = await response.json();
    if (res.success && res.access_token) {`;

const fetchTokenNew = `    const response = await apiFetch('/api/oauth/token', { method: 'GET' });
    let res: any = {};
    const text = await response.text();
    try { res = JSON.parse(text); } catch (e) { console.error('Non-JSON response from /api/oauth/token:', text.substring(0, 50)); }
    
    if (response.status === 401 && res.error === 'invalid_grant') {
       throw new Error('invalid_grant');
    }

    if (res.success && res.access_token) {`;

code = code.replace(fetchTokenOriginal, fetchTokenNew);

// Fix connectGmailAccount
const exchangeOriginal = `    const exchangeResponse = await apiFetch('/api/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: response.code })
    });
    const res = await exchangeResponse.json();`;

const exchangeNew = `    const exchangeResponse = await apiFetch('/api/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: response.code })
    });
    
    let res: any = {};
    const text = await exchangeResponse.text();
    try { res = JSON.parse(text); } catch (e) { throw new Error('Il server ha risposto con un formato non valido (possibile errore di rete o timeout). Riprova.'); }
    `;

code = code.replace(exchangeOriginal, exchangeNew);

fs.writeFileSync('src/lib/workspaceAuth.ts', code, 'utf8');
