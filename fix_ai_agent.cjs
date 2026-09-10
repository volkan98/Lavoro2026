const fs = require('fs');
let agent = fs.readFileSync('src/lib/api/ai-agent.ts', 'utf8');

// The sed/regex in previous step probably missed it because of whitespace
agent = agent.replace("return { success: true, reconciledCount, totalSentFound: messages.length };", "return { success: true, reconciledCount, totalSentFound: messages.length, cleanedCount: 0 };");
agent = agent.replace("return { success: false, reconciledCount: 0, totalSentFound: 0, error: err };", "return { success: false, reconciledCount: 0, totalSentFound: 0, cleanedCount: 0, error: err };");

fs.writeFileSync('src/lib/api/ai-agent.ts', agent, 'utf8');
