const fs = require('fs');
let code = fs.readFileSync('src/lib/firebase.ts', 'utf8');

code = code.replace(
  /export const db: Firestore = \(\(\) => \{[\s\S]*?\}\)\(\);/,
  "export const db: Firestore = getFirestore(app, databaseId);"
);

fs.writeFileSync('src/lib/firebase.ts', code, 'utf8');
