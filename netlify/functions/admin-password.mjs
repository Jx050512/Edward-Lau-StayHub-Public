/* StayHub administrator password security, shared by API and local reset tool. */
import {HttpError,validPassword,passwordVerify,passwordHash} from './core.mjs';

export function strongAdminPassword(value){
 return validPassword(value) && value.length>=12 && value.length<=128;
}
export function localDatabaseOnly(context,connectionString){
 try {
  const url=new URL(connectionString);
  return context==='dev' && ['postgres:','postgresql:'].includes(url.protocol) &&
    ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 } catch {return false;}
}
export async function changeAdminPassword(db,userId,currentPassword,newPassword){
 if(!strongAdminPassword(newPassword))throw new HttpError(400,'New password must be 12–128 characters and include uppercase, lowercase, number and symbol.');
 if(!currentPassword || typeof currentPassword!=='string')throw new HttpError(400,'Enter your current password.');
 await db.query('BEGIN');
 try {
  const result=await db.query("SELECT password_hash FROM users WHERE id=$1 AND role='admin' AND active=TRUE FOR UPDATE",[userId]);
  const row=result.rows[0];
  if(!row)throw new HttpError(403,'Administrator access required.');
  if(!passwordVerify(currentPassword,row.password_hash))throw new HttpError(400,'Current password is incorrect.');
  if(passwordVerify(newPassword,row.password_hash))throw new HttpError(400,'Choose a new password different from the current password.');
  await db.query("UPDATE users SET password_hash=$1 WHERE id=$2 AND role='admin'",[passwordHash(newPassword),userId]);
  await db.query('DELETE FROM sessions WHERE user_id=$1',[userId]);
  await db.query('DELETE FROM login_challenges WHERE user_id=$1',[userId]);
  await db.query('COMMIT');
  return {ok:true,message:'Password changed. Sign in again with the new password.'};
 } catch(error){await db.query('ROLLBACK');throw error;}
}
export async function resetLocalAdminPassword(db,email,newPassword){
 if(!strongAdminPassword(newPassword))throw new HttpError(400,'New password must contain 12–128 characters with uppercase, lowercase, number and symbol.');
 await db.query('BEGIN');
 try {
  const result=await db.query("SELECT id,password_hash FROM users WHERE email=$1 AND role='admin' AND active=TRUE FOR UPDATE",[email]);
  const user=result.rows[0];
  if(!user)throw new HttpError(404,'Configured administrator account does not exist in this local database.');
  if(passwordVerify(newPassword,user.password_hash))throw new HttpError(400,'New password must differ from the old password.');
  await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',[passwordHash(newPassword),user.id]);
  await db.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
  await db.query('DELETE FROM login_challenges WHERE user_id=$1',[user.id]);
  await db.query('COMMIT');
  return {ok:true};
 }catch(error){await db.query('ROLLBACK');throw error;}
}
