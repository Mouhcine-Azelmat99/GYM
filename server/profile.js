import sharp from 'sharp';
import {z} from 'zod';
import {fail,find,verify} from './domain.js';

const profileSchema=z.object({
  name:z.string().trim().min(1).max(120),
  phone:z.string().trim().max(40),
  email:z.string().trim().email().max(254).transform(value=>value.toLowerCase()),
  currentPassword:z.string().max(128).optional(),
}).strict();

export function updateProfile(state,userId,input){
  const data=profileSchema.parse(input),user=find(state.users,userId);
  if(user.role!=='member')fail('Only members can edit this profile.',403);
  const member=find(state.members,user.memberId);
  if(data.email!==user.email){
    if(!data.currentPassword||!verify(data.currentPassword,user.passwordHash))fail('Enter your current password to change your email.',403);
    if(state.users.some(u=>u.id!==user.id&&u.email.toLowerCase()===data.email)||state.members.some(m=>m.id!==member.id&&m.email.toLowerCase()===data.email))fail('This email address is already in use.',409);
  }
  Object.assign(member,{name:data.name,email:data.email,phone:data.phone});
  Object.assign(user,{name:data.name,email:data.email});
  return {ok:true};
}

export async function normalizePhoto(value){
  if(value===null)return null;
  if(typeof value!=='string'||value.length>2800000)fail('Choose a JPEG, PNG, or WebP image up to 2 MB.');
  const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match)fail('Choose a JPEG, PNG, or WebP image.');
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>2*1024*1024)fail('Profile photos must be 2 MB or smaller.');
  try{
    const image=sharp(bytes,{limitInputPixels:16000000,failOn:'warning'});
    const meta=await image.metadata();
    if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)>1)fail('Choose a still JPEG, PNG, or WebP image.');
    const result=await image.rotate().resize(256,256,{fit:'cover'}).flatten({background:'#ffffff'}).jpeg({quality:75}).toBuffer();
    if(result.length>65536)fail('This image is too complex. Choose a simpler photo.');
    return 'data:image/jpeg;base64,'+result.toString('base64');
  }catch(error){if(error.status)throw error;fail('This image could not be read. Choose a valid photo under 16 megapixels.');}
}
