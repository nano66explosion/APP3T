// ─── HEURES TECHNIQUES DATA ─────────────────────────────────────────────────
let htechData = {}; // { regNom: { total: float, stopDate: string|null } }

function parseHtechFile(wb) {
  const result = {};
  wb.SheetNames.forEach(sheetName => {
    // Try to find which regisseur this tab belongs to
    const regNom = normRegFromSheetName(sheetName);
    if (!regNom) return;

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:true});

    let total = 0;
    let stopDate = null;

    rows.forEach(row => {
      // Check for STOP line
      const motif = String(row[3]||'').trim().toUpperCase();
      if (motif.includes('STOP')) {
        const m = motif.match(/STOP AU (\d{2}\/\d{2}\/\d{4})/);
        if (m) stopDate = m[1];
      }
      // Check for TOTAL line
      if (motif === 'TOTAL') {
        const v = parseFloat(row[4]);
        if (!isNaN(v)) total = v;
        return;
      }
      // Sum nb heures (col 4), skip 0s and header rows
      const nbH = parseFloat(row[4]);
      if (!isNaN(nbH) && nbH > 0 && row[0] !== 'Date') {
        // Only count if no STOP yet, or date before STOP
        total = 0; // we use the TOTAL row if available
      }
    });

    // Fallback: if no TOTAL row, sum manually
    if (total === 0) {
      rows.forEach(row => {
        const motif = String(row[3]||'').trim().toUpperCase();
        if (motif === 'TOTAL' || motif.includes('STOP')) return;
        const nbH = parseFloat(row[4]);
        if (!isNaN(nbH) && nbH > 0 && String(row[0]||'') !== 'Date') {
          total += nbH;
        }
      });
    }

    result[regNom] = { total: Math.round(total * 100) / 100, stopDate };
  });
  return result;
}

function normRegFromSheetName(name) {
  const n = String(name||'').trim();
  // Try exact or partial match against known regisseurs
  for (const r of REGS) {
    for (const v of r.v) {
      if (n.toLowerCase().includes(v)) return r.nom;
    }
    // Also check official nom
    if (n.toLowerCase().includes(r.nom.toLowerCase())) return r.nom;
  }
  // Théo Rizzo special case
  if (/théo.?rizzo/i.test(n)||/rizzo/i.test(n)) return 'Rizzo';
  return null;
}

// ─── BASE HEURES SPECTACLES ─────────────────────────────────────────────────
// Lue depuis le fichier "Base HEURES SPECT". Pour chaque spectacle on stocke :
//   mGT / m3T  = heures de montage (GT / 3T-3TC)
//   duree      = durée spectacle moyen (commune)
//   dGT / d3T  = heures de démontage (GT / 3T-3TC)
// Calcul par représentation (= 1 régie) dans une salle s :
//   montage(s) + duree + démontage(s) + 1h de service
// → exactement la logique des formules du fichier (O = C*G+D*H, P = C*L+D*M,
//   R = J*(C+D), Service 1h = E42, total = O+P+R+service).
let baseHeures = {};        // { specNormalisé : {mGT,m3T,duree,dGT,d3T,raw} }
let baseHeuresLoaded = false;

// Normalisation d'un nom de spectacle pour le matching
function normSpec(s){
  return String(s||'').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,' ').trim();
}

function parseBaseHeures(wb){
  const result = {};
  // On prend la première feuille qui contient des données spectacle
  for (const sheetName of wb.SheetNames){
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
    rows.forEach(row => {
      const name = String(row[0]||'').trim();
      if(!name) return;
      // Ignore les lignes de total / en-têtes
      if(/^(total|spectacles?|service)\b/i.test(name)) return;
      // Colonnes (0-based) : G=6 montage GT, H=7 montage 3T/3TC,
      // J=9 durée, L=11 démontage GT, M=12 démontage 3T/3TC
      const mGT = parseFloat(row[6]);
      const m3T = parseFloat(row[7]);
      const duree = parseFloat(row[9]);
      const dGT = parseFloat(row[11]);
      const d3T = parseFloat(row[12]);
      // On ne garde que les vraies lignes de spectacle (au moins une heure définie)
      if([mGT,m3T,duree,dGT,d3T].every(v=>isNaN(v))) return;
      const key = normSpec(name);
      if(!key) return;
      result[key] = {
        mGT: isNaN(mGT)?0:mGT, m3T: isNaN(m3T)?0:m3T,
        duree: isNaN(duree)?0:duree,
        dGT: isNaN(dGT)?0:dGT, d3T: isNaN(d3T)?0:d3T,
        raw: name
      };
    });
    if(Object.keys(result).length) break; // feuille trouvée
  }
  return result;
}

// Distance d'édition (Optimal String Alignment : gère ajout/oubli/substitution/transposition)
function _osa(a,b){
  const m=a.length, n=b.length;
  const d=Array.from({length:m+1},()=>new Array(n+1).fill(0));
  for(let i=0;i<=m;i++) d[i][0]=i;
  for(let j=0;j<=n;j++) d[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++){
    const cost=a[i-1]===b[j-1]?0:1;
    d[i][j]=Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost);
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]) d[i][j]=Math.min(d[i][j], d[i-2][j-2]+1);
  }
  return d[m][n];
}
// Deux mots se ressemblent-ils malgré une coquille ? (ex. vensie↔venise, 3crime↔crime, monlogues↔monologue)
function _wordFuzzy(a,b){
  if(a===b) return true;
  const mn=Math.min(a.length,b.length);
  if(mn<4) return false;            // mots trop courts : correspondance exacte exigée
  const d=_osa(a,b);
  if(d<=1) return true;             // 1 faute tolérée
  if(mn>=8 && d<=2) return true;    // 2 fautes seulement sur les mots longs
  return false;
}

// Retrouve l'entrée base correspondant à un nom de spectacle du plan tech
function matchBaseSpec(specName){
  const k = normSpec(specName);
  if(!k) return null;
  if(baseHeures[k]) return baseHeures[k];
  const keys = Object.keys(baseHeures);
  // contains dans un sens ou l'autre
  let hit = keys.find(bk => bk.includes(k) || k.includes(bk));
  if(hit) return baseHeures[hit];
  // recouvrement de mots, tolérant aux coquilles (distance d'édition)
  const words = k.split(' ').filter(w=>w.length>2);
  let best=null, bestScore=0;
  keys.forEach(bk=>{
    const bw = bk.split(' ').filter(w=>w.length>2);
    let score=0, common=0;
    words.forEach(w=>{ if(bw.some(x=>_wordFuzzy(w,x))){ common++; score+=w.length; } });
    if(common>=1 && score>bestScore){ bestScore=score; best=bk; }
  });
  if(best && bestScore>=4) return baseHeures[best];
  return null;
}

// Spectacles dont les heures sont déclarées EN HEURES SUPP (pas dans la base spectacles).
// → exclus du calcul base ET sortis des « non trouvés » : catégorie à part « 💼 comptés en heures supp ».
// (Ne PAS les ajouter à la base, sinon double comptage avec les heures supp.)
const HSUPP_SPEC_NAMES = ['blind test', 'faux british'];
function isHsuppSpec(spec){
  const k = normSpec(spec);
  return !!k && HSUPP_SPEC_NAMES.some(n => k.includes(n));
}


// Un spectacle écrit en orange MAIS présent dans la base = vraie pièce (pas un invité).
// On corrige le drapeau `guest` sur allDays une fois la base chargée.
function applyGuestBaseOverride(){
  if(!baseHeuresLoaded || !allDays.length) return;
  allDays.forEach(d => (d.entries||[]).forEach(e => {
    if(e.guest && e.salle !== 'Tournée' && matchBaseSpec(e.spec)) e.guest = false;
  }));
}

// Calcule les heures du mois à partir d'un dayMap (cf. buildDayMap)
// Retourne {total, montage, demontage, duree, service, nbRegies, specs:{}, unmatched:[]}
function computeHeures(dayMap){
  const res = {total:0, montage:0, demontage:0, duree:0, service:0,
               nbRegies:0, specs:{}, unmatched:[], guests:[], hsupp:[]};
  const unmatchedSet = new Set();   // spectacles censés être au répertoire mais absents de la base
  const guestSet = new Set();       // artistes invités (texte orange)
  const hsuppSet = new Set();       // spectacles comptés en heures supp (hors base, normal)
  Object.values(dayMap).forEach(entries => entries.forEach(e => {
    if(e.salle === 'Tournée') return;
    if(e.cancelled) return; // spectacle annulé → hors calcul
    if(e.myRole === 'observateur' || e.unassigned) return;
    res.nbRegies++;
    if(e.guest){ guestSet.add(e.spec || '—'); return; } // invité (orange) → hors calcul d'heures
    const isGT = e.salle === 'GT';
    const base = matchBaseSpec(e.spec);
    if(!base){
      if(isHsuppSpec(e.spec)) hsuppSet.add(e.spec || '—');   // compté en heures supp → pas une erreur
      else unmatchedSet.add(e.spec || '—');
      return;
    }
    const montage = isGT ? base.mGT : base.m3T;
    const demont  = isGT ? base.dGT : base.d3T;
    const h = montage + base.duree + demont + 1; // +1h service
    res.montage += montage;
    res.demontage += demont;
    res.duree += base.duree;
    res.service += 1;
    res.total += h;
    const key = base.raw;
    if(!res.specs[key]) res.specs[key] = {count:0, hours:0, salle:e.salle};
    res.specs[key].count++;
    res.specs[key].hours += h;
  }));
  res.unmatched = [...unmatchedSet];
  res.guests = [...guestSet];
  res.hsupp = [...hsuppSet];
  // arrondis propres
  ['total','montage','demontage','duree','service'].forEach(k=>{
    res[k] = Math.round(res[k]*100)/100;
  });
  return res;
}

// ─── TABLE DE NORMALISATION ───────────────────────────────────────────────────
// ─── TABLE DE NORMALISATION ───────────────────────────────────────────────────
const REGS = [
  {nom:'Maxime', v:['maxime','max','maxi']},
  {nom:'JM',     v:['jm','j.m','j-m','jean-marc']},
  {nom:'Jules',  v:['jules']},
  {nom:'Théo',   v:['théo','theo']},
  {nom:'Simon',  v:['simon']},
  {nom:'Rizzo',  v:['rizzo']},
  {nom:'Charly', v:['charly','charlie']},
  {nom:'Laurie', v:['laurie','laure']},
  {nom:'Louis',  v:['louis']},
];

function norm(raw){
  return String(raw||'').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function normReg(raw){
  if(!raw) return null;
  const n = norm(raw);
  for(const r of REGS)
    for(const v of r.v)
      if(n===norm(v)) return r.nom;
  // prefix match (word boundary)
  for(const r of REGS)
    for(const v of r.v){
      const nv=norm(v);
      if(n.startsWith(nv)&&(n.length===nv.length||!/[a-z]/.test(n[nv.length])))
        return r.nom;
    }
  return null;
}

// Extract all known reg names from a free-text string
function extractRegs(text){
  if(!text) return [];
  const found=new Set();
  String(text).split(/[\s,\/&+()\n]+/).forEach(p=>{
    const n=normReg(p.trim());
    if(n) found.add(n);
  });
  return [...found];
}

// Clean spectacle name: remove prefix codes and trailing time
function cleanSpec(raw){
  if(!raw) return '';
  return String(raw)
    .split('\n')[0]
    .replace(/^\s*(33|37)\s+/i,'')
    .replace(/\s*\d{1,2}h\d{0,2}\s*$/i,'')
    .trim();
}

// Particularités d'une représentation (privatisation, coop, semi privé…) :
// la pièce reste la même → on retire la mention du nom et on la garde à part (pastille).
const SPECIAL_PATTERNS = [
  { re:/privatisation/i,        label:'Privatisation' },
  { re:/semi[\s-]*priv[ée]s?/i, label:'Semi privé' },
  { re:/priv[ée]s?/i,           label:'Privé' },
  { re:/\bcoop\b/i,             label:'Coop' },
];
function extractSpecial(name){
  let s = String(name||'');
  const labels = [];
  SPECIAL_PATTERNS.forEach(p => { if(p.re.test(s)){ labels.push(p.label); s = s.replace(p.re,' '); } });
  s = s.replace(/\s+/g,' ').trim();
  return { special: labels.join(' '), name: s };
}

// Parse a régie cell: "Jules" / "Jules/Théo" / "Rizzo(Simon)"
// Returns [{reg, role}]
// role: 'titulaire' | 'doublon' | 'observateur' | 'formateur'
function parseRegie(raw){
  if(!raw) return [];
  const str = String(raw).trim();
  const result=[];

  // Pattern with parentheses: "Rizzo(Simon)" or "Jules(Max)"
  const obsM = str.match(/^(.*?)\(([^)]+)\)(.*)$/);
  if(obsM){
    const before=(obsM[1]+obsM[3]).replace(/\/+/g,'/').replace(/^\/|\/$/g,'').trim();
    const inside=obsM[2].trim();
    if(before){
      const parts=before.split(/[\/,]/).filter(Boolean);
      const role=parts.length>1?'doublon':'titulaire';
      parts.forEach(p=>{
        const n=normReg(p.trim());
        if(n) result.push({reg:n,role,isFormateur:true});
      });
    }
    inside.split(/[\/,]/).forEach(p=>{
      const n=normReg(p.trim());
      if(n) result.push({reg:n,role:'observateur'});
    });
    return result;
  }

  const parts=str.split(/[\/,]/).map(p=>p.trim()).filter(Boolean);
  const role=parts.length>1?'doublon':'titulaire';
  parts.forEach(p=>{
    const n=normReg(p);
    if(n) result.push({reg:n,role});
  });
  return result;
}

// ─── COLUMN MAPPING ──────────────────────────────────────────────────────────
// Key insight: in week days Laurent only fills cols 4-5 (3T), 9-10 (3TC), 14-15 (GT)
// On Saturday he fills ALL slots: 2-3 (3T 18h45), 4-5 (3T 21h), etc.
// Horaire rule: Saturday = real 18h45/21h. Weekdays = always 20h regardless of column.

const SLOTS_SAM = [
  {salle:'3T',  cS:2,  cR:3,  h:'18h45'},
  {salle:'3T',  cS:4,  cR:5,  h:'21h'},
  {salle:'3TC', cS:7,  cR:8,  h:'18h45'},
  {salle:'3TC', cS:9,  cR:10, h:'21h'},
  {salle:'GT',  cS:12, cR:13, h:'18h45'},
  {salle:'GT',  cS:14, cR:15, h:'21h'},
];

// Semaine : la colonne 21h est affichée « 20h ». On lit AUSSI le 18h45 quand il est
// rempli (séances en double pendant les fêtes) — les cases vides sont ignorées au parsing.
const SLOTS_SEM = [
  {salle:'3T',  cS:2,  cR:3,  h:'18h45'},
  {salle:'3T',  cS:4,  cR:5,  h:'20h'},
  {salle:'3TC', cS:7,  cR:8,  h:'18h45'},
  {salle:'3TC', cS:9,  cR:10, h:'20h'},
  {salle:'GT',  cS:12, cR:13, h:'18h45'},
  {salle:'GT',  cS:14, cR:15, h:'20h'},
];

const JOURS_V=['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];

let allDays=[], allMois=[], allRegs=[];
// Cellules "barrées" (spectacles annulés) et "orange" (artistes invités) : "Feuille!REF"
let struckCells = new Set();
let guestCells = new Set();

// Vrai si une couleur hex (RRGGBB ou AARRGGBB) est de teinte ORANGE
function isOrangeHex(hex){
  if(!hex) return false;
  const h = hex.length>6 ? hex.slice(-6) : hex;
  const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  if([r,g,b].some(isNaN)) return false;
  return r>=180 && b<=140 && g>=70 && g<=200 && (r-b)>=70 && (r-g)>=20;
}

// Palette des couleurs de thème (résolue depuis theme1.xml), indexée par l'attribut theme="N"
let _themeColors = [];
// Vrai si un fragment XML contient au moins une couleur ORANGE (RGB directe OU couleur de thème)
function xmlHasOrange(xml){
  let re = /<color\b[^>]*\brgb="([0-9A-Fa-f]{6,8})"/g, m;
  while((m = re.exec(xml))){ if(isOrangeHex(m[1])) return true; }
  re = /<color\b[^>]*\btheme="(\d+)"/g;
  while((m = re.exec(xml))){ const hex = _themeColors[parseInt(m[1],10)]; if(hex && isOrangeHex(hex)) return true; }
  return false;
}

// Lit les styles d'un .xlsx : cellules BARRÉES (annulé) et à TEXTE ORANGE (invité).
// Couvre 3 cas : police de cellule (s/font), texte enrichi en ligne (inlineStr),
// et chaînes partagées (sharedStrings). Tolérante (ne casse jamais le chargement).
async function parseCellStyles(arrayBuffer){
  const struck = new Set(), guest = new Set();
  try{
    if(typeof JSZip === 'undefined') return {struck, guest};
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 0) Couleurs de thème (theme="N") → palette résolue
    _themeColors = [];
    const themeFile = zip.file('xl/theme/theme1.xml');
    if(themeFile){
      const th = await themeFile.async('string');
      const clr = (th.match(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/)||[''])[0];
      ['dk1','lt1','dk2','lt2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'].forEach(tag=>{
        const m = clr.match(new RegExp('<a:'+tag+'>\\s*<a:(?:srgbClr val|sysClr[^>]*lastClr)="?([0-9A-Fa-f]{6})'));
        _themeColors.push(m ? m[1] : null);
      });
    }

    const stylesFile = zip.file('xl/styles.xml');
    const styles = stylesFile ? await stylesFile.async('string') : '';

    // 1) Polices : barré (<strike/>) et couleur orange
    const fontsBlock = (styles.match(/<fonts\b[\s\S]*?<\/fonts>/)||[''])[0];
    const fonts = []; const fontRe = /<font\b[^>]*\/>|<font\b[\s\S]*?<\/font>/g; let fm;
    while((fm = fontRe.exec(fontsBlock))){
      const f = fm[0];
      fonts.push({struck:/<strike\b/.test(f), orange:xmlHasOrange(f)});
    }
    // 2) cellXfs : index de style -> index de police
    const xfsBlock = (styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)||[''])[0];
    const xfRe = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g; let xm; const xfFont = [];
    while((xm = xfRe.exec(xfsBlock))){ const f=(xm[0].match(/\bfontId="(\d+)"/)||[])[1]; xfFont.push(f?parseInt(f,10):0); }

    // 3) sharedStrings : couleur/barré au niveau du texte
    const shared = [];
    const ssFile = zip.file('xl/sharedStrings.xml');
    if(ssFile){
      const ss = await ssFile.async('string');
      const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g; let sm;
      while((sm = siRe.exec(ss))){ const inner = sm[1]||''; shared.push({orange:xmlHasOrange(inner), struck:/<strike\b/.test(inner)}); }
    }

    // 4) Mapping nom d'onglet -> fichier feuille
    const wb = await zip.file('xl/workbook.xml').async('string');
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const sheetTags = wb.match(/<sheet\b[^>]*\/>/g) || [];
    for(const tag of sheetTags){
      const name = (tag.match(/name="([^"]*)"/)||[])[1];
      const rid  = (tag.match(/r:id="([^"]*)"/)||[])[1];
      if(!name || !rid) continue;
      const relTag = (rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*/>`))||[''])[0];
      let target = (relTag.match(/Target="([^"]*)"/)||[])[1];
      if(!target) continue;
      const path = 'xl/' + target.replace(/^\/?xl\//,'').replace(/^\//,'');
      const sf = zip.file(path); if(!sf) continue;
      const sx = await sf.async('string');
      // Parcourt chaque cellule. Auto-fermante d'abord + quantif. PARESSEUX :
      // sinon une cellule vide <c r=".." s=".."/> avale la cellule suivante.
      const cRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g; let cm;
      while((cm = cRe.exec(sx))){
        const attrs = (cm[1] || cm[2] || '');
        const inner = cm[3] || '';
        const ref = (attrs.match(/\br="([A-Z]+\d+)"/)||[])[1];
        if(!ref) continue;
        const sIdx = (attrs.match(/\bs="(\d+)"/)||[])[1];
        const t    = (attrs.match(/\bt="(\w+)"/)||[])[1];
        let isStruck = false, isOrange = false;
        // a) police de cellule
        if(sIdx !== undefined){ const f = fonts[xfFont[parseInt(sIdx,10)]]; if(f){ isStruck = isStruck||f.struck; isOrange = isOrange||f.orange; } }
        // b) chaîne partagée (t="s")
        if(t === 's'){ const vi = (inner.match(/<v>(\d+)<\/v>/)||[])[1]; if(vi!==undefined){ const si = shared[parseInt(vi,10)]; if(si){ isStruck = isStruck||si.struck; isOrange = isOrange||si.orange; } } }
        // c) texte enrichi en ligne (inlineStr ou runs)
        else { if(/<strike\b/.test(inner)) isStruck = true; if(xmlHasOrange(inner)) isOrange = true; }
        if(isStruck) struck.add(name + '!' + ref);
        if(isOrange) guest.add(name + '!' + ref);
      }
    }
  }catch(e){ console.warn('parseCellStyles:', e); }
  return {struck, guest};
}

function moisKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function moisLabel(d){ return d.toLocaleDateString('fr-FR',{month:'long',year:'numeric'}); }

// #17 — Détection AUTO des colonnes du plan tech à partir des en-têtes.
// Lit 3 lignes d'en-tête : salles (3T / 3T CÔTE / GRAND THEATRE), horaires (18h45/21h),
// et "Spectacle"/"Régie"/"Tournée". Renvoie {slotsSam, slotsSem, tourCol} ou null si
// l'analyse échoue → dans ce cas on retombe sur les colonnes EN DUR (SLOTS_SAM/SEM).
function salleFromHeader(txt){
  const t = norm(txt);
  if(!t) return null;
  if(t.includes('cote')) return '3TC';           // « 3T CÔTE » (accents déjà retirés)
  if(t.includes('grand')) return 'GT';
  if(t.includes('3t')) return '3T';
  return null;
}
function detectPlanColumns(rows){
  try{
    // 1) Ligne d'en-tête « Date / Spectacle / Régie »
    let hdrRow = -1;
    for(let i=0;i<Math.min(rows.length,10);i++){
      const r = rows[i]||[];
      const hasDate = norm(r[0])==='date';
      const hasSpec = r.some(c=>/spectacle/i.test(String(c)));
      const hasReg  = r.some(c=>/r[ée]gie/i.test(String(c)));
      if((hasDate && hasSpec) || (hasSpec && hasReg)){ hdrRow=i; break; }
    }
    if(hdrRow<1) return null;
    const hdr = rows[hdrRow]||[];
    const timeRow = rows[hdrRow-1]||[];
    // 2) Ligne des salles (juste au-dessus, on remonte jusqu'à 3 lignes)
    let salleRow = null;
    for(let i=hdrRow-1;i>=Math.max(0,hdrRow-3);i--){
      if((rows[i]||[]).some(c=>salleFromHeader(c))){ salleRow=rows[i]; break; }
    }
    if(!salleRow) return null;
    // 3) Chaque colonne hérite de la dernière salle rencontrée (remplissage avant)
    const maxc = Math.max(hdr.length, salleRow.length, timeRow.length);
    const colSalle = []; let cur = null;
    for(let c=0;c<maxc;c++){ const s = salleFromHeader(salleRow[c]); if(s) cur=s; colSalle[c]=cur; }
    // 4) Paires Spectacle→Régie + colonne Tournée
    const detected = []; let tourCol = -1;
    for(let c=0;c<hdr.length;c++){
      const h = String(hdr[c]||'').trim();
      if(/tourn/i.test(h)){ tourCol=c; continue; }
      if(/spectacle/i.test(h)){
        let cR = -1;
        for(let k=c+1;k<Math.min(hdr.length,c+3);k++){ if(/r[ée]gie/i.test(String(hdr[k]||''))){ cR=k; break; } }
        const salle = colSalle[c];
        if(salle && cR>=0) detected.push({salle, cS:c, cR, h:String(timeRow[c]||'').trim()});
      }
    }
    if(!detected.length) return null;
    // Samedi : tous les créneaux. Semaine : tous aussi (le « 21h » affiché « 20h »,
    // le 18h45 lu quand rempli — séances en double pendant les fêtes).
    const slotsSam = detected.map(d=>({salle:d.salle, cS:d.cS, cR:d.cR, h:d.h}));
    const slotsSem = detected.map(d=>({salle:d.salle, cS:d.cS, cR:d.cR, h:/21/.test(d.h)?'20h':d.h}));
    return { slotsSam, slotsSem, tourCol: tourCol>=0?tourCol:null };
  }catch(e){ console.warn('detectPlanColumns:', e); return null; }
}

function parsePlanTech(wb){
  const days=[];
  const regSet=new Set();

  wb.SheetNames.forEach(sheetName=>{
    if(/modèle|copie/i.test(sheetName)) return;

    const ws=wb.Sheets[sheetName];
    // raw:true keeps numbers as numbers (serial dates stay as serials)
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});

    // Année de la feuille : d'abord la cellule A2 (date), sinon repli sur n'importe
    // quelle date trouvée dans la feuille, sinon sur l'année dans le NOM de la feuille.
    let sheetYear=null;
    const hdVal=rows[1]&&rows[1][0];
    if(typeof hdVal==='number'&&hdVal>40000){
      sheetYear=new Date(Math.round((hdVal-25569)*86400000)).getUTCFullYear();
    }
    if(!sheetYear){
      // repli 1 : première date sérielle rencontrée dans la feuille
      for(const row of rows){ for(const v of row){ if(typeof v==='number'&&v>40000&&v<80000){ sheetYear=new Date(Math.round((v-25569)*86400000)).getUTCFullYear(); break; } } if(sheetYear) break; }
    }
    if(!sheetYear){
      // repli 2 : année dans le nom de la feuille (ex. « Sept 25 » → 2025)
      const ym=String(sheetName).match(/\b(\d{2}|\d{4})\b/);
      if(ym){ const n=parseInt(ym[1],10); sheetYear = n>=100 ? n : 2000+n; }
    }
    if(!sheetYear) return;

    // #17 — Colonnes détectées depuis les en-têtes (repli sur les colonnes en dur)
    const det = detectPlanColumns(rows);
    const SAM = (det && det.slotsSam.length) ? det.slotsSam : SLOTS_SAM;
    const SEM = (det && det.slotsSem.length) ? det.slotsSem : SLOTS_SEM;

    // Colonne Tournée : détectée par en-tête, sinon scan ligne 3, sinon 17
    let tourCol = (det && det.tourCol!=null) ? det.tourCol : 17;
    if(!det || det.tourCol==null){
      const hRow=rows[3]||[];
      hRow.forEach((c,i)=>{ if(String(c).trim().toLowerCase()==='tournée') tourCol=i; });
    }

    // Dynamically find the first data row (row after the "Date" header)
    let firstDataRow = 4; // fallback
    for(let i=0;i<Math.min(rows.length,8);i++){
      if(String(rows[i][0]||'').trim().toLowerCase()==='date'){
        firstDataRow=i+1; break;
      }
    }

    let lastDateObj=null, lastJour='';
    rows.forEach((row,ri)=>{
      if(ri<firstDataRow) return;
      const jourRaw=String(row[0]||'').trim().toLowerCase();
      const serial=rows[ri][1];
      const hasDate = JOURS_V.some(j=>jourRaw.startsWith(j)) && typeof serial==='number' && serial>=40000;
      let dateObj, jour;
      if(hasDate){
        // Convert Excel serial to a UTC-based date ; year overridden by sheet header
        const utcDate=new Date(Math.round((serial-25569)*86400000));
        dateObj=new Date(Date.UTC(sheetYear,utcDate.getUTCMonth(),utcDate.getUTCDate()));
        jour=jourRaw;
        lastDateObj=dateObj; lastJour=jour;
      } else {
        // Ligne de CONTINUATION (ex. réveillon : 3 créneaux 18h45/21h/23h, la date n'est
        // écrite que sur la 1ʳᵉ ligne) → rattachée à la date précédente si du vrai contenu existe.
        if(!lastDateObj) return;
        const hasContent=[2,3,4,5,7,8,9,10,12,13,14,15].some(c=>{
          const v=String(row[c]||'').trim();
          return v && !/^\d{1,2}h\d{0,2}$/i.test(v);   // ignore les cellules d'heure seules (18h45/21h/23h)
        });
        if(!hasContent) return;
        dateObj=lastDateObj; jour=lastJour;
      }

      const isSam=dateObj.getDay()===6;
      const slots=isSam?SAM:SEM;
      const entries=[];

      // Réveillon : l'heure réelle (18h45/21h/23h) est écrite seule dans la colonne 18h45
      // (cols 2/7/12, identique pour les 3 salles) → on l'utilise comme libellé horaire de la ligne.
      let rowTime = null;
      for(const c of [2,7,12]){
        const v = String(row[c]||'').trim();
        if(/^\d{1,2}h\d{0,2}$/i.test(v)){ rowTime = v; break; }
      }

      slots.forEach(slot=>{
        const specRaw=String(row[slot.cS]||'').trim();
        const regRaw=String(row[slot.cR]||'').trim();
        if(!specRaw&&!regRaw) return;
        // Particularité (privatisation, coop, semi privé…) → retirée du nom, gardée à part
        const { special, name:specCore } = extractSpecial(cleanSpec(specRaw));
        const specNom=specCore;
        const regies=parseRegie(regRaw);
        regies.forEach(r=>regSet.add(r.reg));
        // Annulé = nom du spectacle barré ; Invité = nom du spectacle en orange
        const specRef = `${sheetName}!${colLetter(slot.cS)}${ri+1}`;
        const regRef  = `${sheetName}!${colLetter(slot.cR)}${ri+1}`;
        const cancelled = struckCells.has(specRef) || struckCells.has(regRef);
        const guest = guestCells.has(specRef);
        if(specNom||special||regies.length>0)
          entries.push({salle:slot.salle,h:rowTime||slot.h,spec:specNom,special,regies,cancelled,guest,
            unassigned:regies.length===0&&!!specNom,
            // Provenance pour pouvoir écrire dans le Google Sheet
            src:{sheet:sheetName,row0:ri,col0:slot.cR,rawReg:regRaw}});
      });

      // Tournée: scan entire cell text for reg names
      const tourRaw=String(row[tourCol]||'').trim();
      if(tourRaw&&!/^\d{4}-\d{2}-\d{2}/.test(tourRaw)&&!/^\d+$/.test(tourRaw)){
        const tourRegs=extractRegs(tourRaw);
        if(tourRegs.length>0){
          tourRegs.forEach(r=>regSet.add(r));
          // Build spec name: first line, remove known reg names
          let specNom=tourRaw.split('\n')[0];
          tourRegs.forEach(r=>{
            const rv=REGS.find(x=>x.nom===r);
            if(rv) rv.v.forEach(v=>{
              specNom=specNom.replace(new RegExp('\\b'+norm(v)+'\\b','gi'),'');
            });
          });
          specNom=specNom.replace(/[&]/g,'').replace(/\s+/g,' ').trim();
          specNom=cleanSpec(specNom)||'Tournée';
          entries.push({
            salle:'Tournée',h:'',
            spec:specNom,
            regies:tourRegs.map(r=>({reg:r,role:'tournée'}))
          });
        }
      }

      if(entries.length>0)
        days.push({date:dateObj,jour,entries});
    });
  });

  // Deduplicate by date
  const map=new Map();
  days.forEach(d=>{
    const k=d.date.toISOString().slice(0,10); // UTC date, safe since we store UTC midnights
    if(!map.has(k)) map.set(k,d);
    else map.get(k).entries.push(...d.entries);
  });

  const unique=[...map.values()].sort((a,b)=>a.date-b.date);
  const moisMap=new Map();
  unique.forEach(d=>{
    const k=moisKey(d.date);
    if(!moisMap.has(k)) moisMap.set(k,moisLabel(d.date));
  });

  return{
    days:unique,
    mois:[...moisMap.entries()].map(([k,l])=>({k,l})),
    regs:[...regSet].filter(Boolean).sort()
  };
}

// ─── GOOGLE DRIVE CONNECTION ─────────────────────────────────────────────────
// drive : lecture + écriture de tous les fichiers Drive (permet d'écrire dans le plan tech .xlsx
//         déjà enregistré, sans devoir le re-sélectionner). spreadsheets : écriture Google Sheets natifs.
// openid/email/profile : nécessaires pour ouvrir une session Firebase Auth (signInWithCredential)
// avec le même jeton Google → permet de verrouiller Firestore (request.auth) sans 2ᵉ connexion.
const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets';
const SCOPE_VERSION = '5'; // à incrémenter si on change les scopes (force le re-consentement)
let accessToken = null;
let googleEmail = (localStorage.getItem('3t_google_email') || '');  // identité du compte connecté
let planLoaded = false;

const DEFAULT_CLIENT_ID = '792962540106-mmfieb41b0911cd04im9l63091tk6gcb.apps.googleusercontent.com';
// Fichiers Drive par défaut (chargés automatiquement — plus besoin de les sélectionner)
const DEFAULT_PLAN_ID  = '1PVlsCn2SS3BmJaehNdjsh3xhjPhTCVh_';
const DEFAULT_BASE_ID  = '1CjVuC4zHxfjxJE0YACQk3efqZDbbBT3a';
const HSUPP_FOLDER_ID  = '1-HR96E9cjorFO9j9navxlQ1MKEVg9_7v';
const APP_VERSION = '2026-06-10 · b74 (animations globales : modales, cartes, retour tactile boutons)';

// ─── #16 PUSH (Firebase Cloud Messaging) ─────────────────────────────────────
// Config publique du projet Firebase (à coller depuis la console Firebase →
// Paramètres du projet → Tes applications → Configuration SDK). Sans valeurs,
// le push reste désactivé (les notifications locales continuent de marcher).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDXOF7_eTKMDYp8swxmoznEfyxY8_4ArP0",
  authDomain: "tapp-2c0a8.firebaseapp.com",
  projectId: "tapp-2c0a8",
  storageBucket: "tapp-2c0a8.firebasestorage.app",
  messagingSenderId: "960662160605",
  appId: "1:960662160605:web:ea08946dca820ba381c734"
};
// Clé VAPID publique (console Firebase → Cloud Messaging → Web Push certificates).
const FCM_VAPID_KEY = "BNC0bgTU3xlkLZIh39qyZSdqAkKximdg1bJlsxDlIOU6prDwNaWfPZvoBH8YygRBxwtmUaHtsQyNEXrIdfHQkJs";
// Worker Cloudflare pour la notif INSTANTANÉE de formation (cf. cloudflare/worker.js).
// Laisser vide tant que le Worker n'est pas déployé → on retombe sur le cron de secours.
const FORMATION_WORKER_URL = "https://formation-notif.nano66explosion.workers.dev/";
// Le push est-il configuré ?
function pushConfigured(){ return !!(FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.apiKey && FCM_VAPID_KEY); }
function getClientId() { return localStorage.getItem('3t_client_id') || DEFAULT_CLIENT_ID; }
function getSavedFileId() { return localStorage.getItem('3t_plan_file_id') || ''; }
function getSavedFileName() { return localStorage.getItem('3t_plan_file_name') || ''; }
function getSavedFileMime() { return localStorage.getItem('3t_plan_file_mime') || ''; }
function getSavedBaseId() { return localStorage.getItem('3t_base_file_id') || ''; }
function getSavedBaseName() { return localStorage.getItem('3t_base_file_name') || ''; }
function getSavedBaseMime() { return localStorage.getItem('3t_base_file_mime') || ''; }
function getSavedHsuppId() { return localStorage.getItem('3t_hsupp_file_id') || ''; }
function getSavedHsuppName() { return localStorage.getItem('3t_hsupp_file_name') || ''; }
function getSavedHsuppMime() { return localStorage.getItem('3t_hsupp_file_mime') || ''; }

function saveClientId() {
  const val = document.getElementById('client-id-input').value.trim();
  if (!val.includes('apps.googleusercontent.com')) {
    document.getElementById('config-error').textContent = 'Format invalide. Vérifie ton Client ID.';
    return;
  }
  localStorage.setItem('3t_client_id', val);
  document.getElementById('config-error').textContent = '✅ Enregistré';
}

function appIsOpen() {
  return document.getElementById('app-screen').style.display === 'flex';
}

// Fenêtre "Fichiers" : ouvrable depuis l'app, ou affichée d'office si rien n'est configuré
function openSettingsModal() {
  document.getElementById('client-id-input').value = getClientId();
  refreshSavedFileLabel();
  refreshBaseLabel();
  // "Entrer dans l'app" utile seulement avant d'être entré, et si un plan est chargé
  document.getElementById('btn-enter-app').style.display =
    (!appIsOpen() && planLoaded) ? 'block' : 'none';
  updateProfileLabel();
  updateNotifLabel();
  refreshHsuppLabel();
  updateThemeLabel();
  const ver = document.getElementById('app-version'); if(ver) ver.textContent = 'Version ' + APP_VERSION;
  const lver = document.getElementById('login-version'); if(lver) lver.textContent = 'Version ' + APP_VERSION;
  try{ initFirebase(); updateAuthStatus(_fbAuth && _fbAuth.currentUser); }catch(e){}   // état session base
  document.getElementById('settings-modal').style.display = 'flex';
}

// ── Thème clair / sombre (mémorisé) ──
function applyTheme(theme){
  if(theme === 'light') document.documentElement.setAttribute('data-theme','light');
  else document.documentElement.removeAttribute('data-theme');
}
function getTheme(){ return localStorage.getItem('3t_theme') === 'light' ? 'light' : 'dark'; }
function toggleTheme(){
  const next = getTheme() === 'light' ? 'dark' : 'light';
  localStorage.setItem('3t_theme', next);
  applyTheme(next);
  updateThemeLabel();
}
function updateThemeLabel(){
  const label = getTheme() === 'light' ? '🌙 Passer en sombre' : '☀️ Passer en clair';
  const btn = document.getElementById('btn-theme');
  if(btn) btn.textContent = label;
  const btnLogin = document.getElementById('btn-theme-login');
  if(btnLogin) btnLogin.textContent = label;
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', getTheme() === 'light' ? '#f5f3ef' : '#0f0f0f');
}
applyTheme(getTheme());
document.addEventListener('DOMContentLoaded', updateThemeLabel);
// Affiche la version sur l'écran de connexion (et dans les Paramètres) dès le chargement
document.addEventListener('DOMContentLoaded', () => {
  const lver = document.getElementById('login-version'); if(lver) lver.textContent = 'Version ' + APP_VERSION;
  const ver = document.getElementById('app-version'); if(ver) ver.textContent = 'Version ' + APP_VERSION;
});

// Pastille colorée selon le rôle du régisseur (titulaire/doublon/observateur/formateur)
function roleDot(r){
  let cls='rd-tit', t='Titulaire';
  if(r.role === 'observateur'){ cls='rd-obs'; t='Observateur'; }
  else if(r.isFormateur){ cls='rd-form'; t='Formateur'; }
  else if(r.role === 'doublon'){ cls='rd-doub'; t='Doublon'; }
  return `<span class="role-dot ${cls}" title="${t}"></span>`;
}

function updateProfileLabel() {
  const lbl = document.getElementById('lbl-profile');
  if (!lbl) return;
  const reg = getMyReg();
  if (reg) lbl.textContent = `${getMyEmoji() ? getMyEmoji() + ' ' : ''}${reg}`;
  else lbl.textContent = allRegs.length ? 'Non défini' : 'Charge d\'abord le plan tech';
}

function closeSettingsModal() {
  document.getElementById('settings-modal').style.display = 'none';
  document.getElementById('btn-base-continue').style.display = 'none';
}

function forgetPlanTech() {
  localStorage.removeItem('3t_plan_file_id');
  localStorage.removeItem('3t_plan_file_name');
  localStorage.removeItem('3t_plan_file_mime');
  refreshSavedFileLabel();
  setStatus('');
}

function refreshSavedFileLabel() {
  const savedName = getSavedFileName();
  const loginLbl = document.getElementById('login-saved-file');
  const modalLbl = document.getElementById('lbl-plan');
  const changeBtn = document.getElementById('btn-change-file');
  if (savedName) {
    if (loginLbl) loginLbl.textContent = `📄 ${savedName}`;
    if (modalLbl) modalLbl.textContent = `📄 ${savedName}`;
    if (changeBtn) changeBtn.style.display = 'block';
  } else {
    if (loginLbl) loginLbl.textContent = '';
    if (modalLbl) modalLbl.textContent = '';
    if (changeBtn) changeBtn.style.display = 'none';
  }
}

// ─── CACHE DU JETON D'ACCÈS ──────────────────────────────────────────────────
// Le jeton Google est valable ~1h. On le garde en localStorage pour rentrer
// directement à la prochaine ouverture, sans même refaire un échange avec Google.
function saveToken(token, expiresIn) {
  accessToken = token;
  const exp = Date.now() + ((expiresIn || 3600) * 1000) - 60000; // marge 60s
  try {
    localStorage.setItem('3t_token', token);
    localStorage.setItem('3t_token_exp', String(exp));
    localStorage.setItem('3t_scope_v', SCOPE_VERSION);
  } catch (e) {}
}
function getCachedToken() {
  // Si les scopes ont changé, on invalide le cache pour forcer le re-consentement
  if (localStorage.getItem('3t_scope_v') !== SCOPE_VERSION) return null;
  const t = localStorage.getItem('3t_token');
  const exp = parseInt(localStorage.getItem('3t_token_exp') || '0', 10);
  if (t && exp && Date.now() < exp) return t;
  return null;
}
function clearToken() {
  accessToken = null;
  localStorage.removeItem('3t_token');
  localStorage.removeItem('3t_token_exp');
}

function markConnectedUI() {
  document.getElementById('btn-connect').textContent = '✅ Connecté';
  document.getElementById('btn-connect').style.opacity = '0.6';
  document.getElementById('btn-disconnect').style.display = 'block';
  refreshHsuppLabel();
}

// Une fois qu'on a un jeton valide (frais ou en cache) → charge les fichiers
async function onAuthenticated() {
  localStorage.setItem('3t_connected', '1');
  markConnectedUI();
  setStep('auth','done');
  // Identité : récupère l'email Google → charge le profil partagé (régisseur/emoji/anniv)
  // pour que le même compte retrouve le même profil sur n'importe quel appareil.
  try {
    await firebaseSignIn(accessToken);          // session Firebase Auth (avant toute lecture Firestore)
    const id = await fetchGoogleIdentity();
    if (id && id.email) {
      googleEmail = id.email;
      localStorage.setItem('3t_google_email', id.email);
      if (id.name) localStorage.setItem('3t_google_name', id.name);
      await loadProfileForEmail(id.email);
    }
  } catch(e){ console.warn('identity:', e); }
  // Configure automatiquement plan tech + base depuis les IDs par défaut
  try { setStatus('⏳ Préparation des fichiers…'); await ensureDefaultFiles(); }
  catch(e){ console.warn('ensureDefaultFiles:', e); }
  const savedId = getSavedFileId();
  if (savedId) {
    setStatus(`⏳ Chargement de "${getSavedFileName()}"…`);
    setStep('plan','loading');
    await loadPlanTechById(savedId, getSavedFileName(), getSavedFileMime());
  } else {
    setStep('plan','error');
    setStatus('Choisis ton plan tech pour commencer.');
    openSettingsModal();
  }
}

// Demande un jeton en silence (sans popup) — utilisé si le cache a expiré
function silentRefresh() {
  try { initTokenClient().requestAccessToken({ prompt: '' }); }
  catch (e) { setStatus(''); }
}

// Token client kept around so we can request/refresh tokens
let tokenClient = null;

function initTokenClient() {
  if (tokenClient) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: getClientId(),
    scope: SCOPES,
    callback: async (resp) => {
      if (resp.error) {
        // Silent attempt failed (e.g. user not yet consented) → just wait for manual click
        if (resp.error === 'interaction_required' || resp.error === 'access_denied') {
          setStatus('');
          loginStepsShow(false);
        } else {
          setStatus('❌ Erreur : ' + resp.error);
          setStep('auth','error');
        }
        return;
      }
      saveToken(resp.access_token, resp.expires_in);
      try { localStorage.setItem('3t_granted_scopes', resp.scope || ''); } catch(e){}
      onAuthenticated();
    }
  });
  return tokenClient;
}

// ── Session Drive persistante (refresh token côté Worker) ─────────────────────
// Attend que Firebase Auth ait restauré (ou non) la session au démarrage.
async function ensureFirebaseReady(){
  initFirebase();
  if(!_fbAuth) return null;
  if(_fbAuth.currentUser) return _fbAuth.currentUser;
  return new Promise(res => {
    let done = false;
    const unsub = _fbAuth.onAuthStateChanged(u => { if(done) return; done=true; try{unsub();}catch(e){} res(u); });
    setTimeout(() => { if(!done){ done=true; res(_fbAuth.currentUser); } }, 3000);  // garde-fou
  });
}
// Échange le code d'autorisation contre une session (le refresh token reste dans le
// Worker/KV). Renvoie true si on a obtenu un access_token.
async function exchangeCodeForSession(code){
  if(!FORMATION_WORKER_URL) return false;
  try{
    const r = await fetch(FORMATION_WORKER_URL, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'exchangeCode', code })
    });
    if(!r.ok) return false;
    const j = await r.json().catch(()=>null);
    if(!j || !j.access_token) return false;
    saveToken(j.access_token, j.expires_in);
    try{ localStorage.setItem('3t_granted_scopes', SCOPES); }catch(e){}
    localStorage.setItem('3t_has_refresh', j.has_refresh ? '1' : '0');
    return true;
  }catch(e){ console.warn('exchangeCodeForSession:', e); return false; }
}
// Rafraîchit l'access_token Drive SANS popup via le Worker (marche en PWA iOS).
// Nécessite une session Firebase (preuve d'identité). Renvoie true si OK.
async function refreshViaWorker(){
  if(!FORMATION_WORKER_URL) return false;
  try{
    const user = await ensureFirebaseReady();
    if(!user) return false;
    const idToken = await user.getIdToken();
    const r = await fetch(FORMATION_WORKER_URL, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'refreshToken', firebaseIdToken: idToken })
    });
    if(!r.ok) return false;                      // 404 no_refresh / 501 non configuré → repli
    const j = await r.json().catch(()=>null);
    if(!j || !j.access_token) return false;
    saveToken(j.access_token, j.expires_in);
    return true;
  }catch(e){ console.warn('refreshViaWorker:', e); return false; }
}
// Reconnexion silencieuse : Worker d'abord (sans popup), sinon ancien flux implicite.
function reauth(){
  refreshViaWorker().then(ok => { if(!ok) silentRefresh(); });
}
// Client "code" (flux authorization-code) pour obtenir un refresh token persistant.
let codeClient = null;
function initCodeClient(){
  if(codeClient) return codeClient;
  codeClient = google.accounts.oauth2.initCodeClient({
    client_id: getClientId(),
    scope: SCOPES,
    ux_mode: 'popup',
    callback: async (resp) => {
      if(resp.error || !resp.code){
        if(resp.error === 'access_denied'){ setStatus(''); loginStepsShow(false); }
        else { setStatus('❌ Erreur : ' + (resp.error || 'connexion')); setStep('auth','error'); }
        return;
      }
      const ok = await exchangeCodeForSession(resp.code);
      if(ok){ onAuthenticated(); }
      else { initTokenClient().requestAccessToken({ prompt: 'consent' }); }  // repli flux implicite
    }
  });
  return codeClient;
}

// L'utilisateur a-t-il accordé le droit d'écriture Drive ?
function hasWriteScope(){
  const g = localStorage.getItem('3t_granted_scopes') || '';
  return /\/auth\/drive(\s|$)/.test(g) || g.includes('/auth/drive.file');
}

// Re-render au redimensionnement (bascule tableau PC ↔ cartes mobile)
let _resizeT = null;
// Place le bloc de contrôles (équipe/légende/onglets) juste sous l'en-tête collé (mobile)
function updateStickyOffsets(){
  const ctrl = document.querySelector('.app-controls');
  const hdr = document.querySelector('.app-header');
  if(!ctrl || !hdr) return;
  ctrl.style.top = window.matchMedia('(max-width:767px)').matches ? (hdr.offsetHeight + 'px') : '';
}
// La hauteur de l'en-tête change quand le bandeau mois se replie/déplie (animation) :
// on recalcule l'offset À LA FIN de la transition (sinon trou entre l'en-tête et les contrôles).
document.addEventListener('DOMContentLoaded', () => {
  const mn = document.getElementById('month-nav');
  if(mn) mn.addEventListener('transitionend', e => { if(e.propertyName==='max-height' && appIsOpen()) updateStickyOffsets(); });
});
window.addEventListener('resize', () => {
  clearTimeout(_resizeT);
  _resizeT = setTimeout(() => { if (appIsOpen()) { renderCalendar(); updateStickyOffsets(); } }, 200);
});

// ─── PWA : enregistrement du service worker ──────────────────────────────────
if ('serviceWorker' in navigator) {
  // Quand une nouvelle version du service worker prend le relais → on recharge
  // automatiquement pour appliquer la mise à jour (fini les versions en cache).
  let _swReloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_swReloading) return;
    _swReloading = true;
    location.reload();
  });
  // Clic sur une notif quand l'app est DÉJÀ ouverte : le SW nous envoie la cible
  // (#f-<date>, #today, #soiree) → on navigue sans recharger.
  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data;
    if (m && m.type === 'notif-nav' && m.hash) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch(err){}
      location.hash = m.hash;        // déclenche hashchange → handleNotifNav
      if (typeof handleNotifNav === 'function') handleNotifNav();
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => { try { reg.update(); } catch(e) {} })
      .catch(e => console.warn('SW non enregistré:', e));
  });
}

// ─── NOTIFICATIONS LOCALES ───────────────────────────────────────────────────
function notifSupported(){ return 'Notification' in window; }
// iOS (iPhone/iPad) ?
function isIOS(){ return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1); }
// L'app est-elle lancée en mode installé (écran d'accueil) ?
function isStandalone(){ return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; }
function requestNotifications(){
  if(!notifSupported()){
    if(isIOS() && !isStandalone()){
      toast("📲 Installe l'app (Partager → « Sur l'écran d'accueil ») pour activer les notifications iOS", 'err');
    } else {
      toast("Ton navigateur ne gère pas les notifications.", 'err');
    }
    return;
  }
  Notification.requestPermission().then(p => {
    updateNotifLabel();
    if(p === 'granted'){
      checkReminders();        // rappels locaux (app ouverte)
      enablePush();            // #16 — push serveur (app fermée), si configuré
    }
  });
}

// ─── #16 PUSH (Firebase Cloud Messaging) ─────────────────────────────────────
let _fbApp = null, _fbMessaging = null, _fbDb = null, _fbAuth = null;
function initFirebase(){
  if(_fbApp || !pushConfigured() || typeof firebase === 'undefined') return _fbApp;
  try{
    _fbApp = firebase.initializeApp(FIREBASE_CONFIG);
    _fbDb = firebase.firestore();        // d'abord Firestore (marche partout)
  }catch(e){ console.warn('initFirebase (firestore):', e); }
  try{
    if(firebase.auth){
      _fbAuth = firebase.auth();
      _fbAuth.onAuthStateChanged(u => updateAuthStatus(u));   // met à jour l'indicateur visible
    }
  }catch(e){ console.warn('initFirebase (auth):', e); }
}

// Indicateur visible (bas des Paramètres) de l'état de la session base.
let _lastAuthErr = '';
function updateAuthStatus(user){
  const el = document.getElementById('auth-status');
  if(!el) return;
  if(user){
    const who = user.email || googleEmail || localStorage.getItem('3t_google_email') || user.uid;
    el.textContent = '🔐 Base sécurisée — connecté (' + who + ')';
    el.style.color = 'var(--c3t)';
  }else{
    el.textContent = '🔓 Base : session non ouverte' + (_lastAuthErr ? ' — ' + _lastAuthErr : '');
    el.style.color = 'var(--c3tc)';
  }
}

// Ouvre une session Firebase Auth à partir du jeton Google DÉJÀ obtenu (aucune 2ᵉ connexion,
// pas de popup/redirect → fonctionne en PWA iOS). Permettra de verrouiller Firestore
// (règles `request.auth != null`). Échec silencieux → l'app continue de fonctionner.
async function firebaseSignIn(token){
  if(!token || !pushConfigured() || typeof firebase==='undefined' || !firebase.auth) return null;
  initFirebase();
  if(!_fbAuth) return null;
  try{
    if(_fbAuth.currentUser) return _fbAuth.currentUser;   // session déjà ouverte (persistée)
    if(!FORMATION_WORKER_URL){ _lastAuthErr='worker non configuré'; updateAuthStatus(null); return null; }
    // Le Worker vérifie le jeton Google et renvoie un custom token Firebase (signé clé serveur).
    const r = await fetch(FORMATION_WORKER_URL, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'firebaseToken', googleAccessToken: token })
    });
    if(!r.ok){ _lastAuthErr='worker '+r.status; updateAuthStatus(null); return null; }
    const j = await r.json().catch(()=>null);
    if(!j || !j.token){ _lastAuthErr=(j&&j.error)||'pas de jeton'; updateAuthStatus(null); return null; }
    const res = await _fbAuth.signInWithCustomToken(j.token);
    _lastAuthErr = '';
    return (res && res.user) || null;
  }catch(e){
    _lastAuthErr = (e && (e.code || e.message)) || 'échec';
    console.warn('firebaseSignIn:', e);
    updateAuthStatus(_fbAuth && _fbAuth.currentUser);
    return null;
  }
  try{
    // messaging() peut échouer sur navigateurs non supportés (ex. Safari onglet) → isolé
    _fbMessaging = firebase.messaging();
    _fbMessaging.onMessage(payload => {
      const n = (payload && payload.notification) || {};
      showNotif(n.title || '🎭 3T TECH', n.body || '', (n.tag || (payload && payload.data && payload.data.tag)));
    });
  }catch(e){ console.warn('initFirebase (messaging):', e); }
  return _fbApp;
}

// #16 — Publie le planning à venir dans Firestore (lu ensuite par le cron d'envoi).
// Toutes les dates ≥ aujourd'hui, avec pour chaque régie ses régisseurs (hors
// observateurs), tournées et annulés exclus. Tourné à chaque ouverture / refresh.
let _lastPublish = 0;
async function publishSchedule(){
  if(!pushConfigured() || !allDays.length) return;
  initFirebase();
  if(!_fbDb) return;
  if(Date.now() - _lastPublish < 60000) return;   // pas plus d'une fois/minute
  _lastPublish = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  const days = {};
  allDays.forEach(d => {
    const dt = new Date(d.date); dt.setHours(0,0,0,0);
    if(dt < today) return;
    const iso = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    (d.entries||[]).forEach(e => {
      if(e.cancelled || e.salle === 'Tournée') return;
      const regs = (e.regies||[]).filter(r => r.role !== 'observateur').map(r => r.reg);
      if(!regs.length) return;
      (days[iso] = days[iso] || []).push({ salle:e.salle, spec:e.spec||'—', h:e.h||'', regs });
    });
  });
  try{
    await _fbDb.collection('schedule').doc('v1').set({
      updatedAt: new Date().toISOString(),
      by: getMyReg() || '',
      days
    });
  }catch(e){ console.warn('publishSchedule:', e); }
}
// Récupère un jeton FCM pour cet appareil et l'enregistre dans Firestore
async function enablePush(){
  if(!pushConfigured()){ return; }
  if(isPushDisabled()){ return; }
  if(!('serviceWorker' in navigator)){ return; }
  if(Notification.permission !== 'granted'){ return; }
  initFirebase();
  if(!_fbMessaging){ return; }
  try{
    // Scope distinct pour ne pas écraser le service worker PWA (sw.js)
    const reg = await navigator.serviceWorker.register('firebase-messaging-sw.js',
      { scope: './firebase-cloud-messaging-push-scope' });
    const token = await _fbMessaging.getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg });
    if(token){
      localStorage.setItem('3t_push_token', token);
      await savePushToken(token);
    }
  }catch(e){ console.warn('enablePush:', e); }
}
// Identifiant stable de CET appareil (1 entrée par appareil → pas de doublons)
function getDeviceId(){
  let id = localStorage.getItem('3t_device_id');
  if(!id){
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
       : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem('3t_device_id', id);
  }
  return id;
}
// Enregistre / met à jour le jeton de l'appareil + le régisseur associé dans Firestore
async function savePushToken(token){
  if(!_fbDb || !token) return;
  try{
    // Migration : supprime l'éventuel ancien doc indexé par le jeton (ancien schéma)
    const prev = localStorage.getItem('3t_push_token');
    if(prev){ _fbDb.collection('pushTokens').doc(prev).delete().catch(()=>{}); }
    _fbDb.collection('pushTokens').doc(token).delete().catch(()=>{});
    // Nouveau schéma : 1 doc par appareil
    await _fbDb.collection('pushTokens').doc(getDeviceId()).set({
      token,
      reg: getMyReg() || '',
      platform: navigator.userAgent,
      prefs: getNotifPrefs(),     // #3 : types de notifs activés (le cron les respecte)
      updatedAt: new Date().toISOString()
    }, { merge:true });
  }catch(e){ console.warn('savePushToken:', e); }
}
// Si le push est déjà autorisé, on rafraîchit le jeton au démarrage (+ après changement de régisseur)
function refreshPushRegistration(){
  if(pushConfigured() && notifSupported() && Notification.permission === 'granted' && !isPushDisabled()){ enablePush(); }
}
function isPushDisabled(){ return localStorage.getItem('3t_push_disabled') === '1'; }
function notifActive(){ return notifSupported() && Notification.permission === 'granted' && !isPushDisabled(); }
function updateNotifLabel(){
  const el = document.getElementById('lbl-notif');
  const btn = document.getElementById('btn-notif');
  if(!el) return;
  if(!notifSupported()){
    el.textContent = (isIOS() && !isStandalone())
      ? '📲 Installe l\'app sur l\'écran d\'accueil pour activer les notifications'
      : 'Non supporté sur cet appareil';
    if(btn) btn.textContent = 'Activer les rappels';
    return;
  }
  let txt, btnTxt;
  if(Notification.permission === 'denied'){ txt = '🚫 Bloquées (à réautoriser dans le navigateur)'; btnTxt = 'Activer les rappels'; }
  else if(notifActive()){ txt = '✅ Activées'; btnTxt = '🔕 Désactiver les notifications'; }
  else { txt = isPushDisabled() ? '🔕 Désactivées' : 'Désactivées'; btnTxt = 'Activer les rappels'; }
  el.textContent = txt;
  if(btn) btn.textContent = btnTxt;
  renderNotifPrefs();
}

// ─── #3 Préférences de notifications (par type) ──────────────────────────────
const NOTIF_TYPES = ['regie','stop','soiree','info','formation'];
function getNotifPrefs(){
  try{ return JSON.parse(localStorage.getItem('3t_notif_prefs') || '{}'); }catch(e){ return {}; }
}
function getNotifPref(type){ const p = getNotifPrefs(); return p[type] !== false; }   // activé par défaut
function setNotifPref(type, val){
  const p = getNotifPrefs(); p[type] = !!val; localStorage.setItem('3t_notif_prefs', JSON.stringify(p));
  const tk = localStorage.getItem('3t_push_token');
  if(tk && pushConfigured()){ initFirebase(); savePushToken(tk); }   // propage au serveur (cron)
}
function renderNotifPrefs(){
  const box = document.getElementById('notif-prefs');
  if(!box) return;
  box.style.display = notifActive() ? 'block' : 'none';
  NOTIF_TYPES.forEach(t => { const c = document.getElementById('np-'+t); if(c) c.checked = getNotifPref(t); });
}
// Bouton unique : active ou désactive selon l'état
function toggleNotifications(){
  if(notifActive()){ disableNotifications(); }
  else { localStorage.removeItem('3t_push_disabled'); requestNotifications(); }
}
// Désactive : supprime le jeton FCM (plus de push) + bloque la ré-inscription auto
async function disableNotifications(){
  localStorage.setItem('3t_push_disabled', '1');
  const tk = localStorage.getItem('3t_push_token');
  try{
    if(pushConfigured()){ initFirebase(); }
    if(_fbDb){
      await _fbDb.collection('pushTokens').doc(getDeviceId()).delete().catch(()=>{});
      if(tk) await _fbDb.collection('pushTokens').doc(tk).delete().catch(()=>{}); // ancien schéma
    }
    if(_fbMessaging && _fbMessaging.deleteToken){ await _fbMessaging.deleteToken(); }
  }catch(e){ console.warn('disableNotifications:', e); }
  localStorage.removeItem('3t_push_token');
  updateNotifLabel();
  toast('🔕 Notifications désactivées', 'ok');
}
function showNotif(title, body, tag){
  const opts = { body, icon:'icon-192.png', badge:'icon-192.png', tag: tag || title };
  if(navigator.serviceWorker && navigator.serviceWorker.ready){
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts))
      .catch(()=>{ try{ new Notification(title, opts); }catch(e){} });
  } else { try{ new Notification(title, opts); }catch(e){} }
}
// Rappels pertinents quand l'app s'ouvre : ta régie aujourd'hui / demain
function checkReminders(){
  if(!notifSupported() || Notification.permission !== 'granted' || isPushDisabled()) return;
  const me = getMyReg(); if(!me || !allDays.length) return;
  const salleLbl = s => s==='3TC'?'3T Côté':s==='GT'?'Grand Théâtre':s;
  [0,1].forEach(off => {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+off);
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const day = allDays.find(x => x.date.toISOString().slice(0,10) === iso);
    if(!day) return;
    const mine = day.entries.filter(e => e.salle!=='Tournée' && !e.cancelled
      && e.regies.some(r => r.reg===me && r.role!=='observateur'));
    if(!mine.length) return;
    const key = '3t_notif_'+iso;
    if(localStorage.getItem(key)) return;       // déjà notifié pour ce jour
    localStorage.setItem(key, '1');
    const when = off===0 ? "aujourd'hui" : "demain";
    const txt = mine.map(e => `${e.spec||'—'} · ${salleLbl(e.salle)}${e.h?' '+e.h:''}`).join('\n');
    showNotif(`🎭 Régie ${when}`, txt);
  });
  // Rappel fin de mois : déclarer les heures supp (1× par mois, 3 derniers jours)
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  if(now.getDate() >= last-2){
    const key = '3t_hsupp_notif_'+now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
    if(!localStorage.getItem(key)){
      localStorage.setItem(key, '1');
      showNotif('⏱️ Heures supp', 'Fin de mois : pense à déclarer tes heures supp !', 'hsupp-rappel');
    }
  }
}

window.addEventListener('load', () => {
  // Always have a default key — no config screen on startup
  // 0) #19 — Hors-ligne au démarrage : si un cache existe, on ouvre en lecture seule
  // (avant tout appel réseau : les libs CDN comme gapi peuvent ne pas être chargées).
  if (!navigator.onLine && offlineCacheInfo() && loadOfflineCache()) {
    enterOfflineMode();
    return;
  }

  if (typeof gapi !== 'undefined') gapi.load('picker', () => {});
  refreshSavedFileLabel();
  refreshBaseLabel();

  // 1) Jeton encore valide en cache → on entre directement, sans Google.
  const cached = getCachedToken();
  if (cached) {
    accessToken = cached;
    setStatus('⏳ Chargement…');
    loginStepsShow(true); loginStepsReset(); setStep('auth','loading');
    markConnectedUI();
    onAuthenticated();
    return;
  }
  // 2) Sinon, si déjà connecté auparavant…
  if (localStorage.getItem('3t_connected') === '1') {
    if (localStorage.getItem('3t_scope_v') !== SCOPE_VERSION) {
      // Les autorisations ont changé : la reconnexion silencieuse ne donnerait
      // que les anciennes. Il faut un consentement interactif (clic utilisateur).
      setStatus('🔐 Nouvelle autorisation Google requise (écriture du planning). Clique sur « Se connecter à Google ».');
    } else {
      setStatus('⏳ Reconnexion automatique…');
      loginStepsShow(true); loginStepsReset(); setStep('auth','loading');
      // Session persistante : on tente d'abord le Worker (sans popup, marche sur iOS) ;
      // sinon ancien flux silencieux.
      (async () => {
        if (await refreshViaWorker()) { onAuthenticated(); }
        else silentRefresh();
      })();
    }
  }
});

function connectGoogle() {
  const clientId = getClientId();
  if (!clientId) return; // always has a default, this won't trigger
  loginStepsShow(true); loginStepsReset(); setStep('auth','loading');
  // Flux "code" (session persistante ~7j via le Worker) si le Worker est configuré.
  // En cas d'échec d'échange (Worker non configuré), repli automatique sur le flux implicite.
  if (FORMATION_WORKER_URL && window.google && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.initCodeClient) {
    try { initCodeClient().requestCode(); return; }
    catch (e) { console.warn('initCodeClient:', e); }
  }
  // Flux implicite (jeton 1h). Si les scopes ont changé, on force le consentement.
  const needConsent = localStorage.getItem('3t_scope_v') !== SCOPE_VERSION;
  initTokenClient().requestAccessToken(needConsent ? { prompt: 'consent' } : {});
}

function disconnectGoogle() {
  // Revoke the current token and clear the auto-connect flag + cached token
  if (accessToken && window.google && google.accounts && google.accounts.oauth2) {
    try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch (e) {}
  }
  try { if(_fbAuth && _fbAuth.currentUser) _fbAuth.signOut(); } catch(e) {}   // ferme la session Firebase Auth
  clearToken();
  localStorage.removeItem('3t_connected');
  localStorage.removeItem('3t_has_refresh');   // (le refresh token en KV expirera seul côté Worker)
  document.getElementById('btn-connect').textContent = '🔗 Se connecter à Google';
  document.getElementById('btn-connect').style.opacity = '1';
  document.getElementById('btn-disconnect').style.display = 'none';
  loginStepsShow(false);
  closeSettingsModal();
  refreshHsuppLabel();
  setStatus('Déconnecté.');
}

function setStatus(msg) {
  document.getElementById('drive-status').textContent = msg;
}

// ─── Étapes de chargement (écran de connexion) ──────────────────────────────
function loginStepsShow(on){
  const el = document.getElementById('login-steps');
  if(el) el.style.display = on ? 'block' : 'none';
}
function loginStepsReset(){
  ['auth','plan','base','hsupp'].forEach(k => setStep(k, 'pending'));
  const fill = document.getElementById('lp-fill');
  if(fill) fill.style.width = '0';
}
function setStep(key, state){
  const el = document.getElementById('step-'+key);
  if(!el) return;
  el.classList.remove('loading','done','error');
  const ico = el.querySelector('.lp-ico');
  if(state === 'loading'){ el.classList.add('loading'); ico.innerHTML = '<span class="lp-spin"></span>'; }
  else if(state === 'done'){ el.classList.add('done'); ico.textContent = '✅'; }
  else if(state === 'error'){ el.classList.add('error'); ico.textContent = '⚠️'; }
  else { ico.textContent = '○'; }
  // Progression : part des étapes terminées (done) sur le total
  const steps = document.querySelectorAll('#login-steps .lp-step');
  const done = document.querySelectorAll('#login-steps .lp-step.done, #login-steps .lp-step.error').length;
  const fill = document.getElementById('lp-fill');
  if(fill && steps.length) fill.style.width = Math.round(done / steps.length * 100) + '%';
}

// ─── Barre de chargement + toasts ────────────────────────────────────────────
let _busyCount = 0;
function showBusy(on){
  _busyCount = Math.max(0, _busyCount + (on ? 1 : -1));
  const bar = document.getElementById('topbar-loader');
  if(!bar) return;
  if(_busyCount > 0){ bar.classList.add('on'); bar.style.width = '85%'; }
  else { bar.style.width = '100%'; bar.classList.remove('on'); setTimeout(()=>{ if(_busyCount===0) bar.style.width='0'; }, 350); }
}
// Exécute une promesse en affichant la barre de chargement
async function withBusy(promise){ showBusy(true); try { return await promise; } finally { showBusy(false); } }
let _toastT = null;
function toast(msg, type){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.className = 'show ' + (type||'');
  clearTimeout(_toastT);
  _toastT = setTimeout(()=>{ el.className = el.className.replace('show','').trim(); }, 2600);
}

// ─── DRIVE PICKER ────────────────────────────────────────────────────────────
// kind : 'plan' (plan tech) ou 'base' (base heures spectacles)
function pickDriveFile(kind) {
  kind = kind || 'plan';
  if (!accessToken) { toast('Connecte-toi d\'abord à Google.', 'err'); return; }

  gapi.load('picker', () => {
    const view = new google.picker.DocsView()
      .setMimeTypes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.google-apps.spreadsheet')
      .setMode(google.picker.DocsViewMode.LIST);

    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setCallback(async (data) => {
        if (data.action !== google.picker.Action.PICKED) return;
        const file = data.docs[0];
        if (kind === 'hsupp') {
          localStorage.setItem('3t_hsupp_file_id', file.id);
          localStorage.setItem('3t_hsupp_file_name', file.name);
          localStorage.setItem('3t_hsupp_file_mime', file.mimeType);
          refreshHsuppLabel();
        } else if (kind === 'base') {
          localStorage.setItem('3t_base_file_id', file.id);
          localStorage.setItem('3t_base_file_name', file.name);
          localStorage.setItem('3t_base_file_mime', file.mimeType);
          refreshBaseLabel();
          setStatus(`⏳ Chargement base heures "${file.name}"…`);
          await loadBaseHeuresById(file.id, file.name, file.mimeType);
          // Première config (plan chargé mais pas encore entré) → on entre
          if (!appIsOpen() && planLoaded) launchApp();
        } else {
          // Save for next time
          localStorage.setItem('3t_plan_file_id', file.id);
          localStorage.setItem('3t_plan_file_name', file.name);
          localStorage.setItem('3t_plan_file_mime', file.mimeType);
          document.getElementById('btn-change-file').style.display = 'block';
          setStatus(`⏳ Chargement de "${file.name}"…`);
          await loadPlanTechById(file.id, file.name, file.mimeType);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

// Télécharge un classeur Drive (gère l'export Google Sheets) → ArrayBuffer
async function fetchDriveWorkbook(fileId, mimeType) {
  const url = (mimeType === 'application/vnd.google-apps.spreadsheet')
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (resp.status === 401) {
    // Jeton en cache expiré/révoqué → on le purge et on retente en silence
    clearToken();
    setStatus('⏳ Session expirée, reconnexion…');
    reauth();
    throw new Error('Session expirée — reconnexion en cours');
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.arrayBuffer();
}

// Métadonnées d'un fichier Drive (nom + type)
async function driveGetMeta(id){
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType&supportsAllDrives=true`,
    { headers:{ Authorization:'Bearer '+accessToken } });
  if(r.status===401){ clearToken(); reauth(); throw new Error('Session expirée'); }
  if(!r.ok) throw new Error(`Accès fichier impossible (HTTP ${r.status})`);
  return r.json();
}

// Configure plan tech + base heures depuis les IDs par défaut (si pas déjà fait)
async function ensureDefaultFiles(){
  if(!getSavedFileId() && DEFAULT_PLAN_ID){
    const m = await driveGetMeta(DEFAULT_PLAN_ID);
    localStorage.setItem('3t_plan_file_id', m.id);
    localStorage.setItem('3t_plan_file_name', m.name);
    localStorage.setItem('3t_plan_file_mime', m.mimeType);
  }
  // Base heures : on la retrouve par NOM dans le dossier Drive (commence par "Base HEURES"),
  // car son ID peut changer (ex. nouvelle année) mais pas le début de son nom.
  try {
    const b = await resolveBaseFile();
    localStorage.setItem('3t_base_file_id', b.id);
    localStorage.setItem('3t_base_file_name', b.name);
    localStorage.setItem('3t_base_file_mime', b.mimeType);
  } catch(e){
    console.warn('resolveBaseFile:', e);
    // repli : ancien ID par défaut si rien d'enregistré
    if(!getSavedBaseId() && DEFAULT_BASE_ID){
      try { const m = await driveGetMeta(DEFAULT_BASE_ID);
        localStorage.setItem('3t_base_file_id', m.id);
        localStorage.setItem('3t_base_file_name', m.name);
        localStorage.setItem('3t_base_file_mime', m.mimeType);
      } catch(_){}
    }
  }
}

// Repère le fichier heures supp du mois courant (étape de chargement, après la base)
async function resolveHsuppStep(){
  setStep('hsupp','loading');
  try {
    const h = await resolveHsuppForMonth(new Date());
    localStorage.setItem('3t_hsupp_file_id', h.id);
    localStorage.setItem('3t_hsupp_file_name', h.name);
    localStorage.setItem('3t_hsupp_file_mime', h.mimeType);
    refreshHsuppLabel();
    setStep('hsupp','done');
  } catch(e){
    console.warn('resolveHsuppForMonth:', e);
    setStep('hsupp','error');
  }
}

// Trouve le fichier base heures spectacles dans le dossier (nom commençant par "Base HEURES")
async function resolveBaseFile(){
  const files = await listHsuppFiles();
  const matches = files.filter(f => hsNorm(f.name).startsWith('BASE HEURE'));
  if(!matches.length) throw new Error("Fichier « Base HEURES… » introuvable dans le dossier Drive.");
  // S'il y en a plusieurs (ex. ancien « …Modèle » + nouveau), on prend :
  // 1) ceux qui ne sont PAS un modèle, 2) le plus récemment modifié.
  matches.sort((a,b)=>{
    const am = /MODELE/.test(hsNorm(a.name)) ? 1 : 0, bm = /MODELE/.test(hsNorm(b.name)) ? 1 : 0;
    if(am !== bm) return am - bm;                       // non-modèle d'abord
    return (b.modifiedTime||'').localeCompare(a.modifiedTime||'');  // puis plus récent
  });
  return matches[0];
}

// Trouve le fichier "HEURES <MOIS> <ANNÉE>" du mois donné dans le dossier Drive
const HS_MOIS_UP = ['JANVIER','FEVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOUT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DECEMBRE'];
function hsNorm(s){ return String(s||'').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }
async function resolveHsuppForMonth(dateObj){
  if(!HSUPP_FOLDER_ID) throw new Error("Dossier heures supp non configuré.");
  const d = dateObj || new Date();
  const mois = HS_MOIS_UP[d.getMonth()], yy = String(d.getFullYear()%100).padStart(2,'0');
  const q = encodeURIComponent(`'${HSUPP_FOLDER_ID}' in parents and trashed=false`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers:{ Authorization:'Bearer '+accessToken } });
  if(r.status===401){ clearToken(); reauth(); throw new Error('Session expirée'); }
  if(!r.ok) throw new Error(`Lecture du dossier impossible (HTTP ${r.status})`);
  const files = (await r.json()).files || [];
  const match = files.find(f => { const n=hsNorm(f.name); return n.includes('HEURE') && n.includes(mois) && n.includes(yy); })
             || files.find(f => { const n=hsNorm(f.name); return n.includes('HEURE') && n.includes(mois); });
  if(!match) throw new Error(`Aucun fichier « HEURES ${mois} ${yy} » dans le dossier Drive.`);
  return match;
}

const HS_MOIS_FULL = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
// Liste tous les fichiers du dossier heures supp
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
// Liste le contenu d'UN dossier Drive (fichiers + sous-dossiers)
async function driveListFolder(folderId){
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers:{ Authorization:'Bearer '+accessToken } });
  if(r.status===401){ clearToken(); reauth(); throw new Error('Session expirée'); }
  if(!r.ok) throw new Error(`Lecture du dossier impossible (HTTP ${r.status})`);
  return (await r.json()).files || [];
}
// Liste les fichiers heures supp : dossier principal + ses sous-dossiers (ex. "heures 25-26",
// où sont archivés les mois passés). Un seul niveau de profondeur. Renvoie les fichiers (pas les dossiers).
async function listHsuppFiles(){
  if(!HSUPP_FOLDER_ID) return [];
  const top = await driveListFolder(HSUPP_FOLDER_ID);
  const files = top.filter(f => f.mimeType !== DRIVE_FOLDER_MIME);
  for(const sub of top.filter(f => f.mimeType === DRIVE_FOLDER_MIME)){
    try{
      const inner = await driveListFolder(sub.id);
      files.push(...inner.filter(f => f.mimeType !== DRIVE_FOLDER_MIME));
    }catch(e){ console.warn('Sous-dossier heures supp illisible :', sub.name, e); }
  }
  return files;
}
// Déduit {monthIndex, year, label} du nom "HEURES <MOIS> <ANNÉE>"
function hsParseMonthYear(name){
  const n = hsNorm(name);
  if(!n.includes('HEURE')) return null;
  const monthIndex = HS_MOIS_UP.findIndex(M => n.includes(M));
  if(monthIndex < 0) return null;
  const nums = n.match(/\d{2,4}/g) || [];
  const raw = nums.length ? nums[nums.length-1] : '';
  const year = raw ? (raw.length>=4 ? parseInt(raw,10) : 2000+parseInt(raw,10)) : 0;
  return { monthIndex, year, label: `${HS_MOIS_FULL[monthIndex]} ${raw}` };
}
// Total des heures supp d'un régisseur dans un classeur (ignore STOP/TOTAL)
function sumHsuppHours(wb, reg){
  const sheetName = heuresSheetForReg(reg, wb.SheetNames);
  if(!sheetName) return 0;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, raw:true, defval:null });
  let total = 0;
  for(let i=2;i<rows.length;i++){
    const row = rows[i]||[];
    const d = (typeof row[3]==='string') ? row[3].trim() : '';
    if(/^TOTAL\b/i.test(d)) break;
    if(/STOP/i.test(d)) continue;
    const h = hsComputeHours(typeof row[1]==='number'?hmFromFrac(row[1]):'', typeof row[2]==='number'?hmFromFrac(row[2]):'');
    if(h) total += h;
  }
  return Math.round(total*100)/100;
}
// Charge les totaux par mois (asynchrone) et les injecte ; remplit aussi le cumul annuel si totalElId
async function loadRecapHsupp(reg, containerId, totalElId){
  const el = document.getElementById(containerId);
  const totEl = totalElId ? document.getElementById(totalElId) : null;
  if(!el) return;
  if(offlineMode){ el.innerHTML = '<div style="color:var(--muted);font-size:13px">📴 Heures supp indisponibles hors-ligne.</div>'; if(totEl) totEl.textContent='—'; return null; }
  try{
    const seenMonths = new Set();
    const files = (await listHsuppFiles())
      .map(f => ({ f, my: hsParseMonthYear(f.name) }))
      .filter(x => x.my)
      .sort((a,b) => (a.my.year*12+a.my.monthIndex) - (b.my.year*12+b.my.monthIndex))
      .filter(x => { const k = x.my.year*12 + x.my.monthIndex; if(seenMonths.has(k)) return false; seenMonths.add(k); return true; });
    if(!files.length){ el.innerHTML = '<div style="color:var(--muted);font-size:13px">Aucun fichier heures supp.</div>'; if(totEl) totEl.textContent='0 h'; return {total:0, byMonth:{}}; }
    let rows = '', grand = 0; const byMonth = {};
    for(const { f, my } of files){
      const ab = await fetchDriveWorkbook(f.id, f.mimeType);
      const wb = XLSX.read(ab, { type:'array' });
      const t = sumHsuppHours(wb, reg);
      grand += t;
      byMonth[`${my.year}-${String(my.monthIndex+1).padStart(2,'0')}`] = t;
      rows += `<div class="rc-row"><div class="rc-content"><span class="rc-name">${my.label}</span></div><span class="rc-count">${t} h</span></div>`;
    }
    const grandR = Math.round(grand*100)/100;
    el.innerHTML = rows +
      `<div class="rc-row" style="border-top:1px solid var(--border);margin-top:4px;padding-top:.6rem"><div class="rc-content"><span class="rc-name" style="font-weight:600">Total cumulé</span></div><span class="rc-count" style="color:var(--c3t)">${grandR} h</span></div>`;
    if(totEl) totEl.textContent = `${grandR} h`;
    return {total: grandR, byMonth};
  }catch(e){
    el.innerHTML = `<div style="color:#f87171;font-size:12px">❌ ${e.message}</div>`;
    if(totEl) totEl.textContent = '—';
    return null;
  }
}

// Date d'une ligne heures supp (colonne A). Gère n° de série Excel ou chaîne (JJ/MM/AAAA, AAAA-MM-JJ).
function hsRowDate(v){
  if(v==null || v==='') return null;
  if(typeof v==='number'){
    try{ const o = XLSX.SSF.parse_date_code(v); if(o && o.y) return new Date(o.y, o.m-1, o.d); }catch(e){}
    const d = new Date(Math.round((v-25569)*86400000));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
  if(m){ let yy=+m[3]; if(yy<100) yy+=2000; return new Date(yy, (+m[2])-1, +m[1]); }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if(m) return new Date(+m[1], (+m[2])-1, +m[3]);
  return null;
}
// Somme des heures supp d'un onglet, restreinte aux lignes dont la date est dans [start, end).
// Résout les dates implicites (ligne sans date = jour de la ligne précédente).
function sumHsuppHoursRange(wb, reg, start, end){
  const sheetName = heuresSheetForReg(reg, wb.SheetNames);
  if(!sheetName) return 0;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, raw:true, defval:null });
  let total = 0, lastDate = null;
  for(let i=2;i<rows.length;i++){
    const row = rows[i]||[];
    const d = (typeof row[3]==='string') ? row[3].trim() : '';
    if(/^TOTAL\b/i.test(d)) break;
    if(/STOP/i.test(d)) continue;
    const rd = hsRowDate(row[0]); if(rd) lastDate = rd;
    const eff = rd || lastDate;
    if(eff && (eff < start || eff >= end)) continue;   // hors fenêtre
    const h = hsComputeHours(typeof row[1]==='number'?hmFromFrac(row[1]):'', typeof row[2]==='number'?hmFromFrac(row[2]):'');
    if(h) total += h;
  }
  return Math.round(total*100)/100;
}
// Comme loadRecapHsupp mais bornée à la fenêtre [start, end) (mois pleins → somme entière,
// mois de bordure → somme au jour près). Utilisée pour l'intermittence calée sur l'anniversaire.
async function loadRecapHsuppRange(reg, start, end, containerId, totalElId){
  const el = document.getElementById(containerId);
  const totEl = totalElId ? document.getElementById(totalElId) : null;
  if(!el) return;
  if(offlineMode){ el.innerHTML = '<div style="color:var(--muted);font-size:13px">📴 Heures supp indisponibles hors-ligne.</div>'; if(totEl) totEl.textContent='—'; return null; }
  const endIncl = new Date(end.getTime()-1);
  try{
    const seenMonths = new Set();
    const files = (await listHsuppFiles())
      .map(f => ({ f, my: hsParseMonthYear(f.name) }))
      .filter(x => x.my)
      .sort((a,b) => (a.my.year*12+a.my.monthIndex) - (b.my.year*12+b.my.monthIndex))
      .filter(x => { const k = x.my.year*12 + x.my.monthIndex; if(seenMonths.has(k)) return false; seenMonths.add(k); return true; })
      // ne garder que les mois qui chevauchent la fenêtre
      .filter(x => {
        const mFirst = new Date(x.my.year, x.my.monthIndex, 1);
        const mLast  = new Date(x.my.year, x.my.monthIndex+1, 0);
        return !(mLast < start || mFirst >= end);
      });
    if(!files.length){ el.innerHTML = '<div style="color:var(--muted);font-size:13px">Aucune heure supp sur la période.</div>'; if(totEl) totEl.textContent='0 h'; return {total:0, byMonth:{}}; }
    let rows = '', grand = 0; const byMonth = {};
    for(const { f, my } of files){
      const ab = await fetchDriveWorkbook(f.id, f.mimeType);
      const wb = XLSX.read(ab, { type:'array' });
      const mFirst = new Date(my.year, my.monthIndex, 1);
      const mLast  = new Date(my.year, my.monthIndex+1, 0);
      const full = (mFirst >= start && mLast <= endIncl);   // mois entièrement dans la fenêtre
      const t = full ? sumHsuppHours(wb, reg) : sumHsuppHoursRange(wb, reg, start, end);
      grand += t;
      byMonth[`${my.year}-${String(my.monthIndex+1).padStart(2,'0')}`] = t;
      rows += `<div class="rc-row"><div class="rc-content"><span class="rc-name">${my.label}${full?'':' <span style="color:var(--muted);font-size:11px">(partiel)</span>'}</span></div><span class="rc-count">${t} h</span></div>`;
    }
    const grandR = Math.round(grand*100)/100;
    el.innerHTML = rows +
      `<div class="rc-row" style="border-top:1px solid var(--border);margin-top:4px;padding-top:.6rem"><div class="rc-content"><span class="rc-name" style="font-weight:600">Total période</span></div><span class="rc-count" style="color:var(--c3t)">${grandR} h</span></div>`;
    if(totEl) totEl.textContent = `${grandR} h`;
    return {total: grandR, byMonth};
  }catch(e){
    el.innerHTML = `<div style="color:#f87171;font-size:12px">❌ ${e.message}</div>`;
    if(totEl) totEl.textContent = '—';
    return null;
  }
}

async function loadBaseHeuresById(fileId, fileName, mimeType) {
  try {
    const arrayBuffer = await fetchDriveWorkbook(fileId, mimeType);
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    baseHeures = parseBaseHeures(wb);
    baseHeuresLoaded = Object.keys(baseHeures).length > 0;
    refreshBaseLabel();
    setStep('base', baseHeuresLoaded ? 'done' : 'error');
    setStatus(`✅ Base heures chargée (${Object.keys(baseHeures).length} spectacles)`);
    applyGuestBaseOverride();   // orange + dans la base = vraie pièce
    if (appIsOpen()) renderCalendar(); // rafraîchit les heures si déjà dans l'app
  } catch(err) {
    console.error('Base heures:', err);
    setStep('base','error');
    refreshBaseLabel('❌ Erreur base heures');
  }
}

function refreshBaseLabel(override) {
  const lbl = document.getElementById('lbl-base');
  if (!lbl) return;
  if (override) { lbl.textContent = override; return; }
  const name = getSavedBaseName();
  const btn = document.getElementById('btn-change-base');
  if (name) {
    const n = Object.keys(baseHeures).length;
    lbl.textContent = baseHeuresLoaded
      ? `✅ ${name} (${n} spectacles)`
      : `📄 ${name}`;
    if (btn) btn.style.display = 'block';
  } else {
    lbl.textContent = '';
    if (btn) btn.style.display = 'none';
  }
}

function forgetBaseHeures() {
  localStorage.removeItem('3t_base_file_id');
  localStorage.removeItem('3t_base_file_name');
  localStorage.removeItem('3t_base_file_mime');
  baseHeures = {}; baseHeuresLoaded = false;
  refreshBaseLabel();
}

async function loadPlanTechById(fileId, fileName, mimeType) {
  try {
    const arrayBuffer = await fetchDriveWorkbook(fileId, mimeType);
    ({struck:struckCells, guest:guestCells} = await parseCellStyles(arrayBuffer)); // annulés (barrés) + invités (orange)
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const p = parsePlanTech(wb);
    allDays = p.days; allMois = p.mois; allRegs = p.regs;
    planLoaded = true;
    setStep('plan','done');
    setStatus(`✅ "${fileName}" chargé`);
    // Étape suivante : s'assurer que la base heures est chargée avant d'entrer
    afterPlanLoaded();
  } catch(err) {
    setStep('plan','error');
    console.error(err);
    // #19 — chargement Drive impossible mais un cache existe → mode hors-ligne
    if(!appIsOpen() && offlineCacheInfo() && loadOfflineCache()){
      loginStepsShow(false);
      enterOfflineMode();
      return;
    }
    setStatus('❌ Erreur de chargement — ' + err.message);
  }
}

// Après chargement du plan : charge la base heures puis entre / rafraîchit
async function afterPlanLoaded() {
  // Si on change le plan alors qu'on est déjà dans l'app → simple rafraîchissement
  if (appIsOpen()) {
    refreshBaseLabel(); refreshSavedFileLabel();
    populateSelects();
    renderCalendar();
    return;
  }
  const baseId = getSavedBaseId();
  if (baseId) {
    // Base déjà configurée → on la (re)charge puis on entre
    if (!baseHeuresLoaded) {
      setStatus(`⏳ Chargement base heures "${getSavedBaseName()}"…`);
      setStep('base','loading');
      await loadBaseHeuresById(baseId, getSavedBaseName(), getSavedBaseMime());
    } else { setStep('base','done'); applyGuestBaseOverride(); }
    // Dernière étape : repérage du fichier heures supp du mois
    await resolveHsuppStep();
    launchApp();
  } else {
    // Aucune base configurée → on attend que l'utilisateur la choisisse
    await resolveHsuppStep();
    promptBaseStep();
  }
}

// Met en avant la sélection de la base heures (modal ouvert)
function promptBaseStep() {
  openSettingsModal();
  document.getElementById('btn-base-continue').style.display = 'block';
  document.getElementById('btn-enter-app').style.display = 'none';
  setStatus('📊 Choisis le fichier base heures pour activer le calcul des heures (ou continue sans).');
}

function launchApp() {
  closeSettingsModal();
  if (appIsOpen()) return; // déjà lancée
  document.getElementById('upload-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';
  populateSelects();
  switchView(currentView);   // vue par défaut = « Ma semaine »
  requestAnimationFrame(updateStickyOffsets);
  // Première utilisation : pas encore de régisseur associé → on demande
  if (!getMyReg() && allRegs.length) openProfileModal();
  // Rappels (notifications locales) si déjà autorisées
  checkReminders();
  // #16 — (ré)enregistre l'appareil pour le push si déjà autorisé
  refreshPushRegistration();
  // #16 — publie le planning à venir pour le cron d'envoi
  publishSchedule();
  // #4 — charge les formations partagées (Firestore)
  loadFormations();
  // #19 — met en cache le planning pour la consultation hors-ligne
  saveOfflineCache();
  // #16 — si on arrive via le clic d'une notif (#today), aller à la régie du jour
  handleNotifNav();
}

// ─── #19 MODE HORS-LIGNE (consultation sans réseau) ──────────────────────────
let offlineMode = false;
// Sauvegarde le planning parsé (plan + base) pour pouvoir consulter sans réseau.
function saveOfflineCache(){
  if(offlineMode || !planLoaded || !allDays.length) return;
  try{
    localStorage.setItem('3t_offline_cache', JSON.stringify({
      t: Date.now(),
      allMois, allRegs, baseHeures, baseHeuresLoaded,
      struck: [...struckCells], guest: [...guestCells],
      days: allDays.map(d => ({ date: d.date.toISOString(), jour: d.jour, entries: d.entries }))
    }));
  }catch(e){ console.warn('saveOfflineCache:', e); }
}
function offlineCacheInfo(){
  try{ const d = JSON.parse(localStorage.getItem('3t_offline_cache')||'null'); return d ? new Date(d.t) : null; }
  catch(e){ return null; }
}
// Restaure les données depuis le cache → renvoie true si OK
function loadOfflineCache(){
  try{
    const data = JSON.parse(localStorage.getItem('3t_offline_cache')||'null');
    if(!data || !data.days) return false;
    allMois = data.allMois || [];
    allRegs = data.allRegs || [];
    baseHeures = data.baseHeures || {};
    baseHeuresLoaded = !!data.baseHeuresLoaded;
    struckCells = new Set(data.struck || []);
    guestCells = new Set(data.guest || []);
    allDays = (data.days || []).map(d => ({ date: new Date(d.date), jour: d.jour, entries: d.entries }));
    planLoaded = true;
    return true;
  }catch(e){ console.warn('loadOfflineCache:', e); return false; }
}
// Ouvre l'app en lecture seule depuis le cache
function enterOfflineMode(){
  offlineMode = true;
  document.getElementById('upload-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';
  showOfflineBanner(true);
  populateSelects();
  switchView(currentView);
  requestAnimationFrame(updateStickyOffsets);
  if (!getMyReg() && allRegs.length) openProfileModal();
}
function showOfflineBanner(on){
  const b = document.getElementById('offline-banner');
  if(b) b.style.display = on ? 'flex' : 'none';
  document.body.classList.toggle('is-offline', !!on);
}
// Bloque une action d'écriture quand on est hors-ligne
function blockIfOffline(){
  if(offlineMode){ toast('📴 Hors-ligne — reconnecte-toi pour modifier', 'err'); return true; }
  return false;
}
// Bascule en cours de session
window.addEventListener('offline', () => { if(appIsOpen()){ offlineMode = true; showOfflineBanner(true); } });
window.addEventListener('online', () => {
  if(!appIsOpen()) return;
  if(accessToken){ offlineMode = false; showOfflineBanner(false); }   // la session reprend
  else { const s = document.querySelector('#offline-banner span'); if(s) s.textContent = '🌐 Connexion revenue — recharge pour modifier'; }
});

// Clic sur la notif « régie demain » (lien #today) → accueil, aujourd'hui, régie du jour
function handleNotifNav(){
  const hash = location.hash;
  const fmMatch = hash.match(/^#f-(\d{4}-\d{2}-\d{2})$/);
  if(hash !== '#today' && hash !== '#soiree' && !fmMatch) return;
  // nettoie le hash pour ne pas re-déclencher au prochain rafraîchissement
  try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
  if(!appIsOpen()) return;
  if(fmMatch){
    // Clic sur une notif de formation : on RECHARGE d'abord les formations
    // (le collègue vient peut-être de la proposer) puis on va à la date proposée.
    const iso = fmMatch[1];
    Promise.resolve(typeof loadFormations==='function' ? loadFormations() : null)
      .catch(()=>{})
      .finally(()=> gotoDate(iso));
    return;
  }
  if(hash === '#soiree'){ openSoiree(); return; }
  if(typeof switchView === 'function') switchView('grid');
  goToday();   // mois courant + jour = aujourd'hui + rendu
  setTimeout(() => {
    const el = document.getElementById('today-card-wrap') || document.getElementById('stats');
    if(el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 250);
}
// App déjà ouverte et menée vers #today/#soiree par le clic de notif
window.addEventListener('hashchange', handleNotifNav);

// ─── #2 BILAN DE SOIRÉE → message WhatsApp ───────────────────────────────────
// Spectacles (non tournée, non annulés) programmés aujourd'hui, toute l'équipe.
function todaySpectacles(){
  const t = new Date(); t.setHours(0,0,0,0);
  const iso = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  const day = allDays.find(x => x.date.toISOString().slice(0,10) === iso);
  if(!day) return [];
  const seen = new Set(), out = [];
  (day.entries||[]).forEach(e => {
    if(e.salle === 'Tournée' || e.cancelled) return;
    const n = e.spec || '';
    if(n && !seen.has(n)){ seen.add(n); out.push(n); }
  });
  return out;
}
// MES spectacles du jour (régies où JE suis positionné, hors observateur/tournée/annulé)
function myTodaySpectacles(){
  const me = myRegName();
  const t = new Date(); t.setHours(0,0,0,0);
  const iso = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  const day = allDays.find(x => x.date.toISOString().slice(0,10) === iso);
  if(!day) return [];
  const seen = new Set(), out = [];
  (day.entries||[]).forEach(e => {
    if(e.salle === 'Tournée' || e.cancelled) return;
    const mine = (e.regies||[]).some(r => r.reg === me && r.role !== 'observateur');
    if(!mine) return;
    const n = e.spec || '';
    if(n && !seen.has(n)){ seen.add(n); out.push(n); }
  });
  return out;
}
// Variantes de messages courts pour un spectacle
function soireeMessages(spec){
  return [
    `Bonne soirée pour ${spec}!`,
    `Carton pour ${spec}!`,
    `Très bonne soirée pour ${spec}!`,
    `Belle soirée pour ${spec}!`,
    `Excellente soirée pour ${spec}!`,
  ];
}
function waOpen(msg){
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}
// Tous les noms de spectacles connus (hors tournée/annulés)
function allSpecNames(){
  const set = new Set();
  allDays.forEach(d => (d.entries||[]).forEach(e => { if(e.salle!=='Tournée' && !e.cancelled && e.spec) set.add(e.spec); }));
  return [...set].sort((a,b)=>a.localeCompare(b,'fr'));
}
// Affiche les 5 messages pour le spectacle choisi
function renderSoireeMessages(spec){
  const box = document.getElementById('soiree-msgs');
  if(!box) return;
  if(!spec){ box.innerHTML = ''; return; }
  box.innerHTML = soireeMessages(spec).map(m =>
    `<button class="soiree-msg" onclick="waOpen('${m.replace(/'/g,"\\'")}')">${m} <span class="wa">› WhatsApp</span></button>`).join('');
}
function openSoiree(){
  // On part directement de MA régie du jour — pas de sélection à faire.
  const mine = myTodaySpectacles();
  const body = document.getElementById('soiree-body');
  if(!mine.length){
    // Pas de régie aujourd'hui → message sympa, rien à envoyer.
    body.innerHTML = `<div class="soiree-empty">
      <div class="se-emoji">🎭</div>
      <div class="se-title">Tu n'as pas de régie aujourd'hui</div>
      <div class="se-sub">Pas besoin d'envoyer un message à Gégé 😄<br>Reviens quand tu auras fini une régie.</div>
    </div>`;
  } else if(mine.length === 1){
    // Une seule régie → on affiche direct les messages pour ce spectacle.
    body.innerHTML = `<div class="soiree-spec">${mine[0]}</div><div id="soiree-msgs"></div>`;
    renderSoireeMessages(mine[0]);
  } else {
    // Plusieurs régies aujourd'hui → petit choix entre elles uniquement.
    body.innerHTML = `<label class="file-label">Ta régie du jour</label>
      <select id="soiree-spec-select" class="fm-input" onchange="renderSoireeMessages(this.value)" style="margin-bottom:.7rem">
        ${mine.map(s=>`<option value="${s.replace(/"/g,'&quot;')}">${s}</option>`).join('')}
      </select>
      <div id="soiree-msgs"></div>`;
    renderSoireeMessages(mine[0]);
  }
  document.getElementById('soiree-modal').style.display = 'flex';
}
function closeSoiree(){ document.getElementById('soiree-modal').style.display = 'none'; }

// ─── #4 FORMATIONS (proposées par les régisseurs, partagées via Firestore) ───
let _formations = {};   // iso "YYYY-MM-DD" -> [ {id, date, time, subject, by, participants:[]} ]
function isoOf(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function isoToday(){ const d=new Date(); d.setHours(0,0,0,0); return isoOf(d); }

async function loadFormations(){
  if(!pushConfigured()) return;
  initFirebase();
  if(!_fbDb) return;
  try{
    const snap = await _fbDb.collection('formations').get();
    _formations = {};
    snap.forEach(doc => {
      const d = doc.data(); if(!d.date) return;
      (_formations[d.date] = _formations[d.date] || []).push({ id:doc.id, date:d.date, time:d.time||'', subject:d.subject||'', by:d.by||'', participants:d.participants||[] });
    });
    if(appIsOpen()) renderCalendar();
  }catch(e){ console.warn('loadFormations:', e); }
}

async function submitFormation(){
  if(blockIfOffline()) return;
  const date = document.getElementById('fm-date').value;
  const h = document.getElementById('fm-h').value, mn = document.getElementById('fm-m').value;
  const time = (h && mn) ? `${h}:${mn}` : (h ? `${h}:00` : '');
  const subject = document.getElementById('fm-subject').value.trim();
  const err = document.getElementById('fm-error');
  if(!date || !subject){ if(err) err.textContent = 'Date et sujet obligatoires.'; return; }
  if(!pushConfigured()){ if(err) err.textContent = 'Configuration manquante.'; return; }
  initFirebase();
  if(!_fbDb){ if(err) err.textContent = 'Connexion requise.'; return; }
  const me = myRegName() || getMyReg() || '';
  try{
    showBusy(true);
    const ref = await _fbDb.collection('formations').add({
      date, time, subject, by: me, participants: [],   // le créateur ne se positionne pas (il propose)
      createdAt: new Date().toISOString(), notified: false
    });
    notifyFormationNow(ref.id);   // push instantané via le Worker (cron = filet de secours)
    await loadFormations();
    closeFormationModal();
    toast('📚 Formation proposée', 'ok');
  }catch(e){ if(err) err.textContent = e.message; }
  finally{ showBusy(false); }
}

// Déclenche la notif instantanée (Worker Cloudflare). Best-effort, ne bloque pas l'UI.
function notifyFormationNow(id){
  if(!FORMATION_WORKER_URL || !id) return;
  try{
    fetch(FORMATION_WORKER_URL, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id })
    }).catch(()=>{});   // en cas d'échec, le cron GitHub enverra plus tard
  }catch(e){}
}

// Push instantané générique à toute l'équipe (réunion confirmée, nouvelle note…)
// via le Worker. opts : {url, tag, pref, excludeReg}. Échec silencieux.
async function notifyAll(title, bodyText, opts){
  opts = opts || {};
  if(!FORMATION_WORKER_URL || !bodyText) return;
  try{
    const user = await ensureFirebaseReady();
    if(!user) return;
    const idToken = await user.getIdToken();
    await fetch(FORMATION_WORKER_URL, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'notify', firebaseIdToken: idToken,
        title, body: bodyText, url: opts.url || '', tag: opts.tag || 'info',
        pref: opts.pref || '', excludeReg: opts.excludeReg || '' })
    });
  }catch(e){ console.warn('notifyAll:', e); }
}

async function toggleFormation(id){
  if(blockIfOffline()) return;
  const me = myRegName() || getMyReg() || '';
  if(!me){ openProfileModal(); return; }
  initFirebase();
  if(!_fbDb) return;
  try{
    showBusy(true);
    const ref = _fbDb.collection('formations').doc(id);
    const doc = await ref.get(); if(!doc.exists) return;
    if(doc.data().by === me){ toast('Vous proposez cette formation', 'err'); return; }  // le créateur ne se positionne pas
    const parts = doc.data().participants || [];
    const FV = firebase.firestore.FieldValue;
    await ref.update({ participants: parts.includes(me) ? FV.arrayRemove(me) : FV.arrayUnion(me) });
    await loadFormations();
  }catch(e){ toast('❌ ' + e.message, 'err'); }
  finally{ showBusy(false); }
}

async function deleteFormation(id){
  if(blockIfOffline()) return;
  if(!confirm('Supprimer cette formation ?')) return;
  initFirebase(); if(!_fbDb) return;
  try{ showBusy(true); await _fbDb.collection('formations').doc(id).delete(); await loadFormations(); toast('🗑️ Formation supprimée','ok'); }
  catch(e){ toast('❌ '+e.message,'err'); } finally{ showBusy(false); }
}

// HTML des formations d'un jour (carte + participants + bouton participer)
function formationCardsHTML(iso){
  const list = _formations[iso] || [];
  if(!list.length) return '';
  const me = myRegName() || getMyReg() || '';
  return list.map(f => {
    const parts = f.participants || [];
    const iIn = parts.includes(me);
    const isOwner = f.by && f.by===me;
    // Le créateur propose la formation : il ne se positionne pas dessus.
    const btn = isOwner
      ? `<span class="fm-owner">Vous avez proposé cette formation</span>`
      : `<button class="fm-join${iIn?' in':''}" onclick="toggleFormation('${safeId(f.id)}')">${iIn?'✓ J\'y vais':'+ Je participe'}</button>`;
    const del = isOwner ? `<button class="fm-del" onclick="deleteFormation('${safeId(f.id)}')" title="Supprimer">🗑️</button>` : '';
    const who = parts.length ? parts.map(escapeHtml).join(', ') : 'Personne pour l\'instant';
    return `<div class="fm-card">
      <div class="fm-top"><span class="fm-title">📚 ${escapeHtml(f.subject)}</span>${f.time?`<span class="fm-time">${escapeHtml(f.time)}</span>`:''}</div>
      <div class="fm-sub">Proposé par ${f.by?escapeHtml(f.by):'—'} · ${parts.length} participant${parts.length>1?'s':''}</div>
      <div class="fm-parts">${who}</div>
      <div class="fm-actions">${btn}${del}</div>
    </div>`;
  }).join('');
}

function openFormationModal(iso){
  const d = iso || (selectedDay ? `${document.getElementById('mois-select').value}-${String(selectedDay).padStart(2,'0')}` : isoToday());
  document.getElementById('fm-date').value = d;
  // Heure (00–23) + quart d'heure (00/15/30/45)
  const hSel = document.getElementById('fm-h'), mSel = document.getElementById('fm-m');
  let hOpts = '<option value="">-- h --</option>'; for(let h=0;h<24;h++){ const v=String(h).padStart(2,'0'); hOpts += `<option value="${v}">${v}h</option>`; }
  hSel.innerHTML = hOpts;
  mSel.innerHTML = '<option value="">-- min --</option>' + ['00','15','30','45'].map(m=>`<option value="${m}">${m}</option>`).join('');
  document.getElementById('fm-subject').value = '';
  document.getElementById('fm-error').textContent = '';
  document.getElementById('formation-modal').style.display = 'flex';
}
function closeFormationModal(){ document.getElementById('formation-modal').style.display = 'none'; }

// ─── RÉUNION PLANNING (Framadate : créneaux partagés + dispos) ───────────────
let _meetingSlots = [];
async function loadMeetingSlots(){
  if(!pushConfigured()) return;
  initFirebase();
  if(!_fbDb) return;
  try{
    const snap = await _fbDb.collection('meetingSlots').get();
    _meetingSlots = [];
    snap.forEach(doc => {
      const d = doc.data();
      _meetingSlots.push({ id:doc.id, date:d.date||'', time:d.time||'', by:d.by||'', available:d.available||[], chosen:d.chosen===true });
    });
    _meetingSlots.sort((a,b)=> (a.date+a.time).localeCompare(b.date+b.time));
    renderMeetingSlots();
  }catch(e){ console.warn('loadMeetingSlots:', e); }
}
function openMeeting(){
  // Remplit les selects heure (00–23) + quart d'heure (00/15/30/45)
  const hSel = document.getElementById('mt-h'), mSel = document.getElementById('mt-m');
  let hOpts = '<option value="">-- h --</option>'; for(let h=0;h<24;h++){ const v=String(h).padStart(2,'0'); hOpts += `<option value="${v}">${v}h</option>`; }
  hSel.innerHTML = hOpts;
  mSel.innerHTML = '<option value="">-- min --</option>' + ['00','15','30','45'].map(m=>`<option value="${m}">${m}</option>`).join('');
  document.getElementById('mt-date').value = isoToday();
  document.getElementById('mt-error').textContent = '';
  document.getElementById('meeting-list').innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:1rem">Chargement…</div>';
  document.getElementById('meeting-modal').style.display = 'flex';
  loadMeetingSlots();
}
function closeMeeting(){ document.getElementById('meeting-modal').style.display = 'none'; }

async function submitMeetingSlot(){
  if(blockIfOffline()) return;
  const date = document.getElementById('mt-date').value;
  const h = document.getElementById('mt-h').value, mn = document.getElementById('mt-m').value;
  const time = (h && mn) ? `${h}:${mn}` : (h ? `${h}:00` : '');
  const err = document.getElementById('mt-error');
  if(!date){ if(err) err.textContent = 'Choisis une date.'; return; }
  if(!time){ if(err) err.textContent = 'Choisis une heure (au quart d\'heure).'; return; }
  if(!pushConfigured()){ if(err) err.textContent = 'Configuration manquante.'; return; }
  initFirebase();
  if(!_fbDb){ if(err) err.textContent = 'Connexion requise.'; return; }
  if(_meetingSlots.some(s => s.date===date && s.time===time)){ if(err) err.textContent = 'Ce créneau existe déjà.'; return; }
  const me = myRegName() || getMyReg() || '';
  try{
    showBusy(true);
    await _fbDb.collection('meetingSlots').add({
      date, time, by: me, available: me ? [me] : [], createdAt: new Date().toISOString()
    });
    await loadMeetingSlots();
    if(err) err.textContent = '';
    toast('🗓️ Créneau ajouté', 'ok');
  }catch(e){ if(err) err.textContent = e.message; }
  finally{ showBusy(false); }
}

async function toggleMeetingAvail(id){
  if(blockIfOffline()) return;
  const me = myRegName() || getMyReg() || '';
  if(!me){ openProfileModal(); return; }
  initFirebase();
  if(!_fbDb) return;
  try{
    showBusy(true);
    const ref = _fbDb.collection('meetingSlots').doc(id);
    const doc = await ref.get(); if(!doc.exists) return;
    const av = doc.data().available || [];
    const FV = firebase.firestore.FieldValue;
    await ref.update({ available: av.includes(me) ? FV.arrayRemove(me) : FV.arrayUnion(me) });
    await loadMeetingSlots();
  }catch(e){ toast('❌ ' + e.message, 'err'); }
  finally{ showBusy(false); }
}

async function deleteMeetingSlot(id){
  if(blockIfOffline()) return;
  if(!confirm('Supprimer ce créneau ?')) return;
  initFirebase(); if(!_fbDb) return;
  try{ showBusy(true); await _fbDb.collection('meetingSlots').doc(id).delete(); await loadMeetingSlots(); toast('🗑️ Créneau supprimé','ok'); }
  catch(e){ toast('❌ '+e.message,'err'); } finally{ showBusy(false); }
}

// Marque un créneau comme retenu (réunion confirmée) : un seul à la fois, puis
// prévient toute l'équipe par notification.
async function chooseMeetingSlot(id){
  if(blockIfOffline()) return;
  const me = myRegName() || getMyReg() || '';
  initFirebase(); if(!_fbDb) return;
  const slot = _meetingSlots.find(s => s.id === id);
  if(!slot) return;
  try{
    showBusy(true);
    // Un seul créneau retenu : on enlève le flag des autres, on le met sur celui-ci.
    const batch = _fbDb.batch();
    _meetingSlots.forEach(s => {
      if(s.chosen && s.id !== id) batch.update(_fbDb.collection('meetingSlots').doc(s.id), { chosen:false });
    });
    batch.update(_fbDb.collection('meetingSlots').doc(id), { chosen:true });
    await batch.commit();
    await loadMeetingSlots();
    toast('✅ Réunion confirmée', 'ok');
    const d = slot.date ? new Date(slot.date+'T00:00:00') : null;
    const jourStr = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
    const moisStr = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
    const lbl = d ? `${jourStr[d.getDay()]} ${d.getDate()} ${moisStr[d.getMonth()]}` : slot.date;
    notifyAll('🗓️ Réunion confirmée',
      `${lbl}${slot.time?' à '+slot.time:''} (par ${me||'—'})`,
      { pref:'info', tag:'meeting', url:'' });
  }catch(e){ toast('❌ '+e.message,'err'); }
  finally{ showBusy(false); }
}
// Annule le choix (revient au sondage).
async function unchooseMeetingSlot(id){
  if(blockIfOffline()) return;
  initFirebase(); if(!_fbDb) return;
  try{
    showBusy(true);
    await _fbDb.collection('meetingSlots').doc(id).update({ chosen:false });
    await loadMeetingSlots();
    toast('Choix annulé', 'ok');
  }catch(e){ toast('❌ '+e.message,'err'); }
  finally{ showBusy(false); }
}

function renderMeetingSlots(){
  const box = document.getElementById('meeting-list');
  if(!box) return;
  const today = isoToday();
  // On n'affiche que les créneaux à venir (auto-nettoyage d'un mois sur l'autre).
  const slots = _meetingSlots.filter(s => s.date >= today);
  if(!slots.length){
    box.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:1.2rem">Aucun créneau à venir.<br>Ajoute le premier ci-dessus 👆</div>';
    return;
  }
  const me = myRegName() || getMyReg() || '';
  const maxV = Math.max(...slots.map(s => (s.available||[]).length));
  const jourStr = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
  const moisStr = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  // Le créneau retenu (réunion confirmée) remonte en tête.
  slots.sort((a,b) => (b.chosen?1:0)-(a.chosen?1:0) || (a.date+a.time).localeCompare(b.date+b.time));
  box.innerHTML = slots.map(s => {
    const av = s.available || [];
    const iIn = av.includes(me);
    const isBest = !s.chosen && maxV > 0 && av.length === maxV;
    const d = s.date ? new Date(s.date+'T00:00:00') : null;
    const dateLbl = d ? `${jourStr[d.getDay()]} ${d.getDate()} ${moisStr[d.getMonth()]}` : escapeHtml(s.date);
    const who = av.length ? av.map(escapeHtml).join(', ') : 'Personne pour l\'instant';
    const del = (s.by && s.by===me) ? `<button class="mt-del" onclick="deleteMeetingSlot('${safeId(s.id)}')" title="Supprimer">🗑️</button>` : '';
    const chooseBtn = me ? (s.chosen
      ? `<button class="mt-join" onclick="unchooseMeetingSlot('${safeId(s.id)}')">↩︎ Annuler le choix</button>`
      : `<button class="mt-join" onclick="chooseMeetingSlot('${safeId(s.id)}')">✓ Retenir ce créneau</button>`) : '';
    const badge = s.chosen
      ? '<span class="mt-best-badge" style="background:var(--c3t)">✅ Confirmé</span>'
      : (isBest ? '<span class="mt-best-badge">★ top</span>' : '');
    return `<div class="mt-card${isBest?' best':''}"${s.chosen?' style="border-color:var(--c3t);box-shadow:0 0 0 1.5px var(--c3t)"':''}>
      <div class="mt-top">
        <span class="mt-when">${dateLbl}${s.time?` · ${escapeHtml(s.time)}`:''}${badge}</span>
        <span class="mt-count">✓ ${av.length}</span>
      </div>
      <div class="mt-who">${who}</div>
      <div class="mt-actions">
        <button class="mt-join${iIn?' in':''}" onclick="toggleMeetingAvail('${safeId(s.id)}')">${iIn?'✓ Je suis dispo':'+ Je suis dispo'}</button>
        ${chooseBtn}
        ${del}
      </div>
    </div>`;
  }).join('');
}

// ─── NOTES PARTAGÉES (chaque régisseur écrit, tout le monde voit · Firestore) ───
let _notes = [];
async function loadNotes(){
  if(!pushConfigured()) return;
  initFirebase();
  if(!_fbDb) return;
  try{
    const snap = await _fbDb.collection('notes').get();
    _notes = [];
    snap.forEach(doc => {
      const d = doc.data();
      _notes.push({ id:doc.id, text:d.text||'', by:d.by||'', createdAt:d.createdAt||'' });
    });
    _notes.sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||''));   // plus récente en haut
    renderNotes();
  }catch(e){ console.warn('loadNotes:', e); }
}
function openNotes(){
  document.getElementById('note-text').value = '';
  document.getElementById('note-error').textContent = '';
  document.getElementById('notes-list').innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:1rem">Chargement…</div>';
  document.getElementById('notes-modal').style.display = 'flex';
  loadNotes();
}
function closeNotes(){ document.getElementById('notes-modal').style.display = 'none'; }

async function submitNote(){
  if(blockIfOffline()) return;
  const text = document.getElementById('note-text').value.trim();
  const err = document.getElementById('note-error');
  if(!text){ if(err) err.textContent = 'Écris quelque chose d\'abord.'; return; }
  if(!pushConfigured()){ if(err) err.textContent = 'Configuration manquante.'; return; }
  initFirebase();
  if(!_fbDb){ if(err) err.textContent = 'Connexion requise.'; return; }
  const me = myRegName() || getMyReg() || '';
  try{
    showBusy(true);
    await _fbDb.collection('notes').add({ text, by: me, createdAt: new Date().toISOString() });
    document.getElementById('note-text').value = '';
    if(err) err.textContent = '';
    await loadNotes();
    // Prévient les autres (respecte la préférence « info », pas l'auteur)
    notifyAll('📝 Nouvelle note de ' + (me || '—'), text.slice(0, 120),
      { pref:'info', excludeReg: me, tag:'note', url:'' });
    toast('📝 Note publiée', 'ok');
  }catch(e){ if(err) err.textContent = e.message; }
  finally{ showBusy(false); }
}

async function deleteNote(id){
  if(blockIfOffline()) return;
  if(!confirm('Supprimer cette note ?')) return;
  initFirebase(); if(!_fbDb) return;
  try{ showBusy(true); await _fbDb.collection('notes').doc(id).delete(); await loadNotes(); toast('🗑️ Note supprimée','ok'); }
  catch(e){ toast('❌ '+e.message,'err'); } finally{ showBusy(false); }
}

// Échappement HTML pour tout contenu venant de Firestore (notes/formations/réunions/profils).
// Empêche l'injection de balises (XSS stocké) au rendu en innerHTML.
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}
// Identifiant Firestore réutilisé dans un onclick='...(id)...' : on le réduit au jeu de
// caractères des auto-id (A-Z a-z 0-9 _ -) pour éviter toute évasion de chaîne JS.
function safeId(id){ return String(id==null?'':id).replace(/[^A-Za-z0-9_-]/g,''); }

function renderNotes(){
  const box = document.getElementById('notes-list');
  if(!box) return;
  if(!_notes.length){
    box.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:1.2rem">Aucune note pour l\'instant.<br>Écris la première 👆</div>';
    return;
  }
  const me = myRegName() || getMyReg() || '';
  box.innerHTML = _notes.map(n => {
    let when = '';
    if(n.createdAt){ const d = new Date(n.createdAt); if(!isNaN(d)) when = d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}) + ' ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); }
    const del = (n.by && n.by===me) ? `<button class="note-del" onclick="deleteNote('${safeId(n.id)}')" title="Supprimer">🗑️</button>` : '';
    const esc = escapeHtml(n.text);
    return `<div class="note-card">
      <div class="note-head"><span class="note-who">${n.by?escapeHtml(n.by):'—'}</span><span style="display:flex;align-items:center;gap:6px"><span class="note-date">${when}</span>${del}</span></div>
      <div class="note-body">${esc}</div>
    </div>`;
  }).join('');
}

// Ouvre une date précise (ex. via notif de formation) dans la grille
function gotoDate(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
  const mk = iso.slice(0,7);
  const sel = document.getElementById('mois-select');
  if([...sel.options].some(o=>o.value===mk)){ sel.value = mk; }
  if(typeof switchView==='function') switchView('grid');
  selectedDay = parseInt(iso.slice(8,10),10);
  renderCalendar();
  setTimeout(()=>{ const el=document.getElementById('detail-panel'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }, 200);
}

// ─── PROFIL LOCAL (régisseur + avatar emoji) ─────────────────────────────────
const EMOJI_CHOICES = ['😎','🎭','🎬','🎤','🎸','🥁','🎧','🔦','⚡','🛠️','🚀','🦊','🐺','🐱','🦁','🐻','🦉','🐧','🌟','🔥','💡','🎯','🍀','👑'];
function getMyReg(){ return localStorage.getItem('3t_my_reg') || ''; }
function getMyEmoji(){ return localStorage.getItem('3t_my_emoji') || ''; }
function getMyAnniv(){ return localStorage.getItem('3t_anniv') || ''; }  // date anniversaire intermittence (YYYY-MM-DD)

// ─── Identité Google + profil partagé (sync multi-appareils) ──────────────────
// Email du compte connecté via l'API Drive « about » (scope drive déjà accordé,
// donc aucun re-consentement nécessaire).
async function fetchGoogleIdentity(){
  if(!accessToken) return null;
  const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers:{ Authorization:'Bearer '+accessToken }
  });
  if(!r.ok) return null;
  const j = await r.json();
  const u = j && j.user;
  if(!u || !u.emailAddress) return null;
  return { email: String(u.emailAddress).trim().toLowerCase(), name: u.displayName || '' };
}
// Charge le profil (régisseur/emoji/anniv) associé à l'email depuis Firestore et
// l'écrit en localStorage (le reste de l'app continue de lire localStorage).
async function loadProfileForEmail(email){
  if(!email || !pushConfigured()) return null;
  try{
    initFirebase();
    if(!_fbDb) return null;
    const doc = await _fbDb.collection('profiles').doc(email).get();
    if(!doc.exists) return null;
    const d = doc.data() || {};
    if(d.reg)   localStorage.setItem('3t_my_reg', d.reg);
    if(d.emoji) localStorage.setItem('3t_my_emoji', d.emoji);
    if(typeof d.anniv === 'string'){
      if(d.anniv) localStorage.setItem('3t_anniv', d.anniv);
      else localStorage.removeItem('3t_anniv');
    }
    return d;
  }catch(e){ console.warn('loadProfileForEmail:', e); return null; }
}
// Sauvegarde le profil courant dans Firestore (clé = email). Fire-and-forget.
function saveProfileToCloud(){
  if(!googleEmail || !pushConfigured()) return;
  try{
    initFirebase();
    if(!_fbDb) return;
    const FV = firebase.firestore.FieldValue;
    _fbDb.collection('profiles').doc(googleEmail).set({
      email: googleEmail,
      name:  localStorage.getItem('3t_google_name') || '',
      reg:   getMyReg(),
      emoji: getMyEmoji(),
      anniv: getMyAnniv(),
      updatedAt: FV.serverTimestamp()
    }, { merge:true }).catch(e=>console.warn('saveProfileToCloud:', e));
  }catch(e){ console.warn('saveProfileToCloud:', e); }
}

// Avatar affiché pour un régisseur donné : emoji perso si c'est moi, sinon initiales
function avatarFor(reg){
  if (reg && reg === getMyReg() && getMyEmoji()) return getMyEmoji();
  return (reg || '').slice(0,2).toUpperCase();
}
function updateAvatar(){
  const reg = getCurrentReg();
  const av = avatarFor(reg);
  const a1 = document.getElementById('reg-avatar'); if(a1) a1.textContent = av;
  const a2 = document.getElementById('hdr-reg-avatar'); if(a2) a2.textContent = av;
  const nm = document.getElementById('hdr-reg-name'); if(nm) nm.textContent = reg || '';
}

let pendingEmoji = '';
function openProfileModal(){
  const sel = document.getElementById('profile-reg');
  sel.innerHTML = allRegs.map(r=>`<option value="${r}">${r}</option>`).join('');
  sel.value = getMyReg() || getCurrentReg() || allRegs[0] || '';
  pendingEmoji = getMyEmoji() || '';
  document.getElementById('emoji-custom').value = '';
  const grid = document.getElementById('emoji-grid');
  grid.innerHTML = EMOJI_CHOICES.map(e=>
    `<div class="emoji-opt${e===pendingEmoji?' sel':''}" onclick="pickEmoji('${e}')">${e}</div>`
  ).join('');
  // Date anniversaire = jour + mois seulement (pas d'année). Stockée au format MM-DD.
  const dSel = document.getElementById('profile-anniv-d'), mSel = document.getElementById('profile-anniv-m');
  if(dSel && mSel){
    const cur = parseAnnivMD(getMyAnniv());   // {m, d} ou null
    dSel.innerHTML = '<option value="">— jour —</option>' +
      Array.from({length:31}, (_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
    mSel.innerHTML = '<option value="">— mois —</option>' +
      _MOIS_FR.map((nm,i)=>`<option value="${i+1}">${nm.charAt(0).toUpperCase()+nm.slice(1)}</option>`).join('');
    dSel.value = cur ? String(cur.d) : '';
    mSel.value = cur ? String(cur.m) : '';
  }
  document.getElementById('profile-modal').style.display = 'flex';
}
// Extrait {m, d} d'une date anniversaire stockée (MM-DD ou ancien YYYY-MM-DD). Année ignorée.
function parseAnnivMD(s){
  const a = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec(String(s||'').trim());
  if(!a) return null;
  const m = +a[1], d = +a[2];
  if(m<1||m>12||d<1||d>31) return null;
  return { m, d };
}
function pickEmoji(e){
  pendingEmoji = e;
  document.getElementById('emoji-custom').value = '';
  document.querySelectorAll('#emoji-grid .emoji-opt').forEach(el=>
    el.classList.toggle('sel', el.textContent === e));
}
function closeProfileModal(){
  document.getElementById('profile-modal').style.display = 'none';
}
function saveProfile(){
  const reg = document.getElementById('profile-reg').value;
  const custom = document.getElementById('emoji-custom').value.trim();
  const emoji = custom || pendingEmoji;
  // Date anniversaire jour/mois (format MM-DD), sans année
  const dV = +(document.getElementById('profile-anniv-d')?.value || 0);
  const mV = +(document.getElementById('profile-anniv-m')?.value || 0);
  const anniv = (dV>=1 && dV<=31 && mV>=1 && mV<=12)
    ? `${String(mV).padStart(2,'0')}-${String(dV).padStart(2,'0')}` : '';
  if (reg) localStorage.setItem('3t_my_reg', reg);
  if (emoji) localStorage.setItem('3t_my_emoji', emoji);
  if (anniv) localStorage.setItem('3t_anniv', anniv); else localStorage.removeItem('3t_anniv');
  // Propage le profil au cloud (clé = email) → retrouvé sur tous les appareils
  saveProfileToCloud();
  closeProfileModal();
  updateProfileLabel();
  // #16 — réassocie le jeton push au nouveau régisseur (si push déjà activé)
  const tk = localStorage.getItem('3t_push_token');
  if (tk && pushConfigured()){ initFirebase(); savePushToken(tk); }
  // Mises à jour de l'app seulement si elle est déjà ouverte
  if (appIsOpen()) {
    if (reg){
      const sel = document.getElementById('reg-select');
      if ([...sel.options].some(o=>o.value===reg)){ sel.value = reg; }
      document.getElementById('team-toggle').checked = false;
    }
    updateAvatar();
    renderCalendar();
  }
}

// ─── INTERMITTENCE — récap annuel personnel ──────────────────────────────────
const OBJECTIF_HEURES = 507;

// Agrège les heures/régies de TOUTE la saison pour un régisseur
function computeSeason(reg){
  const t = {hours:0, montage:0, demontage:0, duree:0, service:0,
             regies:0, tournees:0, months:[], specs:{}, unmatched:new Set(), guests:new Set()};
  allMois.forEach(mo=>{
    const [y,m] = mo.k.split('-').map(Number);
    const dayMap = buildDayMap(reg, y, m);
    const h = computeHeures(dayMap);
    let nT = 0;
    Object.values(dayMap).forEach(es=>es.forEach(e=>{ if(e.salle==='Tournée') nT++; }));
    t.hours+=h.total; t.montage+=h.montage; t.demontage+=h.demontage;
    t.duree+=h.duree; t.service+=h.service; t.regies+=h.nbRegies; t.tournees+=nT;
    h.unmatched.forEach(u=>t.unmatched.add(u));
    h.guests.forEach(u=>t.guests.add(u));
    Object.entries(h.specs).forEach(([k,v])=>{
      if(!t.specs[k]) t.specs[k]={count:0,hours:0,salle:v.salle};
      t.specs[k].count+=v.count; t.specs[k].hours+=v.hours;
    });
    t.months.push({k:mo.k, label:mo.l, hours:Math.round(h.total*100)/100, regies:h.nbRegies, tournees:nT});
  });
  ['hours','montage','demontage','duree','service'].forEach(k=>t[k]=Math.round(t[k]*100)/100);
  t.unmatched=[...t.unmatched];
  t.guests=[...t.guests];
  return t;
}

// Fenêtre de 12 mois à partir de la date anniversaire d'intermittence (jour/mois, sans année).
// start = dernière occurrence du jour/mois anniversaire ≤ aujourd'hui ; end = start + 1 an (exclu).
function annivWindow(annivStr, ref){
  ref = ref || new Date();
  const md = parseAnnivMD(annivStr);                  // {m, d} depuis MM-DD (ou ancien YYYY-MM-DD)
  if(!md) return null;
  const am = md.m, ad = md.d;                          // mois (1-12) et jour de l'anniversaire
  let start = new Date(ref.getFullYear(), am-1, ad);
  if(start > ref) start = new Date(ref.getFullYear()-1, am-1, ad);   // pas encore passé cette année
  const end = new Date(start.getFullYear()+1, start.getMonth(), start.getDate());
  return { start, end };
}

// Agrège les heures/régies sur une fenêtre [start, end) au JOUR près (pour l'intermittence).
function computeWindow(reg, start, end){
  const t = {hours:0, montage:0, demontage:0, duree:0, service:0,
             regies:0, tournees:0, months:[], specs:{}, unmatched:new Set(), guests:new Set()};
  const labelByK = {}; (allMois||[]).forEach(mo=>{ labelByK[mo.k]=mo.l; });
  const endIncl = new Date(end.getTime()-1);          // dernier jour inclus
  let y = start.getFullYear(), m = start.getMonth()+1;
  while(y < endIncl.getFullYear() || (y===endIncl.getFullYear() && m <= endIncl.getMonth()+1)){
    const full = buildDayMap(reg, y, m);
    // Filtrage au jour près : on ne garde que les jours dans [start, end)
    const dayMap = {};
    Object.keys(full).forEach(d=>{
      const date = new Date(y, m-1, Number(d));
      if(date>=start && date<end) dayMap[d]=full[d];
    });
    const h = computeHeures(dayMap);
    let nT = 0;
    Object.values(dayMap).forEach(es=>es.forEach(e=>{ if(e.salle==='Tournée') nT++; }));
    t.hours+=h.total; t.montage+=h.montage; t.demontage+=h.demontage;
    t.duree+=h.duree; t.service+=h.service; t.regies+=h.nbRegies; t.tournees+=nT;
    h.unmatched.forEach(u=>t.unmatched.add(u));
    h.guests.forEach(u=>t.guests.add(u));
    Object.entries(h.specs).forEach(([k,v])=>{
      if(!t.specs[k]) t.specs[k]={count:0,hours:0,salle:v.salle};
      t.specs[k].count+=v.count; t.specs[k].hours+=v.hours;
    });
    const k = `${y}-${String(m).padStart(2,'0')}`;
    const label = labelByK[k] || `${_MOIS_FR[m-1]} ${y}`;
    t.months.push({k, label, hours:Math.round(h.total*100)/100, regies:h.nbRegies, tournees:nT});
    m++; if(m>12){ m=1; y++; }
  }
  ['hours','montage','demontage','duree','service'].forEach(k=>t[k]=Math.round(t[k]*100)/100);
  t.unmatched=[...t.unmatched];
  t.guests=[...t.guests];
  return t;
}

// Couverture du calcul d'heures sur TOUT le théâtre (tous régisseurs, toute la saison) :
// quels spectacles sont calculables (présents dans la base), lesquels manquent, lesquels sont invités.
function computeCoverage(){
  const calc = {}, unmatched = {}, guests = {}, hsupp = {};
  allDays.forEach(d => (d.entries||[]).forEach(e => {
    if(e.salle === 'Tournée' || e.cancelled) return;
    const name = e.spec || '—';
    if(e.guest){ guests[name] = (guests[name]||0)+1; return; }
    if(matchBaseSpec(e.spec)){ calc[name] = (calc[name]||0)+1; }
    else if(isHsuppSpec(e.spec)){ hsupp[name] = (hsupp[name]||0)+1; }
    else { unmatched[name] = (unmatched[name]||0)+1; }
  }));
  const sortNames = o => Object.keys(o).sort((a,b)=>a.localeCompare(b,'fr'));
  return { calc: sortNames(calc), unmatched: sortNames(unmatched), guests: sortNames(guests), hsupp: sortNames(hsupp) };
}

function openIntermittence(){
  const reg = getMyReg() || getCurrentReg() || '';
  // Période : si une date anniversaire est renseignée → 12 mois glissants au jour près ;
  // sinon → repli sur toute la saison du plan tech (comportement historique).
  const anniv = getMyAnniv();
  const win = anniv ? annivWindow(anniv) : null;
  const s = win ? computeWindow(reg, win.start, win.end) : computeSeason(reg);
  const who = `${getMyEmoji()?getMyEmoji()+' ':''}${reg||'—'}`;
  const fmtD = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  const periodLabel = win
    ? `${fmtD(win.start)} → ${fmtD(new Date(win.end.getTime()-86400000))}`
    : (allMois.length ? `${allMois[0].l} → ${allMois[allMois.length-1].l}` : '');
  const periodKind = win ? 'Année intermittence' : 'Saison';
  const pct = Math.min(100, Math.round((s.hours/OBJECTIF_HEURES)*100));
  const reste = Math.max(0, Math.round((OBJECTIF_HEURES - s.hours)*100)/100);
  const gaugeColor = pct>=100 ? 'var(--c3t)' : pct>=66 ? '#facc15' : 'var(--c3tc)';

  const baseWarn = !baseHeuresLoaded
    ? `<div style="background:#fb923c12;border:1px solid #fb923c33;border-radius:8px;padding:.6rem .7rem;margin-bottom:1rem;font-size:12px;color:var(--c3tc)">⚠️ Base heures non chargée — les heures affichées sont à 0. Charge le fichier base dans ⚙️ Paramètres.</div>`
    : `<div style="font-size:11px;color:var(--muted);margin-bottom:1rem">⚠️ Estimation approximative — partie encore en développement.</div>`;

  // Pas de date anniversaire → on invite à en ajouter une (sinon calcul sur toute la saison).
  const annivPrompt = win ? '' :
    `<div style="background:var(--surface2);border:1px solid var(--c3t);border-radius:8px;padding:.75rem .8rem;margin-bottom:1rem;font-size:12.5px;color:var(--text);line-height:1.5">
       📅 Tu n'as pas fixé ta <b>date anniversaire d'intermittence</b> : la jauge est calculée sur toute la saison du plan.
       Ajoute-la pour un calcul sur <b>12 mois glissants</b>.
       <button onclick="closeIntermittence(); openProfileModal()" style="display:block;margin-top:.55rem;background:var(--c3t);color:var(--bg);border:none;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Ajouter ma date d'anniversaire</button>
     </div>`;

  // Lignes par mois (total = heures spectacles + heures supp). Rendu initial = mois du plan ;
  // après lecture des heures supp, la liste est reconstruite (fusion plan + mois avec supp).
  _intermiMonths = s.months;
  const monthRows = monthRowsHTML(s.months, {});

  // Lignes par spectacle (top)
  const specRows = Object.entries(s.specs).sort((a,b)=>b[1].hours-a[1].hours).map(([n,d])=>{
    const sl = d.salle==='3TC'?'3T Côté':d.salle==='GT'?'Grand Théâtre':d.salle;
    return `<div class="intermi-row">
      <span class="intermi-label">${n} <span style="color:var(--muted)">· ${d.count}× ${sl}</span></span>
      <span class="intermi-val">${Math.round(d.hours*100)/100}h</span>
    </div>`;
  }).join('') || '<div style="color:var(--muted);font-size:13px">—</div>';

  const unm = s.guests.length
    ? `<div style="margin-top:.6rem;font-size:11px;color:var(--cguest)">🎤 Artistes invités (hors calcul) : ${s.guests.join(', ')}</div>` : '';

  // Couverture du calcul d'heures (tout le théâtre)
  const cov = computeCoverage();
  const covList = (arr, color) => `<div style="font-size:12px;color:${color};margin:.2rem 0 .8rem;line-height:1.5">${arr.length ? arr.join(' · ') : '—'}</div>`;
  const coverageBlock = `
    <details class="intermi-block" style="margin-bottom:1rem">
      <summary style="font-size:12px;color:var(--muted);cursor:pointer;text-transform:uppercase;letter-spacing:.6px;list-style:none">Couverture du calcul d'heures (tout le théâtre) ▾</summary>
      <div style="margin-top:.75rem">
        <div class="intermi-row"><span class="intermi-label" style="color:var(--c3t)">✅ Calculables (dans la base)</span><span class="intermi-val">${cov.calc.length}</span></div>
        ${covList(cov.calc, 'var(--muted)')}
        <div class="intermi-row"><span class="intermi-label" style="color:var(--c3tc)">❌ Non trouvés dans la base</span><span class="intermi-val">${cov.unmatched.length}</span></div>
        ${covList(cov.unmatched, 'var(--c3tc)')}
        <div class="intermi-row"><span class="intermi-label" style="color:#a78bfa">💼 Comptés en heures supp</span><span class="intermi-val">${cov.hsupp.length}</span></div>
        ${covList(cov.hsupp, '#a78bfa')}
        <div class="intermi-row"><span class="intermi-label" style="color:var(--cguest)">🎤 Invités (exclus du calcul)</span><span class="intermi-val">${cov.guests.length}</span></div>
        ${covList(cov.guests, 'var(--cguest)')}
        <div style="font-size:11px;color:var(--muted)">Les « non trouvés » sont à ajouter dans le fichier base heures. Les « 💼 comptés en heures supp » sont normaux (leurs heures viennent de tes déclarations d'heures supp, pas de la base).</div>
      </div>
    </details>`;

  document.getElementById('intermittence-body').innerHTML = `
    <div class="modal-sub" style="margin-bottom:1.25rem">${who} · ${periodKind} ${periodLabel}</div>

    ${annivPrompt}

    <!-- Jauge 507h (spectacles + heures supp) -->
    <div class="intermi-block">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.25rem">
        <span id="intermi-gauge-hours" style="font-size:30px;font-weight:600;font-family:'DM Mono',monospace">${s.hours}h</span>
        <span style="font-size:13px;color:var(--muted)">/ ${OBJECTIF_HEURES}h</span>
      </div>
      <div class="progress-track" style="height:12px"><div class="progress-fill" id="intermi-gauge-fill" style="height:12px;width:${pct}%;background:${gaugeColor}"></div></div>
      <div class="progress-label"><span id="intermi-gauge-pct">${pct}%</span><span id="intermi-gauge-reste">${reste>0?`reste ${reste}h`:'objectif atteint 🎉'}</span></div>
      <div style="font-size:11px;color:var(--muted);margin-top:.4rem">${s.hours}h spectacles <span id="intermi-gauge-supp">+ … h supp</span></div>
    </div>

    <!-- Totaux saison -->
    <div class="intermi-block">
      <div class="intermi-row"><span class="intermi-label">Total régies</span><span class="intermi-val">${s.regies}</span></div>
      <div class="intermi-row"><span class="intermi-label">Total tournées</span><span class="intermi-val">${s.tournees}</span></div>
      <div class="intermi-row"><span class="intermi-label">Total heures supp (année)</span><span class="intermi-val" id="intermi-hs-total" style="color:var(--c3t)">⏳</span></div>
      <div class="intermi-row"><span class="intermi-label">Montages</span><span class="intermi-val">${s.montage}h</span></div>
      <div class="intermi-row"><span class="intermi-label">Durées spectacles</span><span class="intermi-val">${s.duree}h</span></div>
      <div class="intermi-row"><span class="intermi-label">Démontages</span><span class="intermi-val">${s.demontage}h</span></div>
      <div class="intermi-row" style="margin-bottom:0"><span class="intermi-label">Services (1h/régie)</span><span class="intermi-val">${s.service}h</span></div>
    </div>

    <!-- Détail par mois -->
    <div class="intermi-block"><div style="font-size:12px;color:var(--muted);margin-bottom:.75rem;text-transform:uppercase;letter-spacing:.6px">Par mois · heures spectacles + supp</div><div id="intermi-months">${monthRows}</div></div>

    <!-- Heures supplémentaires (lues depuis le dossier Drive) -->
    <div class="intermi-block">
      <div style="font-size:12px;color:var(--muted);margin-bottom:.75rem;text-transform:uppercase;letter-spacing:.6px">⏱️ Heures supplémentaires</div>
      <div id="intermi-hsupp"><div style="font-size:13px;color:var(--muted)">⏳ Lecture des fichiers heures…</div></div>
    </div>

    <!-- Détail par spectacle -->
    <details class="intermi-block" style="margin-bottom:1rem">
      <summary style="font-size:12px;color:var(--muted);cursor:pointer;text-transform:uppercase;letter-spacing:.6px;list-style:none">Par spectacle ▾</summary>
      <div style="margin-top:.75rem">${specRows}${unm}</div>
    </details>

    ${coverageBlock}

    ${baseWarn}`;

  document.getElementById('intermittence-modal').style.display = 'flex';
  // Charge les heures supp (async) puis recalcule la jauge + le total par mois.
  // Fenêtrées sur l'année anniversaire si renseignée, sinon toute la saison.
  const hsuppLoader = win
    ? loadRecapHsuppRange(reg, win.start, win.end, 'intermi-hsupp', 'intermi-hs-total')
    : loadRecapHsupp(reg, 'intermi-hsupp', 'intermi-hs-total');
  hsuppLoader.then(res => {
    if(!res) return;                          // erreur de lecture → on garde les heures spectacles seules
    updateIntermiGauge(s.hours, res.total);
    updateIntermiMonths(res.byMonth || {});
  });
}

// Met à jour les lignes « Par mois » : total = heures spectacles + heures supp du mois
let _intermiMonths = [];
const _MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
// Construit les lignes « Par mois » en fusionnant les mois du plan et les mois ayant des heures supp.
function monthRowsHTML(months, byMonth){
  const map = {};
  (months||[]).forEach(m => { map[m.k] = { k:m.k, label:m.label, spec:m.hours, reg:m.regies }; });
  Object.keys(byMonth||{}).forEach(k => {
    if(!map[k]){ const [y,mm] = k.split('-'); map[k] = { k, label:`${_MOIS_FR[(+mm)-1]} ${y}`, spec:0, reg:0 }; }
  });
  const r2 = x => Math.round(x*100)/100;
  const rows = Object.values(map)
    .filter(m => m.spec>0 || m.reg>0 || (byMonth[m.k]||0)>0)
    .sort((a,b) => a.k.localeCompare(b.k))
    .map(m => {
      const spec = r2(m.spec), supp = r2(byMonth[m.k] || 0), total = r2(spec + supp);
      const parts = [];
      if(m.reg>0 || spec>0) parts.push(`régie ${spec}h (${m.reg})`);
      if(supp>0) parts.push(`supp ${supp}h`);
      return `<div class="intermi-row" style="flex-direction:column;align-items:stretch;gap:2px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="intermi-label" style="text-transform:capitalize">${m.label}</span>
          <span class="intermi-val">${total}h</span>
        </div>
        <div style="font-size:11px;color:var(--muted);font-weight:400">${parts.join(' · ')}</div>
      </div>`;
    }).join('');
  return rows || '<div style="color:var(--muted);font-size:13px">Aucune donnée cette saison</div>';
}
// Reconstruit « Par mois » une fois les heures supp lues
function updateIntermiMonths(byMonth){
  const cont = document.getElementById('intermi-months');
  if(cont) cont.innerHTML = monthRowsHTML(_intermiMonths, byMonth || {});
}

// Met à jour la jauge 507h avec le total combiné (heures spectacles + heures supp)
function updateIntermiGauge(specHours, hsuppHours){
  const total = Math.round((specHours + hsuppHours) * 100) / 100;
  const pct = Math.min(100, Math.round((total / OBJECTIF_HEURES) * 100));
  const reste = Math.max(0, Math.round((OBJECTIF_HEURES - total) * 100) / 100);
  const color = pct>=100 ? 'var(--c3t)' : pct>=66 ? '#facc15' : 'var(--c3tc)';
  const set = (id, fn) => { const el = document.getElementById(id); if(el) fn(el); };
  set('intermi-gauge-hours', el => el.textContent = `${total}h`);
  set('intermi-gauge-fill',  el => { el.style.width = pct+'%'; el.style.background = color; });
  set('intermi-gauge-pct',   el => el.textContent = pct+'%');
  set('intermi-gauge-reste', el => el.textContent = reste>0 ? `reste ${reste}h` : 'objectif atteint 🎉');
  set('intermi-gauge-supp',  el => el.textContent = `+ ${Math.round(hsuppHours*100)/100}h supp`);
}

function closeIntermittence(){
  document.getElementById('intermittence-modal').style.display = 'none';
}

// ─── AIDE / MODE D'EMPLOI ───────────────────────────────────────────────────
function openHelp(){
  const m = document.getElementById('help-modal');
  m.style.display = 'flex';
  const card = document.getElementById('help-card');
  if(card) card.scrollTop = 0;
}
function closeHelp(){
  document.getElementById('help-modal').style.display = 'none';
}
function helpJump(id){
  const el = document.getElementById(id);
  if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
}
function helpTop(){
  const card = document.getElementById('help-card');
  if(card) card.scrollTo({top:0, behavior:'smooth'});
}

// ─── RÉGIES NON ATTRIBUÉES (détail au clic sur la fiche jaune) ───────────────
function showUnassigned(){
  const mk = document.getElementById('mois-select').value;
  const [y, m] = mk.split('-').map(Number);
  const teamMap = buildTeamDayMap(y, m);
  const jourStr = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const moisStr = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const salleLabelOf = s => s==='3TC'?'3T Côté':s==='GT'?'Grand Théâtre':s;
  const salleColor = {'3T':'var(--c3t)','3TC':'var(--c3tc)','GT':'var(--cgt)','Tournée':'var(--ctour)'};
  const nbDays = new Date(y, m, 0).getDate();
  const rows = [];
  for(let d=1; d<=nbDays; d++){
    (teamMap[d]||[]).forEach(e => {
      if(!e.unassigned || e.cancelled) return;
      const dow = new Date(y, m-1, d).getDay();
      rows.push({ d, dateLabel: `${jourStr[dow]} ${d}`, salle: e.salle, spec: e.spec || '—', h: e.h || '' });
    });
  }
  const sub = document.getElementById('unassigned-sub');
  const body = document.getElementById('unassigned-body');
  sub.textContent = `${moisStr[m-1]} ${y} · ${rows.length} régie${rows.length>1?'s':''} à pourvoir`;
  if(rows.length === 0){
    body.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:.5rem 0">Toutes les régies de ce mois sont attribuées 🎉</div>';
  } else {
    body.innerHTML = rows.map(r =>
      `<div class="ua-row" onclick="gotoUnassigned(${r.d})">
        <span class="ua-date">${r.dateLabel}</span>
        <span class="ua-salle" style="--uac:${salleColor[r.salle]||'var(--muted)'}">${salleLabelOf(r.salle)}${r.h?' · '+r.h:''}</span>
        <span class="ua-spec">${r.spec}</span>
      </div>`
    ).join('');
  }
  document.getElementById('unassigned-modal').style.display = 'flex';
}
function closeUnassigned(){
  document.getElementById('unassigned-modal').style.display = 'none';
}
// Clic sur une ligne → ferme la modale et ouvre le jour concerné dans la grille
function gotoUnassigned(d){
  closeUnassigned();
  if(currentView !== 'grid'){ switchView('grid'); }
  selectedDay = d;
  renderCalendar();
  const cell = document.querySelectorAll('#cal-grid .cal-cell:not(.empty)')[d-1];
  if(cell) cell.scrollIntoView({block:'center', behavior:'smooth'});
}

// ─── CONFLITS D'HORAIRE (détail au clic sur la fiche rouge) ──────────────────
function showConflicts(){
  const mk = document.getElementById('mois-select').value;
  const [y, m] = mk.split('-').map(Number);
  const conflicts = computeConflicts(y, m);
  const jourStr = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const moisStr = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const salleLabelOf = s => s==='3TC'?'3T Côté':s==='GT'?'Grand Théâtre':s;
  const salleColor = {'3T':'var(--c3t)','3TC':'var(--c3tc)','GT':'var(--cgt)','Tournée':'var(--ctour)'};
  const sub = document.getElementById('conflict-sub');
  const body = document.getElementById('conflict-body');
  sub.textContent = `${moisStr[m-1]} ${y} · ${conflicts.length} conflit${conflicts.length>1?'s':''} (même régisseur, 2 salles à la même heure)`;
  if(conflicts.length === 0){
    body.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:.5rem 0">Aucun conflit d\'horaire ce mois 👍</div>';
  } else {
    body.innerHTML = conflicts.map(c => {
      const dow = new Date(y, m-1, c.d).getDay();
      const lignes = c.items.map(i =>
        `<div class="ua-salle" style="--uac:${salleColor[i.salle]||'var(--muted)'};margin-top:2px">${salleLabelOf(i.salle)} · ${i.spec}</div>`
      ).join('');
      return `<div class="ua-row" onclick="gotoUnassigned(${c.d})" style="flex-direction:column;align-items:stretch;gap:3px">
        <div style="display:flex;align-items:baseline;gap:8px">
          <span class="ua-date">${jourStr[dow]} ${c.d}</span>
          <span class="uc-reg">${c.reg}</span>
          <span style="font-size:12px;color:var(--muted2)">à ${c.h}</span>
        </div>
        ${lignes}
      </div>`;
    }).join('');
  }
  document.getElementById('conflict-modal').style.display = 'flex';
}
function closeConflicts(){
  document.getElementById('conflict-modal').style.display = 'none';
}

// ─── RÉCAP RÉGISSEUR : tous les spectacles connus du régisseur (saison) ───────
function openRegRecap(){
  const reg = getCurrentReg() || getMyReg() || '';
  const map = new Map();
  let nReg = 0, nTour = 0;
  allDays.forEach(d => d.entries.forEach(e => {
    if(!(e.regies||[]).some(r => r.reg === reg && r.role !== 'observateur')) return;
    if(e.salle === 'Tournée') nTour++;
    else if(!e.cancelled) nReg++;
    const key = norm(e.spec || '—');
    if(!map.has(key)) map.set(key, {display:e.spec||'—', guest:!!e.guest, tournee:e.salle==='Tournée', salle:e.salle, count:0, cancelled:0});
    const o = map.get(key); o.count++; if(e.cancelled) o.cancelled++;
  }));
  const all = [...map.values()];
  const salleLabelOf = s => s==='3TC'?'3T Côté':s==='GT'?'Grand Théâtre':s==='Tournée'?'Tournée':s;
  const salleColor = {'3T':'var(--c3t)','3TC':'var(--c3tc)','GT':'var(--cgt)','Tournée':'var(--ctour)'};
  const maxCount = Math.max(1, ...all.map(s=>s.count));
  const rowFor = s => {
    const col = s.guest ? 'var(--cguest)' : (salleColor[s.salle]||'var(--cgt)');
    const tag = s.guest ? 'Invité' : salleLabelOf(s.salle);
    const cx  = s.cancelled ? ` · ${s.cancelled} annulé${s.cancelled>1?'s':''}` : '';
    const pct = Math.round((s.count/maxCount)*100);
    return `<div class="rc-row">
      <div class="rc-bar" style="width:${pct}%;background:${col}"></div>
      <div class="rc-content">
        <span class="rc-name">${s.display}</span>
        <span class="rc-meta"><span class="rc-tag" style="color:${col};border-color:${col}55">${tag}</span>${cx}</span>
      </div>
      <span class="rc-count">${s.count}<span style="opacity:.5">×</span></span>
    </div>`;
  };
  const theatre = all.filter(s=>!s.guest && !s.tournee).sort((a,b)=>b.count-a.count);
  const guests  = all.filter(s=>s.guest).sort((a,b)=>b.count-a.count);
  const tours   = all.filter(s=>s.tournee).sort((a,b)=>b.count-a.count);
  const saison = allMois.length ? `${allMois[0].l} → ${allMois[allMois.length-1].l}` : '';
  const initials = (reg||'—').slice(0,2).toUpperCase();
  const avatar = getMyEmoji() && reg===getMyReg() ? getMyEmoji() : initials;

  let body = `
    <div class="rc-header">
      <div class="rc-avatar">${avatar}</div>
      <div>
        <div class="rc-who">${reg||'—'}</div>
        <div class="rc-season">${saison ? 'Saison '+saison : ''}</div>
      </div>
    </div>
    <div class="rc-stats">
      <div class="rc-stat"><div class="rc-stat-v">${theatre.length+guests.length}</div><div class="rc-stat-l">Spectacles</div></div>
      <div class="rc-stat"><div class="rc-stat-v">${nReg}</div><div class="rc-stat-l">Régies</div></div>
      <div class="rc-stat"><div class="rc-stat-v">${nTour}</div><div class="rc-stat-l">Tournées</div></div>
    </div>`;
  const section = (icon, title, list) => list.length
    ? `<div class="rc-group">${icon} ${title} <span class="rc-group-n">${list.length}</span></div>` + list.map(rowFor).join('')
    : '';
  body += section('🎭','Spectacles', theatre);
  body += section('🎤','Artistes invités', guests);
  body += section('🚐','Tournées', tours);
  if(!all.length) body += `<div style="color:var(--muted);font-size:13px;padding:1.5rem 0;text-align:center">Aucun spectacle trouvé pour ${reg||'ce régisseur'}.</div>`;

  // Heures supp par mois (lu depuis le dossier Drive, chargé en différé)
  body += `<div class="rc-group">⏱️ Heures supplémentaires</div>`
        + `<div id="recap-hsupp"><div style="color:var(--muted);font-size:13px">⏳ Lecture des fichiers heures…</div></div>`;

  document.getElementById('recap-title').textContent = 'Récapitulatif';
  document.getElementById('recap-body').innerHTML = body;
  document.getElementById('recap-modal').style.display = 'flex';
  loadRecapHsupp(reg, 'recap-hsupp');
}
function closeRegRecap(){
  document.getElementById('recap-modal').style.display = 'none';
}

// ─── HEURES SUPP : formulaire ────────────────────────────────────────────────
function refreshHsuppLabel(){
  const lbl = document.getElementById('lbl-hsupp');
  if(lbl) lbl.textContent = getSavedHsuppName() ? `📄 ${getSavedHsuppName()}` : '';
  const btn = document.getElementById('btn-change-hsupp');
  if(btn) btn.style.display = getSavedHsuppName() ? 'block' : 'none';
}
function forgetHsupp(){
  localStorage.removeItem('3t_hsupp_file_id');
  localStorage.removeItem('3t_hsupp_file_name');
  localStorage.removeItem('3t_hsupp_file_mime');
  refreshHsuppLabel();
}
let hsEditRow = null;     // ligne en cours d'édition (null = mode ajout)
let hsEntries = [];       // dernières entrées chargées

// Heure (00–23) et quart d'heure (00/15/30/45) séparés, pour Début et Fin.
function hsFillTimeSelects(prefix, current){
  const [ch, cm] = (current||'').split(':');
  const hSel = document.getElementById(prefix+'-h'), mSel = document.getElementById(prefix+'-m');
  let hOpts = []; for(let h=0;h<24;h++) hOpts.push(String(h).padStart(2,'0'));
  let mOpts = ['00','15','30','45'];
  if(cm && !mOpts.includes(cm)) { mOpts.push(cm); mOpts.sort(); }   // quart non standard d'une vieille entrée
  hSel.innerHTML = `<option value="">--</option>` + hOpts.map(o=>`<option value="${o}">${o}</option>`).join('');
  mSel.innerHTML = `<option value="">--</option>` + mOpts.map(o=>`<option value="${o}">${o}</option>`).join('');
  hSel.value = ch || ''; mSel.value = cm || '';
}
// Récupère "HH:MM" (ou '' si incomplet) depuis les 2 selects d'un préfixe
function hsGetTime(prefix){
  const h = document.getElementById(prefix+'-h').value, m = document.getElementById(prefix+'-m').value;
  return (h && m) ? `${h}:${m}` : '';
}

// Heures supp est maintenant une PAGE (vue), plus une modale
function openHsupp(){ switchView('hsupp'); }
function closeHsupp(){ if(currentView==='hsupp') openCal(); }   // compat (anciennes références)

// Rendu de la page Heures (appelé par renderCalendar). Pendant un swipe-aperçu (_calPreview),
// on ne charge pas le fichier Drive (juste la structure).
function renderHsupp(){
  const sel = document.getElementById('hs-reg');
  if(sel && !sel.options.length){
    sel.innerHTML = REGS.map(r=>`<option value="${r.nom}">${r.nom}</option>`).join('');
    if(getMyReg()) sel.value = getMyReg();
  }
  hsFillTimeSelects('hs-debut'); hsFillTimeSelects('hs-fin');
  const d = document.getElementById('hs-date');
  if(d && !d.value){ const t=new Date(); d.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`; }
  if(_calPreview) return;          // aperçu de swipe → pas de chargement Drive
  loadHsuppFile();
}
async function loadHsuppFile(){
  const list = document.getElementById('hs-list');
  if(!list) return;
  if(offlineMode){ list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:.5rem 0">📴 Hors-ligne — reconnecte-toi pour gérer les heures supp.</div>'; return; }
  if(!accessToken){ list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:.5rem 0">Reconnecte-toi à Google pour gérer les heures supp.</div>'; return; }
  list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:.5rem 0">⏳ Recherche du fichier du mois…</div>';
  try {
    const f = await resolveHsuppForMonth();
    localStorage.setItem('3t_hsupp_file_id', f.id);
    localStorage.setItem('3t_hsupp_file_name', f.name);
    localStorage.setItem('3t_hsupp_file_mime', f.mimeType);
  } catch(e){
    list.innerHTML = `<div style="color:#f87171;font-size:12px;padding:.5rem 0">❌ ${e.message}</div>`;
    return;
  }
  hsReloadList();
}

function hsUpdateDuree(){
  const deb = hsGetTime('hs-debut'), fin = hsGetTime('hs-fin');
  const el = document.getElementById('hs-duree');
  if(deb && fin){
    let mins = (timeFracFromHM(fin) - timeFracFromHM(deb))*24*60;
    if(mins < 0){ el.textContent = '⚠️ Fin avant le début'; return; }
    const h = Math.round((mins/60)*4)/4;
    el.textContent = `Durée : ${h} h`;
  } else el.textContent = '';
}

// Heures calculées depuis Début/Fin (arrondi au quart d'heure), en décimal (1.5 = 1h30)
function hsComputeHours(deb, fin){
  if(!deb || !fin) return null;
  const mins = (timeFracFromHM(fin) - timeFracFromHM(deb)) * 24 * 60;
  if(mins <= 0) return null;
  return Math.round((mins/60)/0.25) * 0.25;
}
const HS_MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
function hsDateLabel(iso){
  if(!iso) return '—'; const [y,m,d]=iso.split('-').map(Number);
  return `${d} ${HS_MOIS[m-1]}`;
}
async function hsReloadList(){
  const reg = document.getElementById('hs-reg').value;
  const list = document.getElementById('hs-list');
  const tot = document.getElementById('hs-total');
  list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:.5rem 0">Chargement…</div>';
  tot.textContent = '';
  try{
    const { entries, stop } = await readHeuresSupp(reg);
    hsEntries = entries;
    if(!entries.length){
      list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:.5rem 0">Aucune heure supp déclarée.</div>';
    } else {
      list.innerHTML = entries.map(e=>`
        <div class="hs-item">
          <div class="hs-item-main">
            <div class="hs-item-top"><span class="hs-item-date">${hsDateLabel(e.iso)}</span><span class="hs-item-h">${e.heures!=null?e.heures+' h':''}</span></div>
            <div class="hs-item-sub">${e.debut||'—'} → ${e.fin||'—'} · ${e.motif||'—'}</div>
          </div>
          <button class="hs-ic" onclick="hsEdit(${e.rowNum})" title="Modifier">✏️</button>
          <button class="hs-ic" onclick="hsDelete(${e.rowNum})" title="Supprimer">🗑️</button>
        </div>`).join('');
    }
    const total = entries.reduce((s,e)=>s+(e.heures||0),0);
    tot.textContent = `${Math.round(total*100)/100} h${stop?' · clôturé':''}`;
  }catch(e){
    list.innerHTML = `<div style="color:#f87171;font-size:12px;padding:.5rem 0">❌ ${e.message}</div>`;
  }
}

function hsEdit(rowNum){
  const e = hsEntries.find(x=>x.rowNum===rowNum); if(!e) return;
  hsEditRow = rowNum;
  document.getElementById('hs-date').value = e.iso;
  hsFillTimeSelects('hs-debut', e.debut);
  hsFillTimeSelects('hs-fin', e.fin);
  document.getElementById('hs-motif').value = e.motif;
  document.getElementById('hs-form-title').textContent = '✏️ Modifier l\'heure supp';
  document.getElementById('hs-submit').textContent = 'Enregistrer';
  document.getElementById('hs-cancel').style.display = 'block';
  hsUpdateDuree();
  document.getElementById('hs-form-title')?.scrollIntoView({behavior:'smooth', block:'center'});
}
function hsCancelEdit(){
  hsEditRow = null;
  document.getElementById('hs-form-title').textContent = '➕ Nouvelle heure supp';
  document.getElementById('hs-submit').textContent = 'Ajouter';
  document.getElementById('hs-cancel').style.display = 'none';
  document.getElementById('hs-error').textContent = '';
  document.getElementById('hs-duree').textContent = '';
  hsFillTimeSelects('hs-debut'); hsFillTimeSelects('hs-fin');
  document.getElementById('hs-motif').value = '';
}

async function submitHeureSupp(){
  const reg = document.getElementById('hs-reg').value;
  const iso = document.getElementById('hs-date').value;
  const deb = hsGetTime('hs-debut');
  const fin = hsGetTime('hs-fin');
  const motif = document.getElementById('hs-motif').value.trim();
  const err = document.getElementById('hs-error');
  if(!accessToken){ err.textContent = "Reconnecte-toi à Google."; return; }
  if(!iso || !deb || !fin || !motif){ err.textContent = "Remplis date, début, fin et motif."; return; }
  if(timeFracFromHM(fin) <= timeFracFromHM(deb)){ err.textContent = "La fin doit être après le début."; return; }
  const btn = document.getElementById('hs-submit'); const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳…'; err.textContent = '';
  showBusy(true);
  try{
    const editing = !!hsEditRow;
    if(editing){ await editHeureSupp(reg, hsEditRow, iso, deb, fin, motif); }
    else { await addHeureSupp(reg, iso, deb, fin, motif); }
    hsCancelEdit();
    await hsReloadList();
    btn.disabled = false;
    toast(editing ? '✅ Heure modifiée' : '✅ Heure supp ajoutée', 'ok');
  }catch(e){
    err.textContent = '❌ ' + e.message;
    btn.disabled = false; btn.textContent = orig;
  }finally{ showBusy(false); }
}

async function hsDelete(rowNum){
  const e = hsEntries.find(x=>x.rowNum===rowNum); if(!e) return;
  if(!confirm(`Supprimer l'heure supp du ${hsDateLabel(e.iso)} (${e.motif}) ?`)) return;
  const reg = document.getElementById('hs-reg').value;
  showBusy(true);
  try{ await deleteHeureSupp(reg, rowNum); await hsReloadList(); toast('🗑️ Heure supprimée', 'ok'); }
  catch(err){ toast('❌ ' + err.message, 'err'); }
  finally{ showBusy(false); }
}

// ─── ÉCRITURE DU PLANNING (Google Sheets) ────────────────────────────────────
// Convertit un index de colonne 0-based en lettre(s) A1 (0→A, 26→AA)
function colLetter(n){
  let s='';
  n=Number(n);
  do { s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26)-1; } while(n>=0);
  return s;
}

// Écrit une valeur dans une cellule du Google Sheets
async function writeSheetCell(sheetName, row0, col0, value){
  const id = getSavedFileId();
  const cell = colLetter(col0) + (row0 + 1);
  const range = `'${String(sheetName).replace(/'/g,"''")}'!${cell}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[ value ]] })
  });
  if (resp.status === 401 || resp.status === 403) {
    clearToken();
    throw new Error('Autorisation insuffisante — reconnecte-toi (le partage en écriture vient peut-être d\'être activé).');
  }
  if (!resp.ok) throw new Error(`Écriture impossible (HTTP ${resp.status})`);
  return resp.json();
}

// ─── ÉCRITURE DU PLANNING (fichier .xlsx sur Drive) ──────────────────────────
function xmlEsc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function colIndexFromRef(ref){
  const m = String(ref).match(/^([A-Z]+)/); if(!m) return 0;
  let n=0; for(const c of m[1]) n=n*26+(c.charCodeAt(0)-64); return n-1;
}

// Modifie chirurgicalement une cellule d'un .xlsx (préserve le reste du fichier)
async function writeXlsxCell(fileId, sheetName, row0, col0, value, isRemove){
  if (typeof JSZip === 'undefined') throw new Error('Librairie JSZip non chargée.');
  // 1) Télécharger le fichier brut
  const resp0 = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: 'Bearer ' + accessToken } });
  if (resp0.status===401||resp0.status===403){ clearToken(); throw new Error('Autorisation insuffisante — reconnecte-toi.'); }
  if (!resp0.ok) throw new Error(`Lecture impossible (HTTP ${resp0.status})`);
  const ab = await resp0.arrayBuffer();

  // 2) Ouvrir le zip
  const zip = await JSZip.loadAsync(ab);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');

  // Trouver le r:id de l'onglet voulu, puis son fichier
  const sheetRe = /<sheet\b[^>]*\/>/g; let sm, rid=null;
  while((sm = sheetRe.exec(wbXml))){
    const tag = sm[0];
    const nm = (tag.match(/name="([^"]*)"/)||[])[1];
    if (nm === sheetName){ rid = (tag.match(/r:id="([^"]*)"/)||[])[1]; break; }
  }
  if (!rid) throw new Error(`Onglet "${sheetName}" introuvable dans le fichier.`);
  const relRe = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*/>`);
  const relTag = (relsXml.match(relRe)||[])[0] || '';
  let target = (relTag.match(/Target="([^"]*)"/)||[])[1];
  if (!target) throw new Error('Feuille cible introuvable.');
  const path = 'xl/' + target.replace(/^\/?xl\//,'').replace(/^\//,'');

  // 3) Patcher le XML de la feuille
  let xml = await zip.file(path).async('string');
  const rowNum = row0 + 1;
  const cellRef = colLetter(col0) + rowNum;
  const myCol = col0;

  const rowRe = new RegExp(`(<row\\b[^>]*\\br="${rowNum}"[^>]*>)([\\s\\S]*?)(</row>)`);
  const rowM = xml.match(rowRe);
  if (!rowM) throw new Error(`Ligne ${rowNum} introuvable (le fichier a peut-être une structure inattendue).`);

  let inner = rowM[2];
  // [^>]*? PARESSEUX : indispensable pour ne pas avaler le "/" d'une cellule
  // vide auto-fermante (<c r=".." s=".."/>) et engloutir la cellule suivante.
  const cellRe = new RegExp(`<c\\b[^>]*?\\br="${cellRef}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  const existing = inner.match(cellRe);
  const styleAttr = existing ? ((existing[0].match(/\bs="[^"]*"/)||[''])[0]) : '';
  const sPart = styleAttr ? ' ' + styleAttr : '';
  const newCell = isRemove
    ? `<c r="${cellRef}"${sPart}/>`
    : `<c r="${cellRef}"${sPart} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;

  if (existing){
    inner = inner.replace(cellRe, newCell);
  } else {
    // Insérer en respectant l'ordre des colonnes ([^>]*? paresseux : cf. cellRe)
    const cells = inner.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
    let insertBefore = null;
    for (const c of cells){
      const r = (c.match(/\br="([A-Z]+\d+)"/)||[])[1];
      if (r && colIndexFromRef(r) > myCol){ insertBefore = c; break; }
    }
    if (insertBefore) inner = inner.replace(insertBefore, newCell + insertBefore);
    else inner = inner + newCell;
  }
  xml = xml.replace(rowRe, rowM[1] + inner + rowM[3]);
  zip.file(path, xml);

  // 4) Réécrire le zip et l'uploader sur Drive (media update)
  const out = await zip.generateAsync({ type:'blob',
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const up = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    { method:'PATCH',
      headers:{ Authorization:'Bearer '+accessToken,
                'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      body: out });
  if (up.status===401||up.status===403){ clearToken(); throw new Error('Autorisation insuffisante en écriture — reconnecte-toi.'); }
  if (!up.ok) throw new Error(`Écriture impossible (HTTP ${up.status})`);
  return up.json();
}

// ─── HEURES SUPP : ajouter une ligne au fichier heures supp (.xlsx) ───────────
function excelSerialFromISO(iso){ // "yyyy-mm-dd" → numéro de série Excel
  const [y,m,d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y,m-1,d) - Date.UTC(1899,11,30)) / 86400000);
}
function timeFracFromHM(hm){ // "HH:MM" → fraction de jour
  const [h,mi] = hm.split(':').map(Number);
  return (h*3600 + mi*60) / 86400;
}
function hsGetStyle(xml, ref){
  const m = xml.match(new RegExp(`<c\\b[^>]*?\\br="${ref}"[^>]*?\\bs="(\\d+)"`));
  return m ? m[1] : null;
}
function hsReplaceCell(xml, ref, newCell){
  const re = new RegExp(`<c\\b[^>]*?\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  if(!re.test(xml)) return null;
  return xml.replace(re, newCell);
}
// Trouve l'onglet du fichier heures supp correspondant à un régisseur
function heuresSheetForReg(reg, names){
  for(const n of names){ const l=n.toLowerCase();
    if(reg==='Rizzo' && l.includes('rizzo')) return n;
    if(reg==='Théo' && (l.includes('théo')||l.includes('theo')) && !l.includes('rizzo')) return n;
  }
  for(const n of names){ if(normReg(n.trim())===reg) return n; }
  for(const n of names){ if(normReg(n.split(/\s+/)[0])===reg) return n; }
  return null;
}

// Serial Excel → "yyyy-mm-dd" ; fraction → "HH:MM"
function isoFromExcelSerial(n){
  const ms = Math.round((n - 25569) * 86400000); const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function hmFromFrac(f){
  let mins = Math.round(f*24*60); mins=((mins%1440)+1440)%1440;
  return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
}

// Ouvre l'onglet du régisseur dans le fichier heures supp → contexte d'édition
async function hsOpenSheet(reg){
  const fileId = getSavedHsuppId();
  if(!fileId) throw new Error("Aucun fichier heures supp sélectionné (⚙️ Paramètres).");
  if(getSavedHsuppMime() !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    throw new Error("Le fichier heures supp doit être un .xlsx.");
  const ab = await fetchDriveWorkbook(fileId, getSavedHsuppMime());
  const zip = await JSZip.loadAsync(ab);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const names = []; let sm; const sheetRe = /<sheet\b[^>]*\/>/g;
  while((sm = sheetRe.exec(wbXml))){ const nm=(sm[0].match(/name="([^"]*)"/)||[])[1]; if(nm) names.push(nm); }
  const sheetName = heuresSheetForReg(reg, names);
  if(!sheetName) throw new Error(`Pas d'onglet pour "${reg}" dans le fichier heures supp.`);
  const tag = wbXml.match(new RegExp(`<sheet\\b[^>]*name="${sheetName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"[^>]*/>`))[0];
  const rid = (tag.match(/r:id="([^"]*)"/)||[])[1];
  const relTag = (relsXml.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*/>`))||[''])[0];
  const target = (relTag.match(/Target="([^"]*)"/)||[])[1];
  const path = 'xl/' + target.replace(/^\/?xl\//,'').replace(/^\//,'');
  let sx = await zip.file(path).async('string');
  // chaînes partagées (pour repérer le STOP)
  const ssXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) || '';
  const sis = []; let im; const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g;
  while((im = siRe.exec(ssXml))){ sis.push(im[1]||''); }
  return { fileId, zip, path, sx, sheetName, sis };
}
async function hsSave(ctx){
  ctx.zip.file(ctx.path, ctx.sx);
  const blob = await ctx.zip.generateAsync({ type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const up = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${ctx.fileId}?uploadType=media`,
    { method:'PATCH', headers:{ Authorization:'Bearer '+accessToken,
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: blob });
  if(up.status===401||up.status===403){ clearToken(); throw new Error("Autorisation insuffisante — reconnecte-toi."); }
  if(!up.ok) throw new Error(`Écriture impossible (HTTP ${up.status})`);
}
// Détecte la ligne STOP (chaîne partagée OU texte en ligne) → {row, text} ou null
// Trouve la ligne dont la cellule D contient un libellé (STOP, TOTAL…) — partagé OU en ligne
function hsFindRowByLabel(sx, sis, word){
  const W = new RegExp(word, 'i');
  const idx = sis.findIndex(s => W.test(s.replace(/<[^>]+>/g,'')));
  if(idx >= 0){
    const m = sx.match(new RegExp(`<c\\b[^>]*?\\br="D(\\d+)"[^>]*?t="s"[^>]*?>\\s*<v>${idx}</v>`));
    if(m) return { row:parseInt(m[1],10), text:sis[idx].replace(/<[^>]+>/g,'').trim() };
  }
  let m2; const re = /<c\b[^>]*?\br="D(\d+)"[^>]*?t="inlineStr">[\s\S]*?<t[^>]*>([^<]*)<\/t>/g;
  while((m2 = re.exec(sx))){ if(W.test(m2[2])) return { row:parseInt(m2[1],10), text:m2[2].trim() }; }
  return null;
}
function hsFindStop(sx, sis){ return hsFindRowByLabel(sx, sis, 'STOP'); }
// Écrit les 4 cellules A/B/C/D d'une ligne (styles repris de la ligne, sinon ligne 3)
function hsWriteRow(sx, R, iso, debut, fin, motif){
  const sA = hsGetStyle(sx,'A'+R)||hsGetStyle(sx,'A3'), sB = hsGetStyle(sx,'B'+R)||hsGetStyle(sx,'B3'),
        sC = hsGetStyle(sx,'C'+R)||hsGetStyle(sx,'C3'), mS = hsGetStyle(sx,'D'+R)||hsGetStyle(sx,'D3');
  const serial = excelSerialFromISO(iso), deb = timeFracFromHM(debut), f = timeFracFromHM(fin);
  const sets = [
    ['A'+R, `<c r="A${R}"${sA?` s="${sA}"`:''}><v>${serial}</v></c>`],
    ['B'+R, `<c r="B${R}"${sB?` s="${sB}"`:''}><v>${deb}</v></c>`],
    ['C'+R, `<c r="C${R}"${sC?` s="${sC}"`:''}><v>${f}</v></c>`],
    ['D'+R, `<c r="D${R}"${mS?` s="${mS}"`:''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(motif)}</t></is></c>`]
  ];
  for(const [ref, cell] of sets){
    const out = hsReplaceCell(sx, ref, cell);
    if(out === null) throw new Error(`Cellule ${ref} introuvable — structure du fichier inattendue.`);
    sx = out;
  }
  return sx;
}
// Vide les cellules A/B/C/D d'une ligne (en gardant les styles)
function hsClearRow(sx, R, stopRow){
  for(const col of ['A','B','C','D']){
    const ref = col+R;
    // ne pas toucher la cellule D si c'est la ligne STOP
    if(col==='D' && R===stopRow) continue;
    const s = hsGetStyle(sx, ref);
    const out = hsReplaceCell(sx, ref, `<c r="${ref}"${s?` s="${s}"`:''}/>`);
    if(out !== null) sx = out;
  }
  return sx;
}

// Cœur : réécrit TOUTES les entrées triées (date puis heure) et compactées dès la
// ligne 3, sans trous, et replace le STOP juste en dessous s'il existait.
async function rewriteHeuresSupp(reg, entries){
  const ctx = await hsOpenSheet(reg);
  const stop = hsFindStop(ctx.sx, ctx.sis);
  const total = hsFindRowByLabel(ctx.sx, ctx.sis, 'TOTAL');   // footer à ne JAMAIS toucher
  const totalRow = total ? total.row : Infinity;
  // dernière ligne de DONNÉES avec formule E (avant le TOTAL) = dernière ligne écrivable
  let eMax = 2, m; const eRe = /<c\b[^>]*?\br="E(\d+)"[^>]*?>\s*<f\b/g;
  while((m = eRe.exec(ctx.sx))){ const r=parseInt(m[1],10); if(r < totalRow) eMax = Math.max(eMax, r); }
  if(eMax < 3) eMax = 32;
  const writeMax  = eMax;                              // on n'écrit jamais sur/sous le TOTAL
  const clearTo   = total ? total.row - 1 : eMax;     // on nettoie jusqu'avant le TOTAL

  // tri chronologique (date, puis heure de début) ; entrées sans date à la fin
  const list = entries.slice().sort((a,b)=>{
    if(a.iso !== b.iso) return (a.iso||'9999') < (b.iso||'9999') ? -1 : 1;
    return a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0;
  });
  const capacity = writeMax - 3 + 1 - (stop ? 1 : 0);
  if(list.length > capacity) throw new Error(`Limite atteinte : ${capacity} heures supp max par mois pour cet onglet (tu en as ${list.length}). Supprime-en une ou demande à agrandir le modèle.`);

  let R = 3;
  for(const e of list){ ctx.sx = hsWriteRow(ctx.sx, R, e.iso, e.debut, e.fin, e.motif); R++; }
  // Replace le STOP juste sous les entrées (s'il existait, et dans la zone de données)
  let clearFrom = R;
  if(stop){
    const sD = hsGetStyle(ctx.sx,'D'+stop.row) || hsGetStyle(ctx.sx,'D'+R);
    for(const col of ['A','B','C']){ const ref=col+R; const s=hsGetStyle(ctx.sx,ref); const o=hsReplaceCell(ctx.sx,ref,`<c r="${ref}"${s?` s="${s}"`:''}/>`); if(o) ctx.sx=o; }
    const o = hsReplaceCell(ctx.sx, 'D'+R, `<c r="D${R}"${sD?` s="${sD}"`:''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(stop.text)}</t></is></c>`);
    if(o) ctx.sx = o;
    clearFrom = R + 1;
  }
  // nettoie les lignes de données restantes (JAMAIS la ligne TOTAL ni en dessous)
  for(let r = clearFrom; r <= clearTo; r++) ctx.sx = hsClearRow(ctx.sx, r, -1);
  await hsSave(ctx);
  return ctx.sheetName;
}

// AJOUT — bloqué si STOP présent ; sinon ajoute puis réorganise
async function addHeureSupp(reg, iso, debut, fin, motif){
  const { entries, stop } = await readHeuresSupp(reg);
  if(stop) throw new Error(`Période clôturée par le patron (« ${stop} »). Impossible d'ajouter une heure supp.`);
  entries.push({ iso, debut, fin, motif });
  return rewriteHeuresSupp(reg, entries);
}
// MODIFICATION d'une ligne existante → on met à jour puis on réorganise
async function editHeureSupp(reg, rowNum, iso, debut, fin, motif){
  const { entries } = await readHeuresSupp(reg);
  const e = entries.find(x=>x.rowNum===rowNum);
  if(e){ e.iso=iso; e.debut=debut; e.fin=fin; e.motif=motif; }
  await rewriteHeuresSupp(reg, entries);
}
// SUPPRESSION → on retire puis on réorganise (plus de trou)
async function deleteHeureSupp(reg, rowNum){
  const { entries } = await readHeuresSupp(reg);
  await rewriteHeuresSupp(reg, entries.filter(x=>x.rowNum!==rowNum));
}
// LECTURE des heures supp d'un régisseur (pour le récap)
async function readHeuresSupp(reg){
  const fileId = getSavedHsuppId();
  if(!fileId) return { entries:[], stop:null };
  const ab = await fetchDriveWorkbook(fileId, getSavedHsuppMime());
  const wb = XLSX.read(ab, { type:'array' });
  const sheetName = heuresSheetForReg(reg, wb.SheetNames);
  if(!sheetName) return { entries:[], stop:null };
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, raw:true, defval:null });
  const entries = []; let stop = null; let lastIso = '';
  for(let i=2;i<rows.length;i++){
    const row = rows[i]||[];
    const a=row[0], b=row[1], c=row[2], d=row[3], e=row[4];
    const ds = (typeof d==='string') ? d.trim() : '';
    if(/^TOTAL\b/i.test(ds)) break;            // pied de page → on arrête
    if(/STOP/i.test(ds)){ stop = ds; continue; } // marqueur patron → ignoré
    if(typeof a==='number') lastIso = isoFromExcelSerial(a);
    // Ligne vide ?
    const hasContent = (typeof b==='number') || (typeof c==='number') || ds!=='';
    if(a==null && !hasContent) continue;
    entries.push({
      rowNum: i+1,
      iso: typeof a==='number' ? isoFromExcelSerial(a) : lastIso, // date implicite héritée
      debut: typeof b==='number' ? hmFromFrac(b) : '',
      fin: typeof c==='number' ? hmFromFrac(c) : '',
      motif: ds,
      // Calculé dans l'app (la valeur en cache de la formule peut être périmée)
      heures: hsComputeHours(typeof b==='number'?hmFromFrac(b):'', typeof c==='number'?hmFromFrac(c):'')
    });
  }
  return { entries, stop };
}

// Recharge le plan depuis Drive sans réinitialiser la vue (garde mois + jour ouverts)
async function reloadPlanSilent(){
  const ab = await fetchDriveWorkbook(getSavedFileId(), getSavedFileMime());
  ({struck:struckCells, guest:guestCells} = await parseCellStyles(ab));
  const wb = XLSX.read(ab, { type: 'array' });
  const p = parsePlanTech(wb);
  allDays = p.days; allMois = p.mois; allRegs = p.regs;
  applyGuestBaseOverride();   // orange + dans la base = vraie pièce
  renderCalendar();
  saveOfflineCache();   // #19
}

// Bouton 🔄 : recharge le plan tech ET la base heures depuis Drive
async function refreshData(){
  if(blockIfOffline()) return;
  const btns = [document.getElementById('btn-refresh'), document.getElementById('btn-refresh-m')].filter(Boolean);
  if(!accessToken){ toast("Reconnecte-toi à Google d'abord.", 'err'); return; }
  btns.forEach(b=>{ b.disabled = true; b.classList.add('spinning'); });
  showBusy(true);
  try{
    if(getSavedBaseId()){
      await loadBaseHeuresById(getSavedBaseId(), getSavedBaseName(), getSavedBaseMime());
    }
    if(getSavedFileId()){
      await reloadPlanSilent();
    }
    await loadFormations();   // recharge les formations partagées (Firestore) + re-render la vue
    toast('✅ Données à jour', 'ok');
    publishSchedule();   // #16 — republie le planning après refresh
  }catch(err){
    toast('❌ Rafraîchissement impossible', 'err');
  }finally{
    showBusy(false);
    btns.forEach(b=>{ b.disabled = false; b.classList.remove('spinning'); });
  }
}

// Bouton "Aujourd'hui" : revient au mois courant (s'il existe dans les données)
function goToday(){
  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const sel = document.getElementById('mois-select');
  let dir=1;
  if(_prevMonthKey){
    const a=allMois.findIndex(m=>m.k===_prevMonthKey), b=allMois.findIndex(m=>m.k===mk);
    if(a>=0 && b>=0 && b<a) dir=-1;
  }
  if([...sel.options].some(o=>o.value===mk)){ sel.value = mk; }
  selectedDay = now.getDate();
  renderCalendar();
  animateMonthGrid(dir);
}

// Le "moi" pour le positionnement = régisseur de connexion (ou sélectionné à défaut)
function myRegName(){ return getMyReg() || getCurrentReg() || ''; }

// Actions de positionnement listées au rendu du détail
let dayActions = [];

async function doPosition(i){
  if(blockIfOffline()) return;
  const a = dayActions[i];
  if(!a) return;
  const me = a.me;
  const mime = getSavedFileMime();
  const isSheet = mime === 'application/vnd.google-apps.spreadsheet';
  const isXlsx  = mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if(!isSheet && !isXlsx){
    toast('Type de fichier non modifiable (' + (mime || 'inconnu') + ')', 'err');
    return;
  }
  if(!hasWriteScope()){
    toast('Droit d\'écriture Google non accordé — reconnecte-toi en acceptant toutes les autorisations', 'err');
    return;
  }
  let newVal, msg;
  if(a.type === 'add'){
    const cur = (a.src.rawReg||'').trim();
    newVal = cur ? `${cur}/${me}` : me;
    msg = `Te positionner sur "${a.spec}" (${a.salleLabel}) le ${a.dateLabel} ?`;
  } else {
    // retirer "me" du contenu de la cellule
    const tokens = String(a.src.rawReg||'').split(/[\/,]/).map(s=>s.trim()).filter(Boolean);
    const kept = tokens.filter(t => normReg(t) !== me);
    newVal = kept.join('/');
    msg = `Te retirer de "${a.spec}" (${a.salleLabel}) le ${a.dateLabel} ?`;
  }
  if(!confirm(msg)) return;
  try{
    showBusy(true);
    const btn = document.getElementById('act-'+i);
    if(btn){ btn.disabled = true; btn.textContent = '⏳…'; }
    if(isSheet){
      await writeSheetCell(a.src.sheet, a.src.row0, a.src.col0, newVal);
    } else {
      await writeXlsxCell(getSavedFileId(), a.src.sheet, a.src.row0, a.src.col0, newVal, a.type==='remove' && !newVal);
    }
    await reloadPlanSilent();
    publishSchedule();   // #16 — republie le planning après (dé)positionnement
    toast(a.type==='add' ? '✅ Tu es positionné' : '✅ Tu es retiré', 'ok');
  }catch(err){
    toast('❌ ' + err.message, 'err');
    console.error(err);
  }finally{ showBusy(false); }
}

function resetApp(){
  document.getElementById('upload-screen').style.display='flex';
  document.getElementById('app-screen').style.display='none';
  planLoaded=false;
  allDays=[]; allMois=[]; allRegs=[];
  // The back arrow now disconnects: no automatic reconnection afterwards.
  disconnectGoogle();
}

function populateSelects(){
  const rs=document.getElementById('reg-select');
  rs.innerHTML=allRegs.map(r=>`<option value="${r}">${r}</option>`).join('');
  // Sélectionne mon régisseur par défaut s'il est connu
  const mine=getMyReg();
  if(mine && allRegs.includes(mine)) rs.value=mine;
  updateAvatar();
  const ms=document.getElementById('mois-select');
  ms.innerHTML=allMois.map(m=>`<option value="${m.k}">${m.l}</option>`).join('');
  if(allMois.length){
    // Default to the current month if it exists in the data,
    // otherwise the closest available month.
    const now = new Date();
    const curKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    let target = allMois.find(m => m.k === curKey);
    if(!target){
      const curNum = now.getFullYear()*12 + now.getMonth();
      let best = allMois[0], bestDist = Infinity;
      allMois.forEach(m => {
        const [y,mo] = m.k.split('-').map(Number);
        const dist = Math.abs((y*12 + (mo-1)) - curNum);
        if(dist < bestDist){ bestDist = dist; best = m; }
      });
      target = best;
    }
    ms.value = target.k;
  }
}

// Sens du dernier changement de mois (1 = mois suivant, -1 = précédent) pour l'animation.
let _prevMonthKey = null;
// Glissement de la grille du mois (uniquement en vue Mois).
function animateMonthGrid(dir){
  if(currentView!=='grid') return;
  const g=document.getElementById('cal-grid');
  if(!g) return;
  g.classList.remove('mgrid-fwd','mgrid-back');
  void g.offsetWidth;                                  // reflow pour rejouer l'anim
  g.classList.add(dir>=0 ? 'mgrid-fwd' : 'mgrid-back');
  setTimeout(()=>g.classList.remove('mgrid-fwd','mgrid-back'), 320);
}

function changeMonth(d){
  const sel=document.getElementById('mois-select');
  const idx=allMois.findIndex(m=>m.k===sel.value);
  const ni=Math.max(0,Math.min(allMois.length-1,idx+d));
  if(ni===idx) return;                                 // déjà au bord (1er/dernier mois)
  sel.value=allMois[ni].k;
  renderCalendar();
  animateMonthGrid(d);
}

// Choix d'un mois dans le menu déroulant → anime selon le sens du saut.
function onMonthSelect(){
  const sel=document.getElementById('mois-select');
  let dir=1;
  if(_prevMonthKey){
    const a=allMois.findIndex(m=>m.k===_prevMonthKey);
    const b=allMois.findIndex(m=>m.k===sel.value);
    if(a>=0 && b>=0 && b<a) dir=-1;
  }
  renderCalendar();
  animateMonthGrid(dir);
}


let selectedDay = null;

function onRegChange() {
  updateAvatar();
  selectedDay = null;
  renderCalendar();
  if (isSearchActive()) searchByDate();
}

function isSearchActive() {
  const el = document.getElementById('search-date');
  return el && el.value;
}

function isTeamMode() { return document.getElementById('team-toggle')?.checked; }

function getCurrentReg() { return document.getElementById('reg-select').value; }

// #13 — Conflits d'horaire : un régisseur positionné sur 2 salles à la même heure le même jour.
// Renvoie [{ d, reg, h, items:[{salle,spec}] }] (toute l'équipe, annulés exclus).
function computeConflicts(y, m){
  const teamMap = buildTeamDayMap(y, m);
  const nbDays = new Date(y, m, 0).getDate();
  const conflicts = [];
  for(let d=1; d<=nbDays; d++){
    const entries = (teamMap[d]||[]).filter(e => !e.cancelled && e.h && e.salle !== 'Tournée');
    const byReg = {};
    entries.forEach(e => {
      (e.regies||[]).forEach(r => {
        if(r.role === 'observateur') return;       // un observateur ne crée pas de conflit
        (byReg[r.reg] = byReg[r.reg] || []).push({ h:e.h, salle:e.salle, spec:e.spec||'—' });
      });
    });
    Object.entries(byReg).forEach(([reg, list]) => {
      const byH = {};
      list.forEach(it => (byH[it.h] = byH[it.h] || []).push(it));
      Object.entries(byH).forEach(([h, items]) => {
        // conflit = au moins 2 SALLES différentes à la même heure
        if(new Set(items.map(i => i.salle)).size > 1){
          conflicts.push({ d, reg, h, items });
        }
      });
    });
  }
  return conflicts;
}

function renderStats(reg, y, m, teamMode) {
  // Les stats + le calcul d'heures restent TOUJOURS personnels (mode équipe ignoré).
  const dayMap = buildDayMap(reg, y, m);
  const nbDays = new Date(y, m, 0).getDate();
  let nR = 0, nT = 0;
  Object.values(dayMap).forEach(entries => entries.forEach(e => {
    if (e.cancelled) return; // annulé → non compté
    if (e.salle === 'Tournée') nT++;
    else if (e.myRole !== 'observateur' && !e.unassigned) nR++;
  }));
  // Régies non attribuées du mois (toute l'équipe) → alerte
  let nUnassigned = 0;
  const teamMap = buildTeamDayMap(y, m);
  Object.values(teamMap).forEach(entries => entries.forEach(e => {
    if (e.unassigned && !e.cancelled) nUnassigned++;
  }));
  // Conflits d'horaire du mois (un régisseur sur 2 salles à la même heure)
  const nConflicts = computeConflicts(y, m).length;
  // Heures calculées depuis la base heures spectacles
  const heures = computeHeures(dayMap);
  let hLabel, hSub;
  if (baseHeuresLoaded) {
    hLabel = `${heures.total}h`;
    hSub = heures.guests.length
      ? `${heures.nbRegies} régie${heures.nbRegies>1?'s':''} · ${heures.guests.length} 🎤`
      : `${heures.nbRegies} régie${heures.nbRegies>1?'s':''}`;
  } else {
    hLabel = '—';
    hSub = 'base non chargée';
  }
  document.getElementById('stats').innerHTML = `
    <div class="stat-card"><div class="stat-l">Régies</div><div class="stat-v">${nR}</div><div class="stat-s">forfaits</div></div>
    <div class="stat-card htech" onclick="toggleHeuresPop(event)" title="Voir le détail">
      <div class="stat-l">Heures <span style="opacity:.6">▾</span></div>
      <div class="stat-v" id="stat-h-val">${hLabel}</div><div class="stat-s" id="stat-h-sub">${hSub}</div>
      ${heuresPopHTML(heures)}
    </div>
    <div class="stat-card"><div class="stat-l">Tournées</div><div class="stat-v">${nT}</div><div class="stat-s">~180€</div></div>`
    + (nUnassigned > 0 ? `<div class="unassigned-alert" onclick="showUnassigned()" title="Voir le détail">⚠️ ${nUnassigned} régie${nUnassigned>1?'s':''} sans personne ce mois <span style="opacity:.7;font-weight:400">— voir le détail ›</span></div>` : '')
    + (nConflicts > 0 ? `<div class="conflict-alert" onclick="showConflicts()" title="Voir le détail">💥 ${nConflicts} conflit${nConflicts>1?'s':''} d'horaire ce mois <span style="opacity:.7;font-weight:400">— voir le détail ›</span></div>` : '');
  // Heures supp du mois ajoutées au total de la carte « Heures » (lecture différée + cache)
  if (baseHeuresLoaded && !offlineMode) loadStatsHsupp(reg, y, m, heures.total, heures.nbRegies, heures.guests.length);
  // La "régie du jour" suit le mode équipe (toute l'équipe ou perso)
  renderTodayCard(reg, teamMode ? buildTeamDayMap(y, m) : dayMap);
}

// Ajoute les heures supp du mois au total de la carte « Heures » de l'accueil (avec cache)
const _statsHsuppCache = {};
async function loadStatsHsupp(reg, y, m, baseTotal, nReg, nGuest){
  const key = reg+'|'+y+'-'+m;
  const apply = (hs)=>{
    const v=document.getElementById('stat-h-val'), s=document.getElementById('stat-h-sub');
    if(v) v.textContent = `${Math.round((baseTotal+hs)*100)/100}h`;
    if(s) s.textContent = `${nReg} régie${nReg>1?'s':''}${hs?` · +${hs}h supp`:''}${nGuest?` · ${nGuest} 🎤`:''}`;
  };
  if(key in _statsHsuppCache){ apply(_statsHsuppCache[key]); return; }
  try{
    const f = await resolveHsuppForMonth(new Date(y, m-1, 1));
    const ab = await fetchDriveWorkbook(f.id, f.mimeType);
    const wb = XLSX.read(ab, { type:'array' });
    const hs = sumHsuppHours(wb, reg);
    _statsHsuppCache[key] = hs;
    apply(hs);
  }catch(e){ _statsHsuppCache[key] = 0; }
}

// Contenu du panneau de détail des heures (survol/clic sur la carte)
function heuresPopHTML(h){
  if(!baseHeuresLoaded){
    return `<div class="htech-pop"><div style="font-size:12px;color:var(--muted)">Base heures non chargée — sélectionne le fichier base dans ⚙️ Paramètres.</div></div>`;
  }
  const specs = Object.entries(h.specs).sort((a,b)=>b[1].hours-a[1].hours);
  const rows = specs.map(([n,d])=>{
    const sl = d.salle==='3TC'?'3T Côté':d.salle==='GT'?'Grand Théâtre':d.salle;
    return `<div class="hp-row"><span class="hp-l">${n} <span style="color:var(--muted)">· ${d.count}× ${sl}</span></span><span class="hp-v">${Math.round(d.hours*100)/100}h</span></div>`;
  }).join('') || '<div style="font-size:12px;color:var(--muted)">Aucune régie ce mois</div>';
  const unm = h.guests.length
    ? `<div class="hp-sep"></div><div class="hp-title">🎤 Artistes invités · hors calcul</div>`
      + h.guests.map(g=>`<div class="hp-row"><span class="hp-l">${g}</span><span class="hp-v" style="color:var(--cguest)">invité</span></div>`).join('')
    : '';
  const warn = h.unmatched.length
    ? `<div class="hp-warn">⚠️ Non trouvés dans la base : ${h.unmatched.join(', ')}</div>` : '';
  const hsuppNote = (h.hsupp && h.hsupp.length)
    ? `<div style="font-size:11px;color:#a78bfa;margin-top:.4rem">💼 Comptés en heures supp : ${h.hsupp.join(', ')}</div>` : '';
  return `<div class="htech-pop" onclick="event.stopPropagation()">
    <button class="hp-close" onclick="closeHeuresPop(event)" aria-label="Fermer" title="Fermer">✕</button>
    <div class="hp-title">Détail des heures · ${h.total}h</div>
    ${rows}
    <div class="hp-sep"></div>
    <div class="hp-row"><span class="hp-l">Montages</span><span class="hp-v">${h.montage}h</span></div>
    <div class="hp-row"><span class="hp-l">Durées spectacles</span><span class="hp-v">${h.duree}h</span></div>
    <div class="hp-row"><span class="hp-l">Démontages</span><span class="hp-v">${h.demontage}h</span></div>
    <div class="hp-row"><span class="hp-l">Services (1h/régie)</span><span class="hp-v">${h.service}h</span></div>
    <div class="hp-row hp-total"><span class="hp-l">Total</span><span class="hp-v">${h.total}h</span></div>
    ${unm}
    ${warn}
    ${hsuppNote}
    <div class="hp-note">⚠️ Estimation approximative — en développement.</div>
  </div>`;
}

// Croix de fermeture du panneau (mobile)
function closeHeuresPop(e){
  e.stopPropagation();
  document.querySelectorAll('.stat-card.htech.open').forEach(c=>c.classList.remove('open'));
}
function toggleHeuresPop(e){
  // Sur PC, le survol suffit → le clic ne fige rien (évite de rester bloqué ouvert).
  if (isDesktop()) return;
  e.stopPropagation();
  const card = e.currentTarget;
  const wasOpen = card.classList.contains('open');
  document.querySelectorAll('.stat-card.htech.open').forEach(c=>c.classList.remove('open'));
  if (!wasOpen) card.classList.add('open');
}
// Fermer le panneau (mobile) en touchant ailleurs
document.addEventListener('click', (e)=>{
  if (!e.target.closest('.stat-card.htech'))
    document.querySelectorAll('.stat-card.htech.open').forEach(c=>c.classList.remove('open'));
});

function renderCalendar() {
  const reg = getCurrentReg();
  const mk = document.getElementById('mois-select').value;
  _prevMonthKey = mk;                       // mémorise le mois courant (sens d'anim au prochain changement)
  const [y, m] = mk.split('-').map(Number);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const nbDays = new Date(y, m, 0).getDate();
  const teamMode = isTeamMode();

  // Always update stats + today card first
  renderStats(reg, y, m, teamMode);

  // If another view is active, delegate
  if (currentView === 'week') { renderWeek(reg); return; }
  if (currentView === 'year') { renderYear(reg); return; }
  if (currentView === 'hsupp') { renderHsupp(); return; }
  if (currentView === 'list') { renderList(reg, y, m); return; }
  if (currentView === 'resume') { renderResume(reg, y, m); return; }

  const dayMap = teamMode ? buildTeamDayMap(y, m) : buildDayMap(reg, y, m);
  // Repérage des régies sans personne (toujours sur toute l'équipe, quel que soit le mode)
  const warnMap = buildTeamDayMap(y, m);
  // Jours avec un conflit d'horaire (un régisseur sur 2 salles à la même heure)
  const conflictDays = new Set(computeConflicts(y, m).map(c => c.d));

  // Stats + today card already rendered by renderStats() above

  // Build calendar grid
  // First day of month: getDay() → 0=Sun,1=Mon... we want Mon=0
  const firstDow = new Date(y, m-1, 1).getDay(); // 0=Sun
  const offset = firstDow === 0 ? 6 : firstDow - 1; // Mon-based offset

  let cells = '';
  // Empty cells before month start
  for (let i = 0; i < offset; i++) cells += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= nbDays; d++) {
    const isoKey = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = isoKey === todayKey;
    const isSelected = selectedDay === d;
    const entries = dayMap[d] || [];
    const hasEvents = entries.length > 0;
    const dow = new Date(y, m-1, d).getDay(); // 0=Sun,6=Sat
    const isWeekend = dow === 0 || dow === 6;

    // Build dots
    let dots = '';
    let hasGuest = false;
    entries.forEach(e => {
      if (e.cancelled){ dots += '<span class="cal-cancel" title="Annulé">❌</span>'; return; } // annulé → croix rouge, pas de pastille
      let cls = 'dgt';
      if (e.salle === '3T') cls = 'd3t';
      else if (e.salle === '3TC') cls = 'd3tc';
      else if (e.salle === 'Tournée') cls = 'dtour';
      if (e.myRole === 'observateur') cls = 'dobs';
      dots += `<div class="dot ${cls}"></div>`;
      if (e.guest) hasGuest = true;
    });
    const micMark = hasGuest ? '<span class="cal-mic" title="Artiste invité">🎤</span>' : '';
    const hasUnassigned = (warnMap[d] || []).some(e => e.unassigned && !e.cancelled);
    const warnMark = hasUnassigned ? '<span class="cal-warn" title="Régie sans personne">⚠️</span>' : '';
    const conflictMark = conflictDays.has(d) ? '<span class="cal-conflict" title="Conflit d\'horaire">💥</span>' : '';
    // Particularités du jour (privatisation, coop, semi privé…) → pastilles.
    // Basées sur `entries` (= ma régie en perso, toute l'équipe en mode équipe) :
    // un privé fait par un AUTRE régisseur n'apparaît pas en vue perso.
    const specials = [...new Set(entries.filter(e => e.special && !e.cancelled).map(e => e.special))];
    const specialMark = specials.length ? `<div class="cal-special">${specials.map(s=>`<span title="${s}">${s}</span>`).join('')}</div>` : '';
    const fmMark = (_formations[isoKey] && _formations[isoKey].length) ? '<span class="cal-formation" title="Formation">📚</span>' : '';

    cells += `<div class="cal-cell${hasEvents?' has-events':''}${isToday?' is-today':''}${isSelected?' selected':''}" onclick="selectDay(${d})">
      <div class="day-num" style="${isWeekend?'color:#f87171':''}">${d}${micMark}${warnMark}${conflictMark}${fmMark}</div>
      ${dots ? `<div class="dot-row">${dots}</div>` : ''}
      ${specialMark}
    </div>`;
  }

  document.getElementById('cal-grid').innerHTML = cells;

  // Render detail if a day is selected
  renderDetail(reg, y, m, dayMap, teamMode);
}

function selectDay(d) {
  selectedDay = selectedDay === d ? null : d;
  const reg = document.getElementById('reg-select').value;
  const mk = document.getElementById('mois-select').value;
  const [y, m] = mk.split('-').map(Number);
  const teamMode = isTeamMode();

  // Use the team map when "voir toute l'équipe" is on, otherwise the personal map
  const dayMap = teamMode ? buildTeamDayMap(y, m) : buildDayMap(reg, y, m);

  // Update selected state visually
  document.querySelectorAll('.cal-cell').forEach((el, i) => {
    const cellDay = i + 1 - [...document.querySelectorAll('.cal-cell.empty')].length;
    el.classList.toggle('selected', cellDay === selectedDay);
  });

  renderDetail(reg, y, m, dayMap, teamMode);
  if (selectedDay) {
    const panel = document.getElementById('detail-panel');
    panel.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
}

function renderDetail(reg, y, m, dayMap, teamMode) {
  const panel = document.getElementById('detail-panel');
  if (!selectedDay) { panel.innerHTML = ''; return; }

  const entries = dayMap[selectedDay] || [];
  const dateObj = new Date(y, m-1, selectedDay);
  const jourStr = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const moisStr = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const dateLabel = `${jourStr[dateObj.getDay()]} ${selectedDay} ${moisStr[m-1]} ${y}`;

  const me = myRegName();
  dayActions = [];

  let cardsHTML = '';
  if (entries.length === 0) {
    cardsHTML = `<div class="no-event">${teamMode ? "Aucune activité ce jour" : "Aucune régie ce jour"}</div>`;
  } else {
    entries.forEach(e => {
      let cls = 'egt';
      if (e.salle === '3T') cls = 'e3t';
      else if (e.salle === '3TC') cls = 'e3tc';
      else if (e.salle === 'Tournée') cls = 'etour';
      if (!teamMode && e.myRole === 'observateur') cls = 'eobs';
      if (e.unassigned) cls = 'eunassigned';

      const salleLabel = e.salle === '3TC' ? '3T Côté' : e.salle === 'GT' ? 'Grand Théâtre' : e.salle;

      const badges = [];
      if (e.h) badges.push(`<span class="ev-badge bdg-h">${e.h}</span>`);
      if (e.cancelled) badges.push('<span class="ev-badge bdg-cancel">❌ annulé</span>');
      if (e.guest) badges.push('<span class="ev-badge bdg-guest">🎤 invité</span>');
      if (e.special) badges.push(`<span class="ev-badge bdg-special">${e.special}</span>`);

      let meta;
      if (teamMode) {
        // Show ALL régisseurs of the team for this entry
        const regies = (e.regies || []).map(r => roleDot(r) + r.reg);
        const who = regies.length ? regies.join(', ') : (e.unassigned ? 'Personne assigné' : '—');
        const salleStr = e.salle === 'Tournée' ? 'Tournée' : salleLabel;
        meta = `${salleStr} · ${who}`;
      } else {
        const others = e.regies.filter(r => r.reg !== reg).map(r => r.reg);
        const withStr = others.length ? ` · avec ${others.join(', ')}` : '';
        if (e.myRole === 'observateur') badges.push('<span class="ev-badge bdg-obs">observation</span>');
        if (e.isFormateur) badges.push('<span class="ev-badge bdg-form">formation</span>');
        if (e.salle === 'Tournée') meta = `Tournée · ~180€${withStr}`;
        else if (e.myRole === 'observateur') meta = `${salleLabel} · heures techniques${withStr}`;
        else meta = `${salleLabel}${withStr}`;
      }

      // Bouton "se positionner" / "se retirer" (fonctionne en perso ET en équipe)
      const actionHTML = posActionHTML(e, y, m, dateLabel);

      cardsHTML += `<div class="event-card ${cls}">
        <div class="ev-top">
          <span class="ev-name" style="${e.cancelled?'text-decoration:line-through;opacity:.6':''}">${e.spec || '—'}</span>
          <div class="ev-badges">${badges.join('')}</div>
        </div>
        <div class="ev-meta">${meta}</div>
        ${actionHTML}
      </div>`;
    });
  }

  const iso = `${y}-${String(m).padStart(2,'0')}-${String(selectedDay).padStart(2,'0')}`;
  const fmHTML = formationCardsHTML(iso);
  panel.innerHTML = `<div class="detail-panel">
    <div class="detail-date">${dateLabel}</div>
    ${cardsHTML}
    ${fmHTML}
    <button class="fm-propose" onclick="openFormationModal('${iso}')">📚 Proposer une formation ce jour</button>
  </div>`;
}

// #4 — Ma prochaine régie (jour strictement après aujourd'hui où JE suis positionné)
function nextRegie(){
  const me = myRegName();
  const todayIso = isoToday();
  let best = null;
  allDays.forEach(d => {
    const iso = d.date.toISOString().slice(0,10);
    if(iso <= todayIso) return;
    const ent = (d.entries||[]).find(e => e.salle!=='Tournée' && !e.cancelled &&
      (e.regies||[]).some(r => r.reg===me && r.role!=='observateur'));
    if(!ent) return;
    if(!best || iso < best.iso) best = { iso, spec: ent.spec||'', salle: ent.salle };
  });
  if(!best) return null;
  best.days = Math.round((new Date(best.iso+'T00:00:00') - new Date(todayIso+'T00:00:00')) / 86400000);
  return best;
}
function nextRegieHTML(){
  const nr = nextRegie();
  if(!nr) return '';
  const j = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'], mo = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  const d = new Date(nr.iso+'T00:00:00');
  const dateLbl = `${j[d.getDay()]} ${d.getDate()} ${mo[d.getMonth()]}`;
  const salleLbl = nr.salle==='3TC'?'3T Côté':nr.salle==='GT'?'Grand Théâtre':nr.salle;
  const delai = nr.days===1 ? 'demain' : `dans ${nr.days} jours`;
  return `<div class="today-next">⏭️ Prochaine régie <b>${delai}</b><br><span class="tn-d">${dateLbl}${nr.spec?` · ${nr.spec}`:''}${nr.salle?` (${salleLbl})`:''}</span></div>`;
}
// Rappel « déclare tes heures supp » sur les 3 derniers jours du mois (masquable, 1×/mois)
function hsuppReminderKey(){ const n=new Date(); return '3t_hsupp_rem_'+n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0'); }
function hsuppReminderDue(){
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  if(now.getDate() < last-2) return false;            // seulement J-2 → fin de mois
  return localStorage.getItem(hsuppReminderKey()) !== '1';
}
function hsuppReminderHTML(){
  if(!hsuppReminderDue()) return '';
  return `<div class="hsupp-remind" id="hsupp-remind">
    <span>⏱️ Fin de mois : pense à déclarer tes <b>heures supp</b> !</span>
    <div class="hr-act">
      <button class="hr-go" onclick="openHsupp()">Déclarer</button>
      <button class="hr-x" onclick="dismissHsuppReminder()" title="Masquer ce mois">✕</button>
    </div>
  </div>`;
}
function dismissHsuppReminder(){
  localStorage.setItem(hsuppReminderKey(), '1');
  const el = document.getElementById('hsupp-remind'); if(el) el.remove();
}
function renderTodayCard(reg, dayMap) {
  const wrap = document.getElementById('today-card-wrap');
  const now = new Date();
  // Bouton « Bilan de soirée » : visible après 21h si J'AI une régie aujourd'hui
  const soireeBtn = document.getElementById('btn-soiree-card');
  if(soireeBtn) soireeBtn.style.display = (now.getHours() >= 21 && myTodaySpectacles().length) ? 'block' : 'none';
  const todayD = now.getDate();
  const todayY = now.getFullYear();
  const todayM = now.getMonth() + 1;
  const jourStr = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const moisStr = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const jourNom = jourStr[now.getDay()];
  const timeStr = now.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  const dateStr = `${jourNom} ${todayD} ${moisStr[todayM-1]} ${todayY}`;
  const teamMode = isTeamMode();
  const todayIso = `${todayY}-${String(todayM).padStart(2,'0')}-${String(todayD).padStart(2,'0')}`;
  const todayFm = formationCardsHTML(todayIso);

  // Always look at TODAY's data regardless of displayed month
  const todayDayMap = teamMode ? buildTeamDayMap(todayY, todayM) : buildDayMap(reg, todayY, todayM);
  const entries = (todayDayMap[todayD] || []).filter(e => !e.unassigned);

  if (entries.length === 0) {
    wrap.innerHTML = hsuppReminderHTML() + `<div class="today-card empty">
      <div class="today-top">
        <span class="today-label">Régie du jour</span>
        <span style="font-size:11px;color:var(--muted)">${timeStr}</span>
      </div>
      <div style="font-size:11px;color:var(--muted2);margin-bottom:4px">${dateStr}</div>
      <div class="today-name">Pas de régie aujourd'hui</div>
      ${nextRegieHTML()}
    </div>${todayFm}`;
    return;
  }

  // Multiple régies today → show all
  let cardsHTML = '';
  entries.forEach((e, i) => {
    let cls = 'egt';
    if (e.salle==='3T') cls='e3t';
    else if (e.salle==='3TC') cls='e3tc';
    else if (e.salle==='Tournée') cls='etour';
    if (e.myRole==='observateur') cls='eobs';

    const dotColor = {e3t:'var(--c3t)',e3tc:'var(--c3tc)',egt:'var(--cgt)',etour:'var(--ctour)',eobs:'var(--cobs)'}[cls]||'var(--cgt)';
    const salleLabel = e.salle==='3TC'?'3T Côté':e.salle==='GT'?'Grand Théâtre':e.salle;
    const others = e.regies.filter(r=>r.reg!==reg).map(r=>r.reg);

    const badges = [];
    if (e.h) badges.push(`<span class="today-badge">${e.h}</span>`);
    if (e.cancelled) badges.push('<span class="today-badge tb-cancel">❌ annulé</span>');
    if (e.guest) badges.push('<span class="today-badge tb-guest">🎤 invité</span>');
    if (e.special) badges.push(`<span class="today-badge">${e.special}</span>`);
    if (e.myRole==='observateur') badges.push('<span class="today-badge">observation</span>');
    if (e.isFormateur) badges.push('<span class="today-badge">formation</span>');
    if (others.length) badges.push(`<span class="today-badge">avec ${others.join(', ')}</span>`);
    const nameStyle = e.cancelled ? 'color:#f87171;text-decoration:line-through' : '';

    cardsHTML += `<div class="today-card ${cls}"${i>0?' style="margin-top:6px"':''}>
      <div class="today-top">
        <span class="today-label">Régie du jour${entries.length>1?' ('+(i+1)+'/'+entries.length+')':''}</span>
        <span style="font-size:11px;color:var(--muted)">${i===0?timeStr:''}</span>
      </div>
      ${i===0?`<div style="font-size:11px;color:var(--muted2);margin-bottom:4px">${dateStr}</div>`:''}
      <div style="display:flex;align-items:center;gap:8px">
        <div class="today-dot" style="background:${dotColor}"></div>
        <div class="today-name" style="${nameStyle}">${e.spec||'—'}</div>
      </div>
      <div class="today-meta">${salleLabel}</div>
      ${badges.length ? `<div class="today-badges">${badges.join('')}</div>` : ''}
    </div>`;
  });

  wrap.innerHTML = hsuppReminderHTML() + cardsHTML + todayFm;
}

function buildTeamDayMap(y, m) {
  // Like buildDayMap but includes ALL régisseurs, keeping régie info
  const nbDays = new Date(y, m, 0).getDate();
  const map = {};
  for (let d = 1; d <= nbDays; d++) {
    const isoKey = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData = allDays.find(x => x.date.toISOString().slice(0,10) === isoKey);
    map[d] = dayData ? dayData.entries.filter(e => e.regies.length > 0 || e.unassigned).map(e => ({
      ...e,
      myRole: 'titulaire',
      isFormateur: false,
      // In team mode, show all regisseurs as meta
    })) : [];
  }
  return map;
}

function onTeamToggle() {
  const teamMode = isTeamMode();
  const regWrap = document.getElementById('reg-select-wrap');
  regWrap.style.opacity = teamMode ? '0.35' : '1';
  regWrap.style.pointerEvents = teamMode ? 'none' : '';
  selectedDay = null;
  renderCalendar(); // renderCalendar now calls renderStats internally
  if (isSearchActive()) searchByDate();
}

let currentView = 'week';
// Échelles « calendrier » regroupées dans la page Home (Semaine / Mois / Année)
const CAL_SCALES = ['week','grid','year'];
// Vues de la page HOME (calendrier + agenda en liste)
const HOME_VIEWS = ['week','grid','year','list'];
const SCALE_ORDER = { hsupp:0, week:1, grid:2, year:3, list:4, resume:5 };   // sens des animations de switch
let calLastScale = 'week';
let homeLastView = 'week';   // dernière vue Home (week/grid/year/list)
let _calPreview = false;     // vrai pendant le pré-rendu d'aperçu d'un swipe

// ── PAGES (ordre des icônes du bas) : 0=Heures (gauche) · 1=Home (centre) ──
// Le SWIPE navigue entre ces pages (Plus = volet, ouvert au tap).
function currentPageIdx(){
  if(currentView==='hsupp') return 0;
  if(HOME_VIEWS.includes(currentView)) return 1;
  return -1;   // résumé / autre → pas de swipe entre pages
}
function pageView(idx){
  if(idx===0) return 'hsupp';
  if(idx===1) return homeLastView || 'week';
  return null;
}

// Ouvre la page Home sur la dernière vue utilisée
function openCal(){ switchView(homeLastView || 'week'); }

const ICON_LIST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>';
const ICON_MONTH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17"/></svg>';

// Bascule Mois ↔ Liste (agenda) dans la page Home
function toggleAgenda(){ switchView(currentView==='list' ? 'grid' : 'list'); }

function switchView(v, skipAnim) {
  const prev = currentView;
  currentView = v;
  if(CAL_SCALES.includes(v)) calLastScale = v;
  if(HOME_VIEWS.includes(v)) homeLastView = v;
  document.body.classList.toggle('page-hsupp', v==='hsupp');
  // Always reset search state when changing tab
  document.getElementById('view-search').style.display = 'none';
  document.getElementById('grid-body').style.display = '';
  document.getElementById('search-date').value = '';
  document.getElementById('search-clear').style.display = 'none';
  ['week','grid','year','list','resume','hsupp'].forEach(name => {
    const vc = document.getElementById('view-'+name); if(vc) vc.style.display = name===v ? '' : 'none';
  });
  // Onglets PC : « Calendrier » actif pour toutes les échelles
  const tcal = document.getElementById('tab-cal'); if(tcal) tcal.classList.toggle('active', CAL_SCALES.includes(v));
  ['list','resume'].forEach(name => { const tb=document.getElementById('tab-'+name); if(tb) tb.classList.toggle('active', name===v); });
  // Sélecteur d'échelle : visible sur les vues calendrier ET sur l'agenda (Liste = Mois en liste).
  const seg = document.getElementById('cal-scale-switch');
  if(seg){
    seg.style.display = (CAL_SCALES.includes(v) || v==='list') ? '' : 'none';
    const activeScale = (v==='list') ? 'grid' : v;   // la Liste correspond à l'échelle Mois
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.scale===activeScale));
  }
  // Bouton Mois ↔ Liste : visible en vue Mois et Liste
  const agToggle = document.getElementById('btn-agenda-toggle');
  if(agToggle){
    const lbl=document.getElementById('agenda-toggle-lbl'), ico=document.getElementById('agenda-toggle-ico');
    if(v==='list'){ if(lbl) lbl.textContent='Vue mois'; if(ico) ico.innerHTML=ICON_MONTH; }
    else { if(lbl) lbl.textContent='Vue liste'; if(ico) ico.innerHTML=ICON_LIST; }
    agToggle.classList.toggle('ag-hidden', !(v==='grid' || v==='list'));   // apparition/disparition animée
  }
  // Nav du mois (‹ mois › Auj.) : utile seulement sur Mois / Agenda / Résumé,
  // inutile sur Semaine (semaine en cours) et Année (tous les mois affichés).
  const mnav = document.getElementById('month-nav');
  if(mnav) mnav.classList.toggle('mnav-hidden', !(v==='grid' || v==='list' || v==='resume'));
  renderCalendar();   // dispatche selon currentView (stats + bonne vue)
  updateBottomNav();
  if(!skipAnim) animateView(prev, v);
  // La hauteur de l'en-tête change (nav du mois masquée/affichée) → recalcule le sticky
  if(typeof updateStickyOffsets==='function') requestAnimationFrame(updateStickyOffsets);
}

// Animation de transition (carrousel) : la vue entrante glisse depuis la droite
// (échelle suivante / plus large) ou depuis la gauche (échelle précédente).
function animateView(prev, v){
  const el = document.getElementById('view-'+v);
  if(!el) return;
  const delta = (SCALE_ORDER[v] ?? 1) - (SCALE_ORDER[prev] ?? 1);
  el.classList.remove('cal-anim-fwd','cal-anim-back');
  void el.offsetWidth;                       // force un reflow pour rejouer l'animation
  el.classList.add(delta >= 0 ? 'cal-anim-fwd' : 'cal-anim-back');
  setTimeout(()=>el.classList.remove('cal-anim-fwd','cal-anim-back'), 360);
}

// ── Barre d'onglets bas (mobile) ──
function updateBottomNav(){
  const set = (id,on)=>{ const el=document.getElementById(id); if(el) el.classList.toggle('active', on); };
  set('bnav-hsupp', currentView === 'hsupp');
  set('bnav-home', HOME_VIEWS.includes(currentView));
}

// ── Carrousel : Heures · Semaine · Mois · Année ──
// Scale (Semaine/Mois/Année) → seule la VUE calendrier glisse.
// Passage Home ↔ Heures → la PAGE ENTIÈRE glisse.
(function initCalCarousel(){
  const pages = document.getElementById('pages');
  const vc = document.getElementById('view-container');
  const gestureEl = document.getElementById('app-screen') || pages;
  if(!pages || !gestureEl) return;
  try{ _calPreview=true; renderHsupp(); _calPreview=false; }catch(_){}
  const SEQ = ['hsupp','week','grid','year'];          // ordre linéaire du swipe
  const seqIdx = () => currentView==='list' ? 2 : SEQ.indexOf(currentView);
  const viewEl = s => document.getElementById('view-'+s);
  const pageWrap = isH => document.getElementById(isH ? 'page-hsupp' : 'page-home');
  function renderInto(view){ const s=currentView; currentView=view; _calPreview=true; try{renderCalendar()}catch(_){} _calPreview=false; currentView=s; }

  let sx=0, sy=0, decided=false, mode=null, w=1, animating=false;
  let curEl=null, nbEl=null, nbInner=null, dir=0, slideType=null;
  function clearT(el){ if(!el) return; el.style.transition=''; el.style.transform=''; el.style.position=''; el.style.top=''; el.style.left=''; el.style.right=''; el.style.zIndex=''; }
  // Remet en ordre une transition (sur des éléments capturés localement)
  function settle(c, n, inner, st, committed){
    clearT(c); clearT(n);
    if(st==='page'){
      if(c) c.style.display='';
      if(n) n.style.display='';
      if(!committed && inner) inner.style.display='none';
    } else if(st==='scale'){
      if(!committed && n) n.style.display='none';
    }
  }

  gestureEl.addEventListener('touchstart', e=>{
    decided=false; mode=null; curEl=nbEl=null; nbInner=null; slideType=null;
    if(e.touches.length!==1 || animating){ decided=true; return; }   // pas de nouveau geste pendant une animation
    sx=e.touches[0].clientX; sy=e.touches[0].clientY;
    w = pages.clientWidth || window.innerWidth || 1;
  }, {passive:true});

  gestureEl.addEventListener('touchmove', e=>{
    if(decided && mode!=='h') return;
    const dx=e.touches[0].clientX-sx, dy=e.touches[0].clientY-sy;
    if(!decided){
      if(Math.abs(dx)<6 && Math.abs(dy)<6) return;
      decided=true;
      const idx = seqIdx();
      if(Math.abs(dx) > Math.abs(dy)*1.2 && idx>=0){
        mode='h';
        dir = dx<0 ? 1 : -1;
        const ni = idx+dir, target = (ni>=0 && ni<SEQ.length) ? SEQ[ni] : null;
        const crossesPage = currentView==='hsupp' || target==='hsupp';
        slideType = crossesPage ? 'page' : 'scale';
        curEl = (slideType==='page') ? pageWrap(currentView==='hsupp') : viewEl(currentView);
        if(curEl) curEl.style.transition='none';
        if(target){
          if(slideType==='page'){
            nbEl = pageWrap(target==='hsupp');
            nbInner = viewEl(target==='hsupp' ? 'hsupp' : target);
            if(nbInner) nbInner.style.display='';
            const top = (window.pageYOffset || document.scrollingElement.scrollTop || 0) + 'px';
            nbEl.style.display='block'; nbEl.style.position='absolute'; nbEl.style.top=top; nbEl.style.left='0'; nbEl.style.right='0'; nbEl.style.zIndex='3'; nbEl.style.transition='none'; nbEl.style.transform='translateX('+(dir*100)+'%)';
          } else {
            renderInto(target);
            nbEl = viewEl(target);
            const top = ((curEl?curEl.offsetTop:0) + (vc?vc.scrollTop:0)) + 'px';
            if(nbEl){ nbEl.style.display=''; nbEl.style.position='absolute'; nbEl.style.top=top; nbEl.style.left='0'; nbEl.style.right='0'; nbEl.style.zIndex='3'; nbEl.style.transition='none'; nbEl.style.transform='translateX('+(dir*100)+'%)'; }
          }
        } else { nbEl=null; }
      } else { mode='scroll'; }
    }
    if(mode==='h'){
      e.preventDefault();
      let move=dx;
      if(!nbEl) move*=0.34;
      if(curEl) curEl.style.transform='translateX('+move+'px)';
      if(nbEl) nbEl.style.transform='translateX(calc('+(dir*100)+'% + '+move+'px))';
    }
  }, {passive:false});

  function endGesture(e){
    if(mode==='h'){
      const dx=(e.changedTouches?e.changedTouches[0].clientX:sx)-sx;
      const ni = seqIdx()+dir;
      const target = (ni>=0 && ni<SEQ.length) ? SEQ[ni] : null;
      const tr='transform .22s cubic-bezier(.22,.61,.36,1)';
      const commit = nbEl && target && Math.abs(dx) > Math.min(70, w*0.18);
      // capture locale : un nouveau geste ne pourra pas corrompre cette animation
      const c=curEl, n=nbEl, inner=nbInner, st=slideType, d=dir;
      curEl=nbEl=nbInner=null; slideType=null; dir=0;
      animating=true;
      const finish=()=>{ try{ settle(c, n, inner, st, commit); if(commit){ if(st==='page') window.scrollTo(0,0); switchView(target, true); } }catch(_){} animating=false; };
      if(commit){
        if(c){ c.style.transition=tr; c.style.transform='translateX('+(-d*w)+'px)'; }
        if(n){ n.style.transition=tr; n.style.transform='translateX(0)'; }
        setTimeout(finish, 230);
      } else {
        if(c){ c.style.transition=tr; c.style.transform='translateX(0)'; }
        if(n){ n.style.transition=tr; n.style.transform='translateX('+(d*100)+'%)'; }
        setTimeout(finish, 250);
      }
    }
    decided=false; mode=null;
  }
  gestureEl.addEventListener('touchend', endGesture, {passive:true});
  gestureEl.addEventListener('touchcancel', endGesture, {passive:true});
})();

// ── Pull-to-refresh : en haut de page, la page descend (overscroll natif) + anneau en haut ──
// Retour haptique : Vibration API (Android). iOS web ne supporte pas les vibrations
// (l'astuce <input switch> n'a pas fonctionné) → no-op silencieux sur iPhone.
function hapticTick(ms){
  try{ if(navigator.vibrate) navigator.vibrate(ms||12); }catch(_){}
}

(function initPullToRefresh(){
  let sy=0, sx=0, active=false, pulling=false, armed=false, refreshing=false, ptr=null;
  const scroller = () => document.scrollingElement || document.documentElement;
  const atTop = () => (window.pageYOffset || scroller().scrollTop || 0) <= 0;
  const haptic = (ms)=>hapticTick(ms);
  function ensurePtr(){
    if(ptr) return ptr;
    ptr=document.createElement('div'); ptr.id='ptr-spin';
    ptr.innerHTML='<span class="ptr-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3.5v5h-5"/></svg></span>';
    document.body.appendChild(ptr);
    return ptr;
  }
  function hide(p){ p.style.transition='transform .26s cubic-bezier(.22,.61,.36,1),opacity .26s'; p.style.opacity='0'; p.style.transform='translate(-50%,-46px)'; p.classList.remove('ready','spinning'); }

  // Un volet/modale est-il ouvert ? (alors pas de pull-to-refresh)
  function anyOverlayOpen(){
    return [...document.querySelectorAll('.modal-overlay')].some(m => getComputedStyle(m).display !== 'none');
  }
  document.addEventListener('touchstart', e=>{
    active=false; pulling=false; armed=false;
    if(e.touches.length!==1 || refreshing || typeof appIsOpen!=='function' || !appIsOpen()) return;
    if(anyOverlayOpen()) return;          // un volet est ouvert → pas de refresh
    if(!atTop()) return;
    active=true; sy=e.touches[0].clientY; sx=e.touches[0].clientX;
  }, {passive:true});

  // passif : on NE bloque PAS le geste → la page descend naturellement (overscroll), on superpose l'anneau
  document.addEventListener('touchmove', e=>{
    if(!active) return;
    const dy=e.touches[0].clientY-sy, dx=e.touches[0].clientX-sx;
    if(!pulling){
      if(Math.abs(dx) > Math.abs(dy) || dy < 6){ if(dy < -2) active=false; return; }
      if(!atTop()){ active=false; return; }
      pulling=true;
    }
    if(dy<=0 || !atTop()){ if(ptr && !refreshing) hide(ptr); active=false; return; }
    const p=ensurePtr();
    const pull=Math.min(110, dy);
    p.style.transition='none';
    p.style.opacity=Math.min(1, pull/45).toFixed(3);
    p.style.transform='translate(-50%,'+Math.min(70, pull*0.55)+'px)';   // l'anneau descend dans l'espace révélé
    const ico=p.querySelector('.ptr-ico');
    const nowArmed = pull>=66;
    if(nowArmed){
      if(!armed){ armed=true; haptic(14); }                 // tic haptique au passage du seuil (Android)
      p.classList.add('ready'); p.classList.add('spinning'); // au plus haut → la flèche se met à tourner
      if(ico) ico.style.transform='';                        // laisse l'animation prendre le relais
    } else {
      armed=false; p.classList.remove('ready'); p.classList.remove('spinning');
      if(ico) ico.style.transform='rotate('+(pull*3)+'deg)'; // sinon : rotation suit le pull
    }
  }, {passive:true});

  function end(){
    if(!pulling){ active=false; return; }
    pulling=false; active=false;
    const p=ptr; if(!p) return;
    if(p.classList.contains('ready')){
      refreshing=true; haptic(18);
      const ico=p.querySelector('.ptr-ico'); if(ico) ico.style.transform='';
      p.style.transition='transform .25s cubic-bezier(.22,.61,.36,1),opacity .2s';
      p.style.opacity='1'; p.style.transform='translate(-50%,22px)';
      p.classList.add('spinning'); p.classList.remove('ready');
      Promise.resolve(typeof refreshData==='function' ? refreshData() : null)
        .catch(()=>{}).finally(()=>{ setTimeout(()=>{ hide(p); refreshing=false; }, 400); });
    } else { hide(p); }
  }
  document.addEventListener('touchend', end, {passive:true});
  document.addEventListener('touchcancel', end, {passive:true});
})();
function openMoreMenu(){
  const m = document.getElementById('more-modal'), sheet = document.getElementById('more-sheet');
  if(!m) return;
  m.style.display = 'flex';
  if(!sheet){ return; }
  sheet.style.transition='none'; sheet.style.transform='translateY(100%)';
  m.style.transition='none'; m.style.opacity='0';
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    sheet.style.transition='transform .28s cubic-bezier(.22,.61,.36,1)'; sheet.style.transform='translateY(0)';
    m.style.transition='opacity .26s ease'; m.style.opacity='1';
  }));
}
let _moreClosing = false;
function closeMoreMenu(){
  const m = document.getElementById('more-modal'), sheet = document.getElementById('more-sheet');
  if(!m || _moreClosing) return;
  if(!sheet){ m.style.display='none'; return; }
  _moreClosing = true;
  sheet.style.transition='transform .24s cubic-bezier(.4,0,.6,1)';
  sheet.style.transform='translateY(100%)';
  m.style.transition='opacity .24s ease'; m.style.opacity='0';
  setTimeout(()=>{ m.style.display='none'; m.style.opacity=''; m.style.transition=''; sheet.style.transition=''; sheet.style.transform=''; _moreClosing=false; }, 230);
}

// Fermer le volet « Plus » en balayant vers le bas
(function initMoreSheetSwipe(){
  const sheet=document.getElementById('more-sheet'); if(!sheet) return;
  let y0=0, dragging=false;
  sheet.addEventListener('touchstart', e=>{
    if(e.touches.length!==1){ dragging=false; return; }
    y0=e.touches[0].clientY; dragging=true; sheet.style.transition='none';
  }, {passive:true});
  sheet.addEventListener('touchmove', e=>{
    if(!dragging) return;
    const dy=e.touches[0].clientY-y0;
    if(dy>0){ e.preventDefault(); sheet.style.transform='translateY('+dy+'px)'; }
  }, {passive:false});
  function end(e){
    if(!dragging) return; dragging=false;
    const dy=(e.changedTouches?e.changedTouches[0].clientY:y0)-y0;
    if(dy>90){ closeMoreMenu(); }   // anime jusqu'en bas + masque (depuis la position actuelle)
    else { sheet.style.transition='transform .22s ease'; sheet.style.transform='translateY(0)'; setTimeout(()=>{ sheet.style.transition=''; sheet.style.transform=''; }, 230); }
  }
  sheet.addEventListener('touchend', end, {passive:true});
  sheet.addEventListener('touchcancel', end, {passive:true});
})();

// #6 — Recherche accessible depuis n'importe quelle vue (loupe de l'en-tête)
function openSearch() {
  switchView('grid');
  const inp = document.getElementById('search-spec');
  if (inp) {
    inp.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setTimeout(() => inp.focus(), 120);
  }
}

// ─── SEARCH BY DATE ──────────────────────────────────────────────────────────
function searchByDate() {
  const val = document.getElementById('search-date').value; // YYYY-MM-DD
  if (!val) { clearSearch(); return; }
  document.getElementById('search-clear').style.display = 'block';

  // Inside the grid tab: hide the calendar body, show the results
  document.getElementById('grid-body').style.display = 'none';
  const container = document.getElementById('view-search');
  container.style.display = '';

  const teamMode = isTeamMode();
  const reg = getCurrentReg();
  const dayData = allDays.find(x => x.date.toISOString().slice(0,10) === val);

  // Pretty date label
  const [yy,mm,dd] = val.split('-').map(Number);
  const dateObj = new Date(Date.UTC(yy, mm-1, dd));
  const dateStr = dateObj.toLocaleDateString('fr-FR', {
    weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC'
  });

  // In personal mode, only show entries involving the selected régisseur
  let entries = dayData ? dayData.entries.slice() : [];
  if (!teamMode) {
    entries = entries.filter(e => (e.regies && e.regies.some(r => r.reg === reg)) || e.unassigned);
  }

  const scopeLabel = teamMode ? 'toute l\'équipe' : reg;

  if (!entries.length) {
    container.innerHTML = `
      <div class="search-results">
        <div class="search-result-date">${dateStr}</div>
        <div class="search-empty">Aucune activité ce jour-là (${scopeLabel}).</div>
      </div>`;
    return;
  }

  const salleLabelOf = s => s==='3TC' ? '3T Côté' : s==='GT' ? 'Grand Théâtre' : s;
  const clsOf = s => s==='3T' ? 'e3t' : s==='3TC' ? 'e3tc' : s==='Tournée' ? 'etour' : 'egt';

  let cards = '';
  entries.forEach(e => {
    const cls = e.unassigned ? 'eunassigned' : clsOf(e.salle);
    const salleLabel = salleLabelOf(e.salle);
    const timeStr = e.h ? ` · ${e.h}` : '';

    let chips = '';
    if (e.regies && e.regies.length) {
      chips = e.regies.map(r => {
        const isObs = r.role === 'observateur';
        return `<span class="search-reg-chip${isObs?' obs':''}">${roleDot(r)}${r.reg}</span>`;
      }).join('');
    } else if (e.unassigned) {
      chips = `<span class="search-reg-chip">Personne assigné</span>`;
    }

    const meta = (e.salle==='Tournée' ? 'Tournée' : `${salleLabel}${timeStr}`) + (e.cancelled ? ' · ❌ annulé' : '');
    cards += `
      <div class="search-card ${cls}">
        <div class="ev-name" style="${e.cancelled?'text-decoration:line-through;opacity:.6':''}">${e.spec || '—'}</div>
        <div class="search-meta">${meta}</div>
        ${chips ? `<div class="search-regies">${chips}</div>` : ''}
      </div>`;
  });

  const n = entries.length;
  container.innerHTML = `
    <div class="search-results">
      <div class="search-result-date">${dateStr}</div>
      <div class="search-result-sub">${n} activité${n>1?'s':''} · ${scopeLabel}</div>
      ${cards}
    </div>`;
}

function clearSearch() {
  document.getElementById('search-date').value = '';
  document.getElementById('search-clear').style.display = 'none';
  document.getElementById('view-search').style.display = 'none';
  document.getElementById('grid-body').style.display = '';
}

// ─── RECHERCHE PAR SPECTACLE / ARTISTE ───────────────────────────────────────
function clearSpecSearch() {
  document.getElementById('search-spec').value = '';
  document.getElementById('search-spec-clear').style.display = 'none';
  document.getElementById('view-search').style.display = 'none';
  document.getElementById('grid-body').style.display = '';
}

function searchBySpec() {
  const raw = document.getElementById('search-spec').value.trim();
  const q = norm(raw);
  if (!q) { clearSpecSearch(); return; }
  document.getElementById('search-spec-clear').style.display = 'block';
  // On désactive la recherche par date pendant ce temps
  document.getElementById('search-date').value = '';
  document.getElementById('search-clear').style.display = 'none';
  document.getElementById('grid-body').style.display = 'none';
  const container = document.getElementById('view-search');
  container.style.display = '';

  // Regroupe toutes les occurrences par spectacle (toute la saison, toute l'équipe)
  const map = new Map();
  allDays.forEach(d => {
    const iso = d.date.toISOString().slice(0,10);
    d.entries.forEach(e => {
      if (!e.spec) return;
      const key = norm(e.spec);
      if (!map.has(key)) map.set(key, {
        display: e.spec,
        guest: e.guest,
        tournee: e.salle === 'Tournée',
        occ: []
      });
      map.get(key).occ.push({date:d.date, salle:e.salle, h:e.h, regies:e.regies||[], cancelled:!!e.cancelled});
    });
  });

  let list = [...map.values()].filter(s => norm(s.display).includes(q));
  list.sort((a,b) => a.display.localeCompare(b.display,'fr'));

  if (!list.length) {
    container.innerHTML = `<div class="search-results"><div class="search-empty">Aucun spectacle ne correspond à « ${raw} ».</div></div>`;
    return;
  }

  const salleLabelOf = s => s==='3TC'?'3T Côté':s==='GT'?'Grand Théâtre':s==='Tournée'?'Tournée':s;
  const clsOf = s => s==='3T'?'e3t':s==='3TC'?'e3tc':s==='Tournée'?'etour':'egt';

  const cardFor = (s) => {
    // occurrences triées par date
    const occ = s.occ.slice().sort((a,b)=>a.date-b.date);
    const rows = occ.map(o => {
      const day = o.date.getUTCDate();
      const iso = o.date.toISOString().slice(0,10);
      const lbl = o.date.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
      const regs = o.regies.length ? o.regies.map(r=>r.reg).join(', ') : '—';
      const strike = o.cancelled ? 'text-decoration:line-through;opacity:.55' : '';
      const cx = o.cancelled ? ' · ❌ annulé' : '';
      return `<div class="spec-occ" onclick="jumpToDate('${iso}',${day})" style="${strike}">
        <span class="spec-occ-date">${lbl}</span>
        <span class="spec-occ-meta">${salleLabelOf(o.salle)}${o.h?' · '+o.h:''} · ${regs}${cx}</span>
      </div>`;
    }).join('');
    const badge = s.guest ? '<span class="ev-badge bdg-guest">🎤 invité</span>'
                : s.tournee ? '<span class="ev-badge bdg-h">tournée</span>' : '';
    return `<div class="search-card ${clsOf(occ[0].salle)}" style="cursor:default">
      <div class="ev-top"><span class="ev-name">${s.display}</span><div class="ev-badges">${badge}<span class="ev-badge bdg-h">${occ.length}×</span></div></div>
      <div class="spec-occ-list">${rows}</div>
    </div>`;
  };

  const theatre = list.filter(s=>!s.guest && !s.tournee);
  const guests  = list.filter(s=>s.guest);
  const tours   = list.filter(s=>s.tournee);
  let html = `<div class="search-results"><div class="search-result-sub">${list.length} résultat${list.length>1?'s':''} pour « ${raw} »</div>`;
  if (theatre.length) html += `<div class="spec-group">🎭 Spectacles</div>` + theatre.map(cardFor).join('');
  if (guests.length)  html += `<div class="spec-group">🎤 Artistes invités</div>` + guests.map(cardFor).join('');
  if (tours.length)   html += `<div class="spec-group">🚐 Tournées</div>` + tours.map(cardFor).join('');
  html += `</div>`;
  container.innerHTML = html;
}

// Ouvre la date d'une occurrence dans le calendrier
function jumpToDate(iso, day) {
  const mk = iso.slice(0,7);
  const sel = document.getElementById('mois-select');
  if ([...sel.options].some(o => o.value === mk)) sel.value = mk;
  clearSpecSearch();
  renderCalendar();
  selectDay(day);
  setTimeout(()=>document.getElementById('detail-panel')?.scrollIntoView({behavior:'smooth',block:'center'}), 60);
}

function buildDayMap(reg, y, m) {
  const nbDays = new Date(y, m, 0).getDate();
  const map = {};
  for (let d = 1; d <= nbDays; d++) {
    const isoKey = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData = allDays.find(x => x.date.toISOString().slice(0,10) === isoKey);
    map[d] = dayData
      ? dayData.entries
          .filter(e => e.regies.some(r => r.reg === reg) || e.unassigned)
          .map(e => ({...e,
            myRole: e.regies.find(r => r.reg === reg)?.role,
            isFormateur: e.regies.find(r => r.reg === reg)?.isFormateur || false
          }))
      : [];
  }
  return map;
}

// Bouton "Me positionner / Me retirer" pour une entrée (réutilisé partout).
// Empile l'action dans dayActions et renvoie le HTML du bouton (ou '').
function posActionHTML(e, y, m, dateLabel){
  const me = myRegName();
  if(!(me && e.src && e.salle !== 'Tournée')) return '';
  const salleLabel = e.salle==='3TC'?'3T Côté':e.salle==='GT'?'Grand Théâtre':e.salle;
  if(e.unassigned){
    const i = dayActions.push({type:'add', src:e.src, spec:e.spec||'—', me, salleLabel, dateLabel}) - 1;
    return `<button id="act-${i}" class="pos-btn add" onclick="doPosition(${i})">➕ Me positionner</button>`;
  }
  const iAmIn = (e.regies||[]).some(r => r.reg === me && r.role !== 'observateur');
  if(iAmIn){
    const now = new Date();
    const isPast = (y < now.getFullYear()) || (y === now.getFullYear() && m < now.getMonth()+1);
    if(!isPast){
      const i = dayActions.push({type:'remove', src:e.src, spec:e.spec||'—', me, salleLabel, dateLabel}) - 1;
      return `<button id="act-${i}" class="pos-btn remove" onclick="doPosition(${i})">➖ Me retirer</button>`;
    }
  }
  return '';
}

function eventCardHTML(e, reg, teamMode, posCtx) {
  let cls = 'egt';
  if (e.salle==='3T') cls='e3t';
  else if (e.salle==='3TC') cls='e3tc';
  else if (e.salle==='Tournée') cls='etour';
  if (!teamMode && e.myRole==='observateur') cls='eobs';
  if (e.unassigned) cls='eunassigned';
  const salleLabel = e.salle==='3TC'?'3T Côté':e.salle==='GT'?'Grand Théâtre':e.salle;
  const badges = [];
  if (e.h) badges.push(`<span class="ev-badge bdg-h">${e.h}</span>`);
  if (e.cancelled) badges.push('<span class="ev-badge bdg-cancel">❌ annulé</span>');
  if (e.guest) badges.push('<span class="ev-badge bdg-guest">🎤 invité</span>');
  if (e.special) badges.push(`<span class="ev-badge bdg-special">${e.special}</span>`);

  let meta, who = '';
  if (teamMode) {
    // Mode équipe : on liste TOUS les régisseurs positionnés (moi inclus)
    const list = (e.regies||[]).map(r => {
      const isMe = r.reg === myRegName();
      return `<span class="ev-reg${isMe?' me':''}">${roleDot(r)}${r.reg}</span>`;
    });
    who = list.length
      ? `<div class="ev-regs">${list.join('')}</div>`
      : `<div class="ev-regs"><span class="ev-reg none">Non attribué</span></div>`;
    meta = e.salle==='Tournée' ? 'Tournée · ~180€' : salleLabel;
  } else {
    const others = e.regies.filter(r=>r.reg!==reg).map(r=>r.reg);
    const withStr = others.length ? ` · avec ${others.join(', ')}` : '';
    if (e.myRole==='observateur') badges.push('<span class="ev-badge bdg-obs">observation</span>');
    if (e.isFormateur) badges.push('<span class="ev-badge bdg-form">formation</span>');
    meta = e.salle==='Tournée' ? `Tournée · ~180€${withStr}`
      : e.myRole==='observateur' ? `${salleLabel} · heures techniques${withStr}`
      : `${salleLabel}${withStr}`;
  }
  const action = posCtx ? posActionHTML(e, posCtx.y, posCtx.m, posCtx.dateLabel) : '';
  return `<div class="event-card ${cls}${e.cancelled?' ecancel':''}">
    <div class="ev-top"><span class="ev-name">${e.spec||'—'}</span><div class="ev-badges">${badges.join('')}</div></div>
    <div class="ev-meta">${meta}</div>
    ${who}
    ${action}
  </div>`;
}

// ── AGENDA VIEW ────────────────────────────────────────────────────────────
function isDesktop(){ return window.matchMedia('(min-width:768px)').matches; }

// Tableau lisible réservé au PC quand "Voir toute l'équipe" est actif
function renderTeamTable(y, m){
  const dayMap = buildTeamDayMap(y, m);
  const jourStr = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const todayKey = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`;
  const salleLabelOf = s => s==='3TC'?'3T Côté':s==='GT'?'Grand Théâtre':s;
  const salleColor = {'3T':'var(--c3t)','3TC':'var(--c3tc)','GT':'var(--cgt)','Tournée':'var(--ctour)'};
  const me = myRegName();
  const nbDays = new Date(y, m, 0).getDate();
  dayActions = [];   // actions "Me positionner / Me retirer" du tableau

  let rows = '';
  for (let d = 1; d <= nbDays; d++) {
    const entries = (dayMap[d] || []).filter(agendaPass);
    if (!entries || entries.length === 0) continue;
    const isoKey = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = isoKey === todayKey;
    const dow = new Date(y, m-1, d).getDay();
    entries.forEach((e, idx) => {
      const regs = (e.regies||[]).map(r=>{
        const isMe = r.reg===me;
        return `<span class="ev-reg${isMe?' me':''}">${roleDot(r)}${r.reg}</span>`;
      });
      const who = regs.length ? regs.join('') : `<span class="ev-reg none">Non attribué</span>`;
      let specCell = e.spec||'—';
      if (e.cancelled) specCell += ' <span class="ev-badge bdg-cancel">❌ annulé</span>';
      else if (e.guest) specCell += ' <span class="ev-badge bdg-guest">🎤 invité</span>';
      if (e.special) specCell += ` <span class="ev-badge bdg-special">${e.special}</span>`;
      const rowCls = (isToday?'tt-today':'') + (idx===0?' tt-daystart':'') + (e.cancelled?' tt-cancel':(e.guest?' tt-guest':''));
      const action = posActionHTML(e, y, m, `${jourStr[dow]} ${d}`);
      rows += `<tr class="${rowCls}">
        <td class="tt-day">${idx===0?`<b>${d}</b> ${jourStr[dow]}`:''}</td>
        <td><span class="tt-salle" style="--sc:${salleColor[e.salle]||'var(--muted)'}">${salleLabelOf(e.salle)}</span></td>
        <td class="tt-spec">${specCell}</td>
        <td class="tt-h">${e.h||''}</td>
        <td class="tt-regs">${who}</td>
        <td class="tt-act">${action}</td>
      </tr>`;
    });
  }
  if (!rows) return '<div style="padding:2rem;text-align:center;color:var(--muted);font-size:14px">Aucune activité ce mois</div>';
  return `<div class="team-table-wrap"><table class="team-table">
    <thead><tr><th>Jour</th><th>Salle</th><th>Spectacle</th><th>H.</th><th>Régisseurs</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// #7 — Filtres de l'agenda (puces : toutes / mes régies / non attribuées / par salle)
let agendaFilter = 'all';
const AGENDA_FILTERS = [
  { id:'all',        label:'Toutes' },
  { id:'mine',       label:'Mes régies' },
  { id:'unassigned', label:'Non attribuées' },
  { id:'3T',         label:'3T',            color:'var(--c3t)' },
  { id:'3TC',        label:'3T Côté',       color:'var(--c3tc)' },
  { id:'GT',         label:'Grand Théâtre', color:'var(--cgt)' },
  { id:'Tournée',    label:'Tournée',       color:'var(--ctour)' },
  { id:'formation',  label:'Formations',    icon:'📚' },
];
function agendaFilterBar(){
  return '<div class="agenda-filters">' + AGENDA_FILTERS.map(f =>
    `<button class="afilter${agendaFilter===f.id?' active':''}" onclick="setAgendaFilter('${f.id}')">`
    + (f.icon?f.icon+' ':'') + (f.color?`<span class="adot" style="background:${f.color}"></span>`:'') + f.label + '</button>'
  ).join('') + '</div>';
}
function setAgendaFilter(id){
  agendaFilter = id;
  const reg = getCurrentReg();
  const [y, m] = document.getElementById('mois-select').value.split('-').map(Number);
  renderList(reg, y, m);
}
function agendaPass(e){
  const me = myRegName();
  switch(agendaFilter){
    case 'mine':       return (e.regies||[]).some(r => r.reg===me && r.role!=='observateur');
    case 'unassigned': return !!e.unassigned;
    case '3T': case '3TC': case 'GT': case 'Tournée': return e.salle===agendaFilter;
    default:           return true;
  }
}

// ── VUE « MA SEMAINE » ───────────────────────────────────────────────────────
// Entrées d'un jour (par ISO) avec le même filtrage que buildDayMap/buildTeamDayMap
function weekEntries(reg, iso, teamMode){
  const dayData = allDays.find(x => x.date.toISOString().slice(0,10) === iso);
  if(!dayData) return [];
  if(teamMode){
    return dayData.entries.filter(e => e.regies.length > 0 || e.unassigned)
      .map(e => ({...e, myRole:'titulaire', isFormateur:false}));
  }
  return dayData.entries.filter(e => e.regies.some(r => r.reg === reg) || e.unassigned)
    .map(e => ({...e,
      myRole: e.regies.find(r => r.reg === reg)?.role,
      isFormateur: e.regies.find(r => r.reg === reg)?.isFormateur || false }));
}

function renderWeek(reg){
  const teamMode = isTeamMode();
  const jourStr = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const moisStr = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  const today = new Date(); today.setHours(0,0,0,0);
  const dow = (today.getDay() + 6) % 7;                 // 0 = lundi
  const monday = new Date(today); monday.setDate(today.getDate() - dow);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  dayActions = [];
  const title = `Semaine du ${monday.getDate()} ${moisStr[monday.getMonth()]} au ${sunday.getDate()} ${moisStr[sunday.getMonth()]}`;
  let html = `<div class="week-title">📆 ${title}</div><div class="list-view">`;
  for(let i=0; i<7; i++){
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const isToday = d.getTime() === today.getTime();
    const entries = weekEntries(reg, iso, teamMode);
    const posCtx = { y:d.getFullYear(), m:d.getMonth()+1, dateLabel:`${jourStr[d.getDay()]} ${d.getDate()}` };
    const fmHTML = formationCardsHTML(iso);
    const cards = (entries.length || fmHTML)
      ? `<div class="list-day-events">${entries.map(e => eventCardHTML(e, reg, teamMode, posCtx)).join('')}</div>${fmHTML}`
      : `<div class="week-empty">Rien de prévu</div>`;
    html += `<div class="list-day${isToday?' is-today':''}">
      <div class="list-day-header"><span class="list-day-num">${d.getDate()}</span><span class="list-day-label">${jourStr[d.getDay()]}${isToday?' · aujourd\'hui':''}</span></div>
      ${cards}
    </div>`;
  }
  html += '</div>';
  document.getElementById('view-week').innerHTML = html;
}

// ── VUE « ANNÉE » : mini-mois de la saison (clic = zoom sur le mois) ───────────
function renderYear(reg){
  const teamMode = isTeamMode();
  const moisStr = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const now = new Date();
  const tY = now.getFullYear(), tM = now.getMonth()+1, tD = now.getDate();
  let html = '<div class="year-grid">';
  (allMois||[]).forEach(mo => {
    const [y, m] = mo.k.split('-').map(Number);
    const dayMap = teamMode ? buildTeamDayMap(y, m) : buildDayMap(reg, y, m);
    const nbDays = new Date(y, m, 0).getDate();
    const firstDow = new Date(y, m-1, 1).getDay();
    const offset = firstDow === 0 ? 6 : firstDow - 1;   // lundi = 0
    let cells = '';
    for(let i=0;i<offset;i++) cells += '<span class="yd empty"></span>';
    for(let d=1; d<=nbDays; d++){
      const has = (dayMap[d]||[]).some(e => !e.unassigned);
      const isToday = (y===tY && m===tM && d===tD);
      cells += `<span class="yd${has?' has':''}${isToday?' today':''}">${d}</span>`;
    }
    html += `<button class="year-month" onclick="gotoMonth('${mo.k}')">
      <div class="ym-title">${moisStr[m-1]} <span class="ym-y">${String(y).slice(2)}</span></div>
      <div class="ym-grid ym-dows"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div class="ym-grid">${cells}</div>
    </button>`;
  });
  html += '</div>';
  document.getElementById('view-year').innerHTML = html;
}
// Clic sur un mini-mois → zoom sur la vue Mois de ce mois
function gotoMonth(mk){
  const sel = document.getElementById('mois-select');
  if([...sel.options].some(o => o.value===mk)) sel.value = mk;
  selectedDay = null;
  switchView('grid');
}

function renderList(reg, y, m) {
  const teamMode = isTeamMode();
  // PC + équipe → tableau dédié, beaucoup plus lisible (sauf filtre Formations : on garde la liste)
  if (teamMode && isDesktop() && agendaFilter !== 'formation') {
    document.getElementById('view-list').innerHTML = agendaFilterBar() + renderTeamTable(y, m);
    return;
  }
  const dayMap = teamMode ? buildTeamDayMap(y, m) : buildDayMap(reg, y, m);
  const jourStr = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const todayKey = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`;
  let html = agendaFilterBar() + '<div class="list-view">';
  let hasSomething = false;
  const nbDays = new Date(y, m, 0).getDate();
  dayActions = [];   // actions "Me positionner / Me retirer" de l'agenda
  // Les formations s'affichent en "Toutes" et dans le filtre dédié "Formations".
  const onlyForm = agendaFilter === 'formation';
  const showForm = onlyForm || agendaFilter === 'all';
  for (let d = 1; d <= nbDays; d++) {
    const isoKey = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const entries = onlyForm ? [] : (dayMap[d] || []).filter(agendaPass);
    const fmHTML = showForm ? formationCardsHTML(isoKey) : '';
    if ((!entries || entries.length === 0) && !fmHTML) continue;
    hasSomething = true;
    const isToday = isoKey === todayKey;
    const dow = new Date(y, m-1, d).getDay();
    const jourNom = jourStr[dow];
    const dateLabel = `${jourNom} ${d}`;
    const posCtx = { y, m, dateLabel };
    html += `<div class="list-day${isToday?' is-today':''}">
      <div class="list-day-header">
        <span class="list-day-num">${d}</span>
        <span class="list-day-label">${jourNom}</span>
      </div>
      ${entries.length ? `<div class="list-day-events">${entries.map(e => eventCardHTML(e, reg, teamMode, posCtx)).join('')}</div>` : ''}
      ${fmHTML}
    </div>`;
  }
  if (!hasSomething) html += `<div style="padding:2rem;text-align:center;color:var(--muted);font-size:14px">${onlyForm?'Aucune formation ce mois':(agendaFilter==='all'?'Aucune régie ce mois':'Aucun résultat pour ce filtre')}</div>`;
  html += '</div>';
  document.getElementById('view-list').innerHTML = html;
}

// ── RÉSUMÉ VIEW ────────────────────────────────────────────────────────────
function renderResume(reg, y, m) {
  // Le résumé reste TOUJOURS personnel (mode équipe ignoré).
  const teamMode = false;
  const dayMap = buildDayMap(reg, y, m);
  const nbDays = new Date(y, m, 0).getDate();

  // Build spectacle breakdown
  const specMap = {};
  let nTournees = 0;
  let hForfait = 0;

  for (let d = 1; d <= nbDays; d++) {
    (dayMap[d]||[]).forEach(e => {
      if (e.salle === 'Tournée') { nTournees++; return; }
      if (e.myRole === 'observateur' || e.unassigned) return;
      const key = e.spec || '—';
      if (!specMap[key]) specMap[key] = {count:0, salle:e.salle, cls:''};
      specMap[key].count++;
    });
  }

  // Salle colors
  const salleColor = {'3T':'var(--c3t)','3TC':'var(--c3tc)','GT':'var(--cgt)'};
  const specs = Object.entries(specMap).sort((a,b)=>b[1].count-a[1].count);
  const maxCount = specs.length ? specs[0][1].count : 1;

  let specsHTML = '';
  if (specs.length === 0) {
    specsHTML = '<div style="color:var(--muted);font-size:13px;padding:.5rem 0">Aucun spectacle forfaité</div>';
  } else {
    specs.forEach(([name, data]) => {
      const color = salleColor[data.salle] || 'var(--cgt)';
      const pct = Math.round((data.count / maxCount) * 100);
      const salleLabel = data.salle==='3TC'?'3T Côté':data.salle==='GT'?'Grand Théâtre':data.salle;
      specsHTML += `<div class="resume-row">
        <div class="resume-dot" style="background:${color}"></div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="resume-name">${name}</span>
            <span class="resume-count">${data.count}× · ${salleLabel}</span>
          </div>
          <div class="resume-bar-wrap"><div class="resume-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        </div>
      </div>`;
    });
  }

  // Intermittence block
  // Count total hours this month from plan tech (rough estimate: each forfait = 3h average as placeholder)
  // + heures tech from loaded file
  const htInfo = htechData[reg] || null;
  const htTotal = htInfo ? htInfo.total : null;

  // Count hours this month from allDays across 12 months for intermittence estimate
  // For now just show month totals
  const nRegies = specs.reduce((s, [,d]) => s + d.count, 0);

  // Accordion helper
  const acc = (id, title, bodyHTML, openByDefault=false) => `
    <div class="accordion">
      <div class="accordion-header${openByDefault?' open':''}" onclick="toggleAccordion('${id}')">
        <span class="accordion-title">${title}</span>
        <span class="accordion-chevron">▾</span>
      </div>
      <div class="accordion-body${openByDefault?' open':''}" id="acc-${id}">
        <div class="accordion-inner">${bodyHTML}</div>
      </div>
    </div>`;

  let resumeHTML = `<div class="resume-view">`;

  // Spectacles accordion (open by default)
  const specsCount = specs.length;
  resumeHTML += acc('specs', `Spectacles du mois · ${specsCount} pièce${specsCount>1?'s':''}`, specsHTML || '<div style="color:var(--muted);font-size:13px;padding:.25rem 0">Aucun spectacle forfaité</div>', true);

  // Heures calculées (base heures spectacles)
  const heures = computeHeures(dayMap);
  // Bouton pour changer le fichier base sans quitter l'app
  const baseName = getSavedBaseName();
  const changeBaseBtn = `<div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--muted)">${baseName ? '📄 '+baseName : 'Aucun fichier base'}</span>
      <button onclick="pickDriveFile('base')" style="background:var(--surface3);border:1px solid var(--border);border-radius:8px;padding:5px 10px;font-size:11px;color:var(--text);cursor:pointer;font-family:inherit">🔄 Changer la base heures</button>
    </div>`;
  const heuresDisclaimer = `<div style="background:#fb923c12;border:1px solid #fb923c33;border-radius:8px;padding:.55rem .7rem;margin-bottom:.7rem;font-size:11px;color:var(--c3tc);line-height:1.45">⚠️ Estimation approximative — cette partie de l'app est encore en développement. À vérifier avant toute utilisation officielle.</div>`;
  let heuresBody;
  if (!baseHeuresLoaded) {
    heuresBody = heuresDisclaimer + '<div style="color:var(--muted);font-size:13px;padding:.25rem 0">Base heures non chargée. Choisis le fichier base ci-dessous (ou à l\'écran de connexion).</div>' + changeBaseBtn;
  } else {
    const sortedH = Object.entries(heures.specs).sort((a,b)=>b[1].hours-a[1].hours);
    let rows = sortedH.map(([name,d])=>{
      const sl = d.salle==='3TC'?'3T Côté':d.salle==='GT'?'Grand Théâtre':d.salle;
      return `<div class="intermi-row">
        <span class="intermi-label">${name} <span style="color:var(--muted)">· ${d.count}× ${sl}</span></span>
        <span class="intermi-val">${Math.round(d.hours*100)/100}h</span>
      </div>`;
    }).join('');
    if(!rows) rows = '<div style="color:var(--muted);font-size:13px">Aucune régie ce mois</div>';
    const unm = heures.guests.length
      ? `<div style="margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--border)"><div style="font-size:11px;color:var(--cguest);margin-bottom:.5rem">🎤 Artistes invités (hors calcul d'heures)</div>`
        + heures.guests.map(g=>`<div class="intermi-row"><span class="intermi-label">${g}</span><span class="intermi-val" style="color:var(--cguest)">invité</span></div>`).join('')
        + `</div>`
      : '';
    const nonid = heures.unmatched.length
      ? `<div style="margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--border)"><div style="font-size:11px;color:var(--c3tc);margin-bottom:.5rem">❓ Spectacles non identifiés (absents de la base)</div>`
        + heures.unmatched.map(g=>`<div class="intermi-row"><span class="intermi-label">${g}</span><span class="intermi-val" style="color:var(--c3tc)">non compté</span></div>`).join('')
        + `<div style="font-size:11px;color:var(--muted);margin-top:.5rem;line-height:1.45">⚠️ Ces spectacles ne sont pas dans la base heures : leurs heures ne sont <b>pas comptées</b> par l'app. Ce sont sûrement des heures à déclarer en <b>heures supp</b>.</div></div>`
      : '';
    const hsuppBlock = (heures.hsupp && heures.hsupp.length)
      ? `<div style="margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--border)"><div style="font-size:11px;color:#a78bfa;margin-bottom:.5rem">💼 Comptés en heures supp</div>`
        + heures.hsupp.map(g=>`<div class="intermi-row"><span class="intermi-label">${g}</span><span class="intermi-val" style="color:#a78bfa">heures supp</span></div>`).join('')
        + `<div style="font-size:11px;color:var(--muted);margin-top:.5rem;line-height:1.45">Ces spectacles (ex. Blind Test, Faux British) ne sont <b>pas dans la base</b> : leurs heures viennent de tes <b>heures supp déclarées</b>.</div></div>`
      : '';
    heuresBody = `${heuresDisclaimer}${rows}
      <div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border)">
        <div class="intermi-row"><span class="intermi-label">Montages</span><span class="intermi-val">${heures.montage}h</span></div>
        <div class="intermi-row"><span class="intermi-label">Durées spectacles</span><span class="intermi-val">${heures.duree}h</span></div>
        <div class="intermi-row"><span class="intermi-label">Démontages</span><span class="intermi-val">${heures.demontage}h</span></div>
        <div class="intermi-row"><span class="intermi-label">Services (1h/régie)</span><span class="intermi-val">${heures.service}h</span></div>
        <div class="intermi-row"><span class="intermi-label">Total spectacles</span><span class="intermi-val">${heures.total}h</span></div>
        <div class="intermi-row"><span class="intermi-label">+ Heures supp du mois</span><span class="intermi-val" id="resume-hs">⏳</span></div>
        <div class="intermi-row" style="margin-bottom:0;padding-top:.4rem;border-top:1px solid var(--border)"><span class="intermi-label" style="font-weight:600;color:var(--text)">Total avec heures supp</span><span class="intermi-val" id="resume-hs-total" style="font-weight:600;color:var(--c3t)">⏳</span></div>
      </div>${hsuppBlock}${unm}${nonid}${changeBaseBtn}`;
  }
  resumeHTML += acc('heures', `Heures calculées · ${baseHeuresLoaded?heures.total+'h':'—'}`, heuresBody, true);

  if (nTournees > 0) {
    const tourBody = `<div class="resume-row">
      <div class="resume-dot" style="background:var(--ctour)"></div>
      <span class="resume-name">Déplacements</span>
      <span class="resume-count">${nTournees}× · ~${nTournees*180}€</span>
    </div>`;
    resumeHTML += acc('tournees', `Tournées · ${nTournees}`, tourBody, true);
  }

  if (htTotal !== null) {
    const htBody = `<div class="resume-row">
      <div class="resume-dot" style="background:#facc15"></div>
      <span class="resume-name">Total heures tech</span>
      <span class="resume-count">${htTotal}h${htInfo.stopDate ? ' · stop '+htInfo.stopDate : ''}</span>
    </div>`;
    resumeHTML += acc('htech', 'Heures techniques', htBody, true);
  }


  // Top régisseurs (always shown, based on full team data)
  const teamMap = buildTeamDayMap(y, m);
  const regScores = {};
  for (let d = 1; d <= nbDays; d++) {
    (teamMap[d]||[]).forEach(e => {
      if (e.salle === 'Tournée' || e.unassigned) return;
      e.regies.forEach(r => {
        if (r.role === 'observateur') return;
        if (!regScores[r.reg]) regScores[r.reg] = 0;
        regScores[r.reg]++;
      });
    });
  }
  const sorted = Object.entries(regScores).sort((a,b)=>b[1]-a[1]);
  const maxScore = sorted.length ? sorted[0][1] : 1;
  const medals = ['🥇','🥈','🥉'];
  const rankCls = ['gold','silver','bronze'];

  let topHTML = '';
  sorted.forEach(([name, count], i) => {
    const initials = name.slice(0,2).toUpperCase();
    const pct = Math.round((count/maxScore)*100);
    const rank = i < 3 ? `<span class="top-rank ${rankCls[i]}">${medals[i]}</span>` : `<span class="top-rank">${i+1}</span>`;
    const isMe = name === reg && !teamMode;
    topHTML += `<div class="top-row"${isMe?' style="border:1px solid var(--c3t)20"':''}>
      ${rank}
      <div class="top-avatar">${initials}</div>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between">
          <span class="top-name">${name}</span>
          <span class="top-count">${count} régie${count>1?'s':''}</span>
        </div>
        <div class="top-bar-wrap"><div class="top-bar" style="width:${pct}%"></div></div>
      </div>
    </div>`;
  });

  if (sorted.length > 0) {
    resumeHTML += acc('top', `🏆 Top régisseurs · ${sorted.length} actifs`, topHTML, true);
  }

  resumeHTML += '</div>';
  document.getElementById('view-resume').innerHTML = resumeHTML;
  // Ajoute les heures supp du mois au total (lecture du fichier du mois, en différé)
  if (baseHeuresLoaded && document.getElementById('resume-hs')) loadResumeHsupp(reg, y, m, heures.total);
}

// Lit les heures supp du mois (y,m) pour reg et complète le total des heures calculées
async function loadResumeHsupp(reg, y, m, baseTotal){
  const hsEl = document.getElementById('resume-hs'), totEl = document.getElementById('resume-hs-total');
  if(!hsEl) return;
  try{
    const f = await resolveHsuppForMonth(new Date(y, m-1, 1));
    const ab = await fetchDriveWorkbook(f.id, f.mimeType);
    const wb = XLSX.read(ab, { type:'array' });
    const hs = sumHsuppHours(wb, reg);
    hsEl.textContent = `${hs}h`;
    if(totEl) totEl.textContent = `${Math.round((baseTotal+hs)*100)/100}h`;
  }catch(e){
    hsEl.textContent = '0h';
    if(totEl) totEl.textContent = `${baseTotal}h`;
  }
}

function toggleAccordion(id) {
  const body = document.getElementById('acc-'+id);
  const header = body.previousElementSibling;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  header.classList.toggle('open', !isOpen);
}
