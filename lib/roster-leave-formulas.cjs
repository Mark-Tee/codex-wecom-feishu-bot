function column(n){let value='';while(n){value=String.fromCharCode(65+(n-1)%26)+value;n=Math.floor((n-1)/26);}return value;}
const quoted=value=>'"'+String(value).replaceAll('"','""')+'"';
function reference(headers,person,row){
  const c=headers.indexOf(person);
  if(c<1||c>15||headers.lastIndexOf(person)!==c)throw Error('岗位姓名未唯一对应人员列');
  return `$${column(c+1)}${row}`;
}
// Basic IF/AND/& avoids macros, dynamic arrays and platform-specific functions.
function assignmentFormula(headers,people,row){
  if(!people.length)return null;
  const refs=people.map(p=>reference(headers,p,row));
  return '='+people.map((p,i)=>{
    const separator=i?`IF(AND(${refs.slice(0,i).map(ref=>`${ref}="调休"`).join(',')}),"","、")&`:'';
    return `IF(${refs[i]}="调休","",${separator}${quoted(p)})`;
  }).join('&');
}
function activeCountFormula(headers,person,rows){
  return rows.length?'=SUM('+rows.map(row=>`IF(${reference(headers,person,row)}="调休",0,1)`).join(',')+')':'=0';
}
module.exports={assignmentFormula,activeCountFormula};
