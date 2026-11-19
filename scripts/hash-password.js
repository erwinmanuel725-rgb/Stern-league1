'use strict';
// Usage : npm run hash-password -- "mon mot de passe"   (ou sans argument : saisie masquée)
const readline = require('readline');
const { hashPassword } = require('../src/auth');

async function ask() {
  if (process.argv[2]) return process.argv[2];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl._writeToOutput = (s) => { if (s.includes('Mot de passe')) rl.output.write(s); };
  return new Promise((res) => rl.question('Mot de passe admin (12 caractères min.) : ', (a) => { rl.close(); console.log(); res(a); }));
}
(async () => {
  const pw = await ask();
  if (!pw || pw.length < 12) { console.error('Trop court : 12 caractères minimum.'); process.exit(1); }
  console.log('\nCopie cette valeur dans la variable Railway ADMIN_PASSWORD_HASH (entre guillemets si ton shell le demande) :\n');
  console.log(await hashPassword(pw));
})();
