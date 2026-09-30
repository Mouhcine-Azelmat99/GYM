import mongoose from 'mongoose';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {seed} from './seed.js';

// A single gym aggregate makes capacity, credits and payment activation atomic.
// Optimistic concurrency retries prevent lost updates across server processes.
const record = new mongoose.Schema({id:{type:String,required:true}}, {_id:false,strict:false});
const schema = new mongoose.Schema({_id:String,settings:{type:mongoose.Schema.Types.Mixed,required:true},...Object.fromEntries(['plans','members','memberships','payments','schedule','bookings','attendance','users','notifications'].map(k=>[k,[record]]))},{optimisticConcurrency:true});
const Workspace=mongoose.model('Workspace',schema);
export async function createStore({demo=true,file='data/demo.json',memory=false}={}) {
  let state;
  if (!demo) {
    await mongoose.connect(process.env.MONGODB_URI);
    await Workspace.updateOne({_id:'gym'},{$setOnInsert:seed(false)},{upsert:true});
  } else {
    try {state=memory?seed():JSON.parse(await readFile(file,'utf8'));} catch(e) {if(e.code!=='ENOENT')throw e;state=seed();}
  }
  let queue=Promise.resolve();
  const read=async()=>demo?structuredClone(state):(await Workspace.findById('gym').lean());
  const mutate=fn=>{
    const work=async()=>{
      if(demo){const next=structuredClone(state);const result=await fn(next);if(JSON.stringify(next)===JSON.stringify(state))return result;if(!memory){await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(next));await rename(file+'.tmp',file);}state=next;return result;}
      for(let attempt=0;attempt<5;attempt++){
        const doc=await Workspace.findById('gym');const next=doc.toObject();const before=JSON.stringify(next);const result=await fn(next);if(before===JSON.stringify(next))return result;
        for(const key of Object.keys(seed(false)))doc.set(key,next[key]);
        try{await doc.save();return result;}catch(e){if(!(e instanceof mongoose.Error.VersionError)||attempt===4)throw e;}
      }
    };
    const promise=queue.then(work);queue=promise.catch(()=>{});return promise;
  };
  return {read,mutate,client:demo?undefined:mongoose.connection.getClient()};
}
