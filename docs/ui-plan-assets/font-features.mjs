// Proves public/fonts/InterVariable.woff2 carries the OpenType features UI_PLAN.md §3 relies on (tnum etc.).
// Run: node docs/ui-plan-assets/font-features.mjs — parses the woff2 table directory, brotli-decompresses, scans GSUB tags.
import fs from "node:fs"; import zlib from "node:zlib";
const buf = fs.readFileSync("/Users/yegaoyang/Desktop/workspace/awardgrid/public/fonts/InterVariable.woff2");
const numTables = buf.readUInt16BE(12), totalCompressed = buf.readUInt32BE(20);
let off = 48; const KNOWN = ["cmap","head","hhea","hmtx","maxp","name","OS/2","post","cvt ","fpgm","glyf","loca","prep","CFF ","VORG","EBDT","EBLC","gasp","hdmx","kern","LTSH","PCLT","VDMX","vhea","vmtx","BASE","GDEF","GPOS","GSUB","EBSC","JSTF","MATH","CBDT","CBLC","COLR","CPAL","SVG ","sbix","acnt","avar","bdat","bloc","bsln","cvar","fdsc","feat","fmtx","fvar","gvar","hsty","just","lcar","mort","morx","opbd","prop","trak","Zapf","Silf","Glat","Gloc","Feat","Sill"];
const tags = [];
const readB128 = () => { let r = 0; for (let i = 0; i < 5; i++) { const b = buf[off++]; r = (r << 7) | (b & 0x7f); if (!(b & 0x80)) return r; } };
for (let i = 0; i < numTables; i++) { const f = buf[off++]; let tag; if ((f & 0x3f) === 63) { tag = buf.toString("latin1", off, off + 4); off += 4; } else tag = KNOWN[f & 0x3f]; readB128(); if ((tag === "glyf" || tag === "loca") && ((f >> 6) & 3) === 0) readB128(); else if (!(tag === "glyf" || tag === "loca") && ((f >> 6) & 3) !== 0) readB128(); tags.push(tag); }
const data = zlib.brotliDecompressSync(buf.subarray(off, off + totalCompressed));
console.log("tables:", tags.join(" "));
for (const feat of ["tnum", "pnum", "lnum", "cv11", "ss01", "zero"]) console.log(feat, data.indexOf(Buffer.from(feat)) >= 0 ? "present" : "absent");
console.log("decompressed bytes", data.length);
