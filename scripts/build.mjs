import {cpSync,mkdirSync,readdirSync} from 'node:fs';

mkdirSync('dist',{recursive:true});
for (const name of readdirSync('.').filter(name => name.endsWith('.html')).concat(['admin','assets'])) {
  cpSync(name,'dist/'+name,{recursive:true});
}
