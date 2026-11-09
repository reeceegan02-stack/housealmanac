import { composeHtml, frameMap, tilesNeeded, salesStrip, MM } from '../src/compose.js';
import { parseAddress } from '../src/geo.js';
import fs from 'node:fs';

const data = {
  title: '78 Bentgate Street', subtitle: 'Newhey · home of Sam & Alex', header_right: 'Newhey · Rochdale · OL16',
  hero_note: 'The street as the Ordnance Survey drew it at 25 inches to the mile, around 1907.',
  hero_caption: 'Bentgate Street is highlighted. Garfield Mill stands by the River Beal at the western end, with Ellenroad Mill just to the north.',
  story: [
    'Bentgate Street is a mill street. In 1882 the Garfield Spinning Company built a cotton mill here, beside the River Beal, with 61,364 spindles spinning medium to super-fine yarn. Ten years later Ellenroad Mill went up just to the north.',
    'Newhey grew up around its mills. In 1828 it was described as several ranges of cottages and two public houses. The railway arrived in 1863, St Thomas church followed in 1876, and by 1911 the ten cotton mills employed more than 2,000 people.',
    'Garfield Mill was demolished in 1969 and Ellenroad in 1985, all but its engine house, now Ellenroad Steam Museum. The fields south of the street on the old map are now houses.'],
  today_caption: 'The same streets today. Ellenroad engine house still stands as a steam museum, and the M62 now runs past to the west.',
  timeline: [{year:'1828',text:'Newhey: several ranges of cottages'},{year:'1863',text:'The railway reaches Newhey'},{year:'1882',text:'Garfield Mill built on Bentgate Street'},{year:'1892',text:'Ellenroad Mill built close by'},{year:'1911',text:'Ten mills employ 2,000+ people'},{year:'1985',text:'Ellenroad demolished; engine house survives'},{year:'2003',text:'Number 78 is built',key:true},{year:'2025',text:'Sam & Alex make it home',key:true}],
  message_label: 'Bentgate Street · Home since 2025', sources: 'Grace\'s Guide; Wikipedia, "Newhey"; Ellenroad Trust.',
};
const geo = { lat: 53.6037, lon: -2.0985 };
const lines = [[[53.6031,-2.1012],[53.6035,-2.0996],[53.6040,-2.0978],[53.6046,-2.0960]]];
const sales = Array.from({length: 40}, (_, i) => ({ year: 1996 + i * 0.75, price: 38000 * Math.pow(1.05, i * 0.75) * (0.85 + (i % 5) * 0.07) }));
const frame = frameMap({ lat: geo.lat, lon: geo.lon, lines, boxW: 128*MM, boxH: 85.3*MM, devicePx: 3508/1123, maxZoom: 18 });
const need = tilesNeeded({ ...frame, boxW: 128*MM, boxH: 85.3*MM });
const html = composeHtml({ data, geo, lines, histLayer: 'lancashire', todayTiles: { frame, src: {} }, sales, style: process.argv[2] || 'heritage', message: 'Welcome home, Sam & Alex. May your story here be a happy one.\nWith love, Mum & Dad' });
fs.writeFileSync(process.argv[3] || '/tmp/ha_test.html', html);
console.log('hero/today frames ok; today tiles needed:', need.length, 'zoom', frame.z, 'ratio', frame.ratio.toFixed(2));
console.log(parseAddress('Flat 2, 14 Anita Street, Ancoats, Manchester M4 5DG'));
console.log(parseAddress('78 Bentgate Street, Newhey, Rochdale OL16 4JR'));
console.log(parseAddress('Rose Cottage, Mill Lane, Hebden Bridge HX7 6AB'));
console.log('strip n:', salesStrip(sales).n);
