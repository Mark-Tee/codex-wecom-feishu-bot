export function orderIdentifiers(card={}) {
 const clean=value=>{const text=String(value||"").replace(/[\u200B-\u200D\u2060\uFEFF]/gu,"").trim().toUpperCase();return text==="无"?"":text;};
 return {transactionNo:clean(card.transactionNo),roomTicketNo:clean(card.roomTicketNo)};
}
export function sameBusinessOrder(a,b) {
 const t=a.transactionNo&&b.transactionNo&&a.transactionNo===b.transactionNo;
 const r=a.roomTicketNo&&b.roomTicketNo&&a.roomTicketNo===b.roomTicketNo;
 return a.transactionNo&&a.roomTicketNo&&b.transactionNo&&b.roomTicketNo ? Boolean(t&&r) : Boolean(t||r);
}
