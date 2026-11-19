'use strict';
// Données initiales (injectées en base au premier démarrage). Ce fichier reste côté serveur :
// il n'est jamais envoyé au navigateur.

// nom, J, V, N, D, BP, BC (stats avant la J4)
const LEAGUE = [["Otaku 4",3,3,0,0,20,11],["Πίϻυⲅa",3,2,1,0,23,14],["Natsu 🐉",3,2,1,0,15,11],["𝑅𝐴𝐼𝑇𝐸𝑁𝑆𝐻𝐼",3,2,0,1,27,9],["Makimado",3,2,0,1,16,8],["FC Barcelone",3,2,0,1,22,16],["☠︎ 𝕳𝖎𝖐𝖆𝖗𝖚 𝕲𝖊𝖗𝖔 ☠︎",3,2,0,1,21,16],["Duskwarden",3,2,0,1,16,12],["Nash G. Jr",3,1,1,1,8,10],["𝐅𝐚𝐢 𝐢𝐬𝐡𝐢𝐠𝐚𝐦𝐢",3,1,1,1,17,23],["ƙⲇⲅ ᭢ⲇ 🎭",3,1,1,1,8,14],["𝚅𐐛𝔸Ｄ Ｄ𝞔 𝘚Η૦𝔸Ꮢ𝔸",3,1,0,2,21,18],["1+1 = 3 if you don't use condom",3,1,0,2,8,7],["𝐁𝐥𝐚𝐜𝐤 𝐡𝐞𝐚𝐫𝐭",3,1,0,2,13,18],["Vein",3,1,0,2,11,18],["Senju",3,1,0,2,10,18],["MASHI",3,0,1,2,13,23],["Le PNJ",3,0,0,3,4,22]];
// points généraux (monnaie des paris), même ordre que LEAGUE
const LEAGUE_WALLET = [10622,4225,5809,4316,4573,15021,25668,8643,10691,1240,14312,2325,5398,2575,16502,4019,4978,7384];
// autres parieurs : [pseudo, points]
const OTHERS = [["Per Son",21523],["Manjiro",14324],["Kayden",7051],["Akira",6418],["ESPOIR.sbg",2655],["NYM",2524],["Duxram",2300],["Waffi",2118],["Johan",1450],["Wethermon",1215],["Just Me",884],["Kanroji",750],["Emmanuel",716],["Miguel",525],["David",432],["RAN---DOM",350],["Hachimi",300],["Syr",200],["Yuta",140],["Ariel",75],["Chihiro",50],["Kai",25]];
const MODS = ["Akira", "Yuta"];

// Journée 4 (paires provisoires), puis J5 à J34 encodées (2 lettres = 1 match)
const J4 = [[11,17],[15,4],[9,3],[10,1],[8,13],[6,7],[16,2],[14,12],[0,5]];
const SCH = ["ckqldpbaormjhifgen","ameokrnpcibgljdqhf","olpakjmghrdncbfeqi","einrfohqaklmbjcdgp","dlkgiahjrpecnofbqm","cnegjofkipmdhlqarb","agchbelfpkrjoqnmdi","mpjndbgclearqfkhio","nljaqrpfheibgdockm","frjqnkalgimebodhcp","cfgjbhilrmqneadkop","okqepbijlchnmfrgad","fjphmikqlgodernbca","nglpfajebmdrcqhoik","keblhmcjriognapqdf","qbjmrogfedpnhaickl","mopdqgkcabjlnerhfi","mlrnapqhjkiedcofgb","jbprefaogkcmlqihnd","ldrkoepjnciqhgmabf","brlhdmaqpgojcenikf","cgfhjrelonmqbdpika","mnkprqebflhcajdgoi","lopcfqgebihdnjramk","fnrlhkemqjbcpoidga","bpnqdajiehkoclrfgm","aeigqopmhblnkdjfcr","qdknglfcejhpaimrob","acgreklifmqpbnjhdo","qkmbdecofpjgnhirla"];

// [journée, domicile, extérieur, buts dom., buts ext., forfait(1=dom. 2=ext.)] — nom (string) = joueur hors ligue
const HIST = [[1,6,16,7,2],[1,9,15,8,4],[1,14,"Kayden",4,2],[1,10,8,0,0],[1,11,1,6,8],[1,5,3,8,7],[1,0,13,6,4],[1,7,"Akira",3,0,2],[1,17,4,1,6],[1,12,2,0,3,1],
[2,9,3,1,11],[2,15,11,4,10],[2,4,16,10,5],[2,1,10,9,2],[2,12,7,5,7],[2,8,5,8,7],[2,14,0,1,7],[2,6,13,5,8],[2,17,2,3,7],
[3,6,14,9,6],[3,11,10,5,6],[3,15,4,2,0],[3,9,2,8,8],[3,13,5,1,7],[3,0,7,7,6],[3,17,3,0,9],[3,1,16,6,6],[3,8,12,0,3,1]];

// Arbitres (calculés ici, jamais envoyés avant que la journée soit publiée)
const REFOV = { 1: "Apolo", 2: "Akira", 3: "Apolo" };
const REF = ["Yuta", "Akira", "Apolo"];
const PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

function buildFixtures() {
  const all = J4.map((p, k) => ({ id: k + 1, matchday: 4, home: p[0], away: p[1], day_in_md: Math.floor(k / 3) + 1, hour: 18 + (k % 3) }));
  SCH.forEach((row, r) => {
    for (let k = 0; k < 9; k++) {
      all.push({ id: r * 9 + k + 10, matchday: 5 + r, home: row.charCodeAt(2 * k) - 97, away: row.charCodeAt(2 * k + 1) - 97, day_in_md: Math.floor(k / 3) + 1, hour: 18 + (k % 3) });
    }
  });
  const ref = (id) => {
    if (REFOV[id]) return REFOV[id];
    const q = id - 1, r = Math.floor(q / 9), k = q % 9, g = Math.floor(k / 3);
    const p = Math.floor(Math.abs(Math.sin((r * 3 + g + 1) * 12.9898) * 43758.5453)) % 6;
    const R = PERMS[p].map((i) => REF[i]);
    let hi = -1;
    for (let s = 0; s < 3; s++) { const mm = all[r * 9 + g * 3 + s]; if (mm && (mm.home === 6 || mm.away === 6)) hi = s; }
    if (hi >= 0 && R[hi] === "Apolo") { const t = R[hi], o = (hi + 1) % 3; R[hi] = R[o]; R[o] = t; }
    return R[k % 3];
  };
  return all.map((m) => ({ ...m, referee: ref(m.id) }));
}

module.exports = { LEAGUE, LEAGUE_WALLET, OTHERS, MODS, HIST, buildFixtures };
