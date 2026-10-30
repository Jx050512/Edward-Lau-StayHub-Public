#!/usr/bin/env node
/* ONLY for an existing administrator in the LOCAL Netlify database.
 * Use: netlify dev:exec node scripts/reset-admin-password.mjs
 * No passwords or tokens are accepted as CLI args and no password is logged.
 */
import pg from 'pg';
import { getConnectionString } from '@netlify/database';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {localDatabaseOnly,strongAdminPassword,resetLocalAdminPassword} from '../netlify/functions/admin-password.mjs';

function hiddenPrompt(label){
 return new Promise((resolvePrompt,reject)=>{
  const tty=process.stdin;
  if(!tty.isTTY||typeof tty.setRawMode!=='function')return reject(new Error('An interactive Terminal is required. Do not pass passwords as command arguments.'));
  process.stdout.write(label);let chars='';tty.setRawMode(true);tty.resume();tty.setEncoding('utf8');
  const restore=()=>{tty.removeListener('data',onData);tty.setRawMode(false);tty.pause();};
  function onData(chunk){for(const ch of chunk){
   if(ch==='\u0003'){restore();process.stdout.write('\n');reject(new Error('Cancelled.'));return;}
   if(ch==='\r'||ch==='\n'){restore();process.stdout.write('\n');resolvePrompt(chars);return;}
   if(ch==='\u007f'||ch==='\b'){if(chars.length){chars=chars.slice(0,-1);process.stdout.write('\b \b');}continue;}
   if(ch==='\u001b')continue;
   if(ch>=' '&&!/[\r\n]/.test(ch)&&chars.length<128){chars+=ch;process.stdout.write('•');}
  }}
  tty.on('data',onData);
 });
}

export async function resetMain(){
 // Deny resets from production, preview or non-local connection strings.
 const conn=process.env.NETLIFY_DB_URL||getConnectionString();
 if(!localDatabaseOnly(process.env.CONTEXT,conn))throw new Error('Local-only reset refused: require Netlify dev context AND localhost PostgreSQL.');
 const email=String(process.env.STAYHUB_ADMIN_EMAIL||'').trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('STAYHUB_ADMIN_EMAIL is not configured.');
 if(!process.stdin.isTTY)throw new Error('Run in an interactive VS Code / PowerShell Terminal.');
 console.log('StayHub LOCAL administrator password reset. No guest or booking data will be touched.');
 console.log('A successful reset signs out all administrator sessions.');
 const confirmation=await hiddenPrompt('Type RESET-LOCAL to continue: ');
 if(confirmation!=='RESET-LOCAL')throw new Error('Cancelled.');
 const newPassword=await hiddenPrompt('New admin password (hidden, 12+ chars): ');
 const repeat=await hiddenPrompt('Confirm new password (hidden): ');
 if(!strongAdminPassword(newPassword)||newPassword!==repeat)throw new Error('Password mismatch or weak password. Nothing changed.');
 const pool=new pg.Pool({connectionString:conn,max:1,connectionTimeoutMillis:12000});
 let client;
 try{client=await pool.connect();await resetLocalAdminPassword(client,email,newPassword);console.log('Success: local administrator password updated. Sign in again with MFA.');}
 finally{client?.release();await pool.end();}
}
const own=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(own)resetMain().catch(err=>{console.error('Reset failed:',err.message);process.exitCode=1;});
