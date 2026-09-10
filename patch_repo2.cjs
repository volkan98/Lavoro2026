const fs = require('fs');
let code = fs.readFileSync('src/lib/cvRepository.ts', 'utf8');

code = code.replace(/new Promise<never>\(\(_, reject\) => setTimeout\(\(\) => reject\(new Error\('Firestore timeout'\)\), 8000\)\)/g, 
"new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 1500))");

code = code.replace(/new Promise<never>\(\(_, reject\) => setTimeout\(\(\) => reject\(new Error\('Firestore timeout'\)\), 6000\)\)/g, 
"new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 1500))");

code = code.replace(/new Promise<never>\(\(_, reject\) => setTimeout\(\(\) => reject\(new Error\('Firestore timeout'\)\), 5000\)\)/g, 
"new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 1500))");

fs.writeFileSync('src/lib/cvRepository.ts', code, 'utf8');
