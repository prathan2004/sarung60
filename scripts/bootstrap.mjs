import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {hashPassword} from '../netlify/functions/api.mjs';

if (!process.stdin.isTTY) throw Error('Run this command in an interactive terminal.');
let hide = false;
const output = new Writable({write(chunk,encoding,done) {
  if (!hide) process.stdout.write(chunk);
  done();
}});
const prompt = createInterface({input:process.stdin,output,terminal:true,historySize:0});
try {
  const username = (await prompt.question('Admin username: ')).trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) throw Error('Invalid username');
  process.stdout.write('Admin password (hidden): ');
  hide = true;
  const password = await prompt.question('');
  hide = false;
  process.stdout.write('\n');
  if ([...password].length < 12 || Buffer.byteLength(password) > 256) throw Error('Invalid password length');
  const key = () => randomBytes(32).toString('hex');
  const pepper = key();
  console.log('PROXY_SECRET=' + key());
  console.log('PASSWORD_PEPPER=' + pepper);
  console.log('SESSION_SECRET=' + key());
  console.log('BOOTSTRAP_USERNAME=' + username);
  console.log('BOOTSTRAP_HASH=' + await hashPassword(password,pepper));
} finally { prompt.close(); }
