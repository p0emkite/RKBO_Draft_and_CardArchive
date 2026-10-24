/* RKBO season-aware team identities.
 * Internal Excel team codes and player IDs remain unchanged.
 * The on-card club name, logo, and decorative watermark reflect that season.
 * Historic 'SSG' (unified Excel ID) is displayed as SK through season 59.
 */
(function(root){
'use strict';
const names={
 DOO:'두산 베어스',HAN:'한화 이글스',KIA:'KIA 타이거즈',
 KT:'KT 위즈',LG:'LG 트윈스',LOT:'롯데 자이언츠',
 NC:'NC 다이노스',SAM:'삼성 라이온즈',SSG:'SSG 랜더스',
 SK:'SK 와이번스',KIW:'키움 히어로즈'
};
const logos={NC:'assets/teams/NC.png'};
function code(player){
 if(!player)return '';
 const internal=String(player.team||'').toUpperCase();
 if(internal==='SSG'&&Number(player.season)<60)return 'SK';
 return internal;
}
function logo(player){
 const branded=code(player);
 return logos[branded]||'assets/teams/'+branded+'.svg';
}
function name(player){return names[code(player)]||player?.teamLabel||String(player?.team||'')}
function decorate(players){
 for(const player of players||[]){
  if(!player||typeof player!=='object')continue;
  // The record's real club code is authoritative; do not rewrite team or IDs.
  player.displayTeamCode=code(player);
  player.teamLabel=name(player);
  player.displayLogo=logo(player);
 }
 return players;
}
root.RKBOTeamBrand={code,logo,name,decorate,names};
})(window);
