import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// A small vector-like app mark rasterized locally, without external artwork/fonts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const size = 256;
const pixels = Buffer.alloc(size * (size * 4 + 1));
function insideRound(x,y,left,top,width,height,radius) {
  const dx = Math.max(left+radius-x,0,x-(left+width-radius));
  const dy = Math.max(top+radius-y,0,y-(top+height-radius));
  return dx*dx+dy*dy <= radius*radius;
}
for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
  const idx = y*(size*4+1)+1+x*4;
  if(!insideRound(x,y,8,8,240,240,58)) continue;
  let color=[20,23,24,255];
  if(insideRound(x,y,34,88,188,80,40)) color=[175,217,196,255];
  if(insideRound(x,y,39,93,178,70,35)) color=[9,13,12,255];
  for(let i=0;i<7;i++) { const height=[14,28,40,24,46,30,16][i]; if(insideRound(x,y,77+i*15,128-height/2,6,height,3)) color=[178,226,203,255]; }
  for(let k=0;k<4;k++) pixels[idx+k]=color[k];
}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type,data) {
  const tag=Buffer.from(type); const body=Buffer.concat([tag,data]);let crc=0xffffffff;
  for(const b of body) crc=crcTable[(crc^b)&255]^(crc>>>8);
  const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const icoHeader=Buffer.alloc(22);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(1,4);icoHeader.writeUInt16LE(1,10);icoHeader.writeUInt16LE(32,12);icoHeader.writeUInt32LE(png.length,14);icoHeader.writeUInt32LE(22,18);
fs.mkdirSync(path.join(root,'resources'),{recursive:true});
fs.writeFileSync(path.join(root,'resources','icon.png'),png);
fs.writeFileSync(path.join(root,'resources','icon.ico'),Buffer.concat([icoHeader,png]));
console.log('Generated Agent Island app icons.');
