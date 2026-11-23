'use strict';
// A small QR code encoder (byte mode, error correction M, versions 1-10) and the PromptPay amount rewrite.
(function(root){
const EC_PER_BLOCK=[0,10,16,26,18,24,16,18,22,22,26];
const BLOCKS=[0,1,1,1,2,2,4,4,4,5,5];
function rawModules(v){let r=(16*v+128)*v+64;if(v>=2){const a=Math.floor(v/7)+2;r-=(25*a-10)*a-55;if(v>=7)r-=36}return r}
function gfMul(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((y>>>i)&1)*x}return z&255}
function rsDivisor(n){const r=new Array(n).fill(0);r[n-1]=1;let root=1;for(let i=0;i<n;i++){for(let j=0;j<n;j++){r[j]=gfMul(r[j],root);if(j+1<n)r[j]^=r[j+1]}root=gfMul(root,2)}return r}
function rsRemainder(data,div){const r=new Array(div.length).fill(0);for(const b of data){const f=b^r.shift();r.push(0);div.forEach((c,i)=>{r[i]^=gfMul(c,f)})}return r}
function encode(text){
  const bytes=Array.from(new TextEncoder().encode(text));
  let ver=0;
  for(let v=1;v<=10;v++){const cap=Math.floor(rawModules(v)/8)-EC_PER_BLOCK[v]*BLOCKS[v];if(4+(v<10?8:16)+bytes.length*8<=cap*8){ver=v;break}}
  if(!ver)return null;
  const dataCap=Math.floor(rawModules(ver)/8)-EC_PER_BLOCK[ver]*BLOCKS[ver];
  const bits=[];const put=(val,n)=>{for(let i=n-1;i>=0;i--)bits.push((val>>>i)&1)};
  put(4,4);put(bytes.length,ver<10?8:16);bytes.forEach(b=>put(b,8));
  put(0,Math.min(4,dataCap*8-bits.length));while(bits.length%8)bits.push(0);
  for(let pad=0xEC;bits.length<dataCap*8;pad^=0xEC^0x11)put(pad,8);
  const data=[];for(let i=0;i<bits.length;i+=8)data.push(parseInt(bits.slice(i,i+8).join(''),2));
  // blocks + error correction, interleaved
  const nb=BLOCKS[ver],ecl=EC_PER_BLOCK[ver],total=Math.floor(rawModules(ver)/8),shortBlocks=nb-total%nb,shortLen=Math.floor(total/nb);
  const div=rsDivisor(ecl),blocks=[];
  for(let i=0,k=0;i<nb;i++){const len=shortLen-ecl+(i<shortBlocks?0:1);const d=data.slice(k,k+len);k+=len;const e=rsRemainder(d,div);if(i<shortBlocks)d.push(0);blocks.push(d.concat(e))}
  const out=[];for(let i=0;i<blocks[0].length;i++)blocks.forEach((b,j)=>{if(i!==shortLen-ecl||j>=shortBlocks)out.push(b[i])});
  // matrix
  const size=ver*4+17,m=Array.from({length:size},()=>new Array(size).fill(false)),fn=Array.from({length:size},()=>new Array(size).fill(false));
  const set=(x,y,d)=>{m[y][x]=d;fn[y][x]=true};
  for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
  const finder=(cx,cy)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy)),x=cx+dx,y=cy+dy;if(x>=0&&x<size&&y>=0&&y<size)set(x,y,d!==2&&d!==4)}};
  finder(3,3);finder(size-4,3);finder(3,size-4);
  if(ver>=2){const n=Math.floor(ver/7)+2,step=ver===32?26:Math.ceil((ver*4+4)/(n*2-2))*2;const pos=[6];for(let p=size-7;pos.length<n;p-=step)pos.splice(1,0,p);
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){if((i===0&&j===0)||(i===0&&j===n-1)||(i===n-1&&j===0))continue;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(pos[i]+dx,pos[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1)}}
  const bch=(v,poly,hi)=>{let r=v;for(let i=0;i<hi;i++)r=(r<<1)^((r>>>(hi===12?11:9))*poly);return r};
  const drawFormat=mask=>{const dataBits=(0<<3)|mask; // level M = 0b00
    let rem=dataBits;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);const f=((dataBits<<10)|rem)^0x5412;
    const bit=i=>((f>>>i)&1)!==0;
    for(let i=0;i<=5;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));for(let i=9;i<15;i++)set(14-i,8,bit(i));
    for(let i=0;i<8;i++)set(size-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,size-15+i,bit(i));set(8,size-8,true)};
  drawFormat(0);
  if(ver>=7){let rem=ver;for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>>11)*0x1F25);const bitsV=(ver<<12)|rem;
    for(let i=0;i<18;i++){const b=((bitsV>>>i)&1)!==0,a=size-11+i%3,c=Math.floor(i/3);set(a,c,b);set(c,a,b)}}
  // zigzag data placement
  const stream=[];out.forEach(b=>{for(let i=7;i>=0;i--)stream.push((b>>>i)&1)});
  let idx=0;
  for(let right=size-1;right>=1;right-=2){if(right===6)right=5;
    for(let v=0;v<size;v++)for(let j=0;j<2;j++){const x=right-j,up=((right+1)&2)===0,y=up?size-1-v:v;
      if(!fn[y][x]&&idx<stream.length){m[y][x]=stream[idx++]===1}}}
  // choose the mask with the lowest penalty
  const masks=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,(x,y)=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,(x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
  const apply=k=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!fn[y][x]&&masks[k](x,y))m[y][x]=!m[y][x]};
  const penalty=()=>{let p=0;
    for(let pass=0;pass<2;pass++)for(let a=0;a<size;a++){let run=1;for(let b=1;b<size;b++){const cur=pass?m[b][a]:m[a][b],prev=pass?m[b-1][a]:m[a][b-1];if(cur===prev){run++;if(run===5)p+=3;else if(run>5)p++}else run=1}}
    for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){const c=m[y][x];if(c===m[y][x+1]&&c===m[y+1][x]&&c===m[y+1][x+1])p+=3}
    const pat=[1,0,1,1,1,0,1,0,0,0,0],rev=pat.slice().reverse();
    for(let pass=0;pass<2;pass++)for(let a=0;a<size;a++)for(let b=0;b<=size-11;b++){let o1=true,o2=true;for(let k=0;k<11;k++){const c=(pass?m[b+k][a]:m[a][b+k])?1:0;if(c!==pat[k])o1=false;if(c!==rev[k])o2=false}if(o1||o2)p+=40}
    let dark=0;m.forEach(r=>r.forEach(c=>{if(c)dark++}));p+=Math.floor(Math.abs(dark*20-size*size*10)/(size*size))*10;return p};
  let best=0,bestP=Infinity;
  for(let k=0;k<8;k++){apply(k);drawFormat(k);const p=penalty();if(p<bestP){bestP=p;best=k}apply(k)}
  apply(best);drawFormat(best);
  return m;
}
// ---- PromptPay (Thai QR, EMVCo): same rules as the Mac app
function crc16(text){let c=0xFFFF;for(const b of new TextEncoder().encode(text)){c^=b<<8;for(let i=0;i<8;i++)c=(c&0x8000)?((c<<1)^0x1021)&0xFFFF:(c<<1)&0xFFFF}return c.toString(16).toUpperCase().padStart(4,'0')}
function fields(p){const out=[];let i=0;while(i<p.length){if(i+4>p.length)return null;const len=parseInt(p.slice(i+2,i+4),10);if(isNaN(len)||i+4+len>p.length)return null;out.push([p.slice(i,i+2),p.slice(i+4,i+4+len)]);i+=4+len}return out}
function promptPayPayload(base,amount){
  if(typeof base!=='string'||base.length<=8||crc16(base.slice(0,-4))!==base.slice(-4))return null;
  let list=fields(base);if(!list)return null;
  list=list.filter(f=>f[0]!=='63'&&f[0]!=='54');
  if(amount>0){const i=list.findIndex(f=>f[0]==='01');if(i>=0)list[i][1]='12';
    let at=list.findIndex(f=>f[0]>'54');if(at<0)at=list.length;list.splice(at,0,['54',amount.toFixed(2)])}
  const body=list.map(f=>f[0]+String(f[1].length).padStart(2,'0')+f[1]).join('')+'6304';
  return body+crc16(body);
}
root.QR={encode,promptPayPayload,crc16};
if(typeof module!=='undefined')module.exports=root.QR;
})(typeof window!=='undefined'?window:globalThis);
