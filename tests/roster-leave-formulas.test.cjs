const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assignmentFormula,activeCountFormula}=require('../lib/roster-leave-formulas.cjs');
const headers=['日期','甲','乙','丙'];
test('single assignment clears by exact leave status; duplicate or unknown names fail',()=>{
  assert.equal(assignmentFormula(headers,['甲'],2),'=IF($B2="调休","","甲")');
  assert.equal(assignmentFormula(headers,[],2),null);
  assert.throws(()=>assignmentFormula(headers,['未知'],2),/人员列/);
  assert.throws(()=>assignmentFormula(['日期','甲','甲'],['甲'],2),/人员列/);
});
test('multi-person names retain separators only between active members',()=>{
  const formula=assignmentFormula(headers,['甲','乙','丙'],2);
  assert.equal(formula,'=IF($B2="调休","","甲")&IF($C2="调休","",IF(AND($B2="调休"),"","、")&"乙")&IF($D2="调休","",IF(AND($B2="调休",$C2="调休"),"","、")&"丙")');
  assert.equal(activeCountFormula(headers,'甲',[2,3]),'=SUM(IF($B2="调休",0,1),IF($B3="调休",0,1))');
});
