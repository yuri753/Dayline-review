// Shared by the review site and Dayline. Keep both copies identical.
const string = (maxLength = 20000) => ({type:'string', maxLength});
const number = (minimum, maximum) => ({type:'number', minimum, maximum});
const object = (properties, required = Object.keys(properties)) => ({type:'object', additionalProperties:false, properties, required});
const list = (items, maxItems) => ({type:'array', items, maxItems});
const id = {...string(100), pattern:'^[A-Za-z0-9_-]{1,100}$'};
const color = {...string(7), pattern:'^#[0-9a-fA-F]{6}$'};
const coordinate = number(-1000000, 1000000);
const style = object({fontFamily:string(100), size:number(8,72), color, bold:{type:'boolean'}, italic:{type:'boolean'}, underline:{type:'boolean'}, align:{enum:['left','center','right']}}, []);
const base = {id, x:coordinate, y:coordinate, w:number(160,10000), h:number(120,10000), text:string(), color, background:color, textStyle:style};
const required = ['id','kind','x','y','w','h'];
const media = {assetId:id, imageTitle:string(), annotation:string(), imageTitleStyle:style, annotationStyle:style};
const block = (kind, extra = {}, mandatory = []) => object({...base, kind:{const:kind}, ...extra}, [...required,...mandatory]);
export const canvasSchema = object({
  version:{const:2},
  items:list({oneOf:[block('note'),block('comment'),block('color'),block('link',{url:{...string(4000),pattern:'^https?://[^\\s]+$'}},['url']),block('image',media,['assetId']),block('print',{...media,videoTime:number(0,604800)},['assetId','videoTime'])]},5000),
  paths:list({oneOf:[object({id,from:id,to:id,color,width:number(1,20)}),object({id,points:list(object({x:coordinate,y:coordinate}),50000),color,width:number(1,20)})]},10000),
  assets:{type:'object',maxProperties:5000,propertyNames:id,additionalProperties:{...string(5242880),pattern:'^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$'}},
  videoTime:number(0,604800),
});

// Implements only the JSON Schema keywords used above; SQL uses pg_jsonschema.
function matches(value, schema) {
  if (schema.oneOf) return schema.oneOf.filter(s => matches(value,s)).length === 1;
  if ('const' in schema && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'string' && (typeof value !== 'string' || [...value].length > schema.maxLength || (schema.pattern && !new RegExp(schema.pattern).test(value)))) return false;
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < schema.minimum || value > schema.maximum)) return false;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false;
  if (schema.type === 'array' && (!Array.isArray(value) || value.length > schema.maxItems || !value.every(v => matches(v,schema.items)))) return false;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (schema.maxProperties && Object.keys(value).length > schema.maxProperties) return false;
    if (schema.required?.some(k => !Object.hasOwn(value,k))) return false;
    for (const [key, v] of Object.entries(value)) {
      if (schema.propertyNames && !matches(key,schema.propertyNames)) return false;
      if (Object.hasOwn(schema.properties || {},key)) {if (!matches(v,schema.properties[key])) return false;}
      else if (schema.additionalProperties === false || (typeof schema.additionalProperties === 'object' && !matches(v,schema.additionalProperties))) return false;
    }
  }
  return true;
}

export function validateCanvas(canvas) {
  if (!matches(canvas,canvasSchema)) throw new Error('O canvas contém dados inválidos ou excede os limites permitidos.');
  if (new TextEncoder().encode(JSON.stringify(canvas)).length > 5*1024*1024) throw new Error('O canvas ultrapassa 5 MB. Reduza a quantidade ou o tamanho das imagens antes de enviar.');
  if (!canvas.items.length && !canvas.paths.length) throw new Error('Adicione pelo menos um pedido ao quadro.');
  const ids = new Set();
  for (const entry of [...canvas.items,...canvas.paths]) {if (ids.has(entry.id)) throw new Error('O canvas possui identificadores repetidos.'); ids.add(entry.id);}
  const itemIds = new Set(canvas.items.map(i => i.id));
  for (const item of canvas.items) if (item.assetId && !Object.hasOwn(canvas.assets,item.assetId)) throw new Error('Uma imagem do canvas está faltando.');
  for (const path of canvas.paths) if (path.from && (path.from === path.to || !itemIds.has(path.from) || !itemIds.has(path.to))) throw new Error('Uma conexão do canvas está inválida.');
  return canvas;
}
