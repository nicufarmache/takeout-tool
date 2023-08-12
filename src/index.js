import { parseArgs } from "node:util";
import Photos from './photos.js';
import Progress from './progress.js';
const progress = new Progress;


const { positionals } = parseArgs({ allowPositionals:true , tokens: true, strict: false });

if (positionals.includes('photos')) {
  new Photos({ progress });
}


