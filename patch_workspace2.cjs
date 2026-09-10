const fs = require('fs');

let agent = fs.readFileSync('src/lib/api/ai-agent.ts', 'utf8');
agent = agent.replace(/return \{ success: true, reconciledCount, totalSentFound: messages\.length \};/g, "return { success: true, reconciledCount, totalSentFound: messages.length, cleanedCount: 0 };");
agent = agent.replace(/return \{ success: false, reconciledCount: 0, totalSentFound: 0, error: err \};/g, "return { success: false, reconciledCount: 0, totalSentFound: 0, cleanedCount: 0, error: err };");
fs.writeFileSync('src/lib/api/ai-agent.ts', agent, 'utf8');

let code = fs.readFileSync('src/lib/workspaceAuth.ts', 'utf8');
code = code.replace(/const res = await apiFetch\('\/api\/oauth\/token', \{ method: 'GET' \}\);/g, "const response = await apiFetch('/api/oauth/token', { method: 'GET' }); const res = await response.json();");
code = code.replace(/const res = await apiFetch\('\/api\/oauth\/exchange', \{([\s\S]*?)\}\);/g, "const response = await apiFetch('/api/oauth/exchange', {$1}); const res = await response.json();");

fs.writeFileSync('src/lib/workspaceAuth.ts', code, 'utf8');
