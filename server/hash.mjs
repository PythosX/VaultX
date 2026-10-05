import {scryptSync,randomBytes} from 'crypto';
const pw=process.argv[2]; if(!pw){console.log('usage: npm run hash -- "password"');process.exit(1)}
const s=randomBytes(16).toString('hex');console.log(`ADMIN_PASSWORD_HASH=${s}:${scryptSync(pw,s,64).toString('hex')}`);
