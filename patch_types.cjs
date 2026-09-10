const fs = require('fs');

// Fix 1: ManualAddModal.tsx
let modal = fs.readFileSync('src/components/email/ManualAddModal.tsx', 'utf8');
if (!modal.includes('import React')) {
  modal = "import React from 'react';\n" + modal;
  fs.writeFileSync('src/components/email/ManualAddModal.tsx', modal, 'utf8');
}

// Fix 2: ai-agent.ts cleanedCount missing
let agent = fs.readFileSync('src/lib/api/ai-agent.ts', 'utf8');
agent = agent.replace(/return \{ success: true, reconciledCount, totalSentFound: messages\.length \};/g, "return { success: true, reconciledCount, totalSentFound: messages.length, cleanedCount: 0 };");
agent = agent.replace(/return \{ success: false, reconciledCount: 0, totalSentFound: 0, error: err \};/g, "return { success: false, reconciledCount: 0, totalSentFound: 0, cleanedCount: 0, error: err };");
fs.writeFileSync('src/lib/api/ai-agent.ts', agent, 'utf8');

