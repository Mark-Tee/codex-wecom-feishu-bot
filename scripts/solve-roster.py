"""Local CP-SAT monthly roster. Input/output are JSON; no network or spreadsheet writes."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor' / 'roster-python'))
from ortools.sat.python import cp_model


def solve(data):
    days, groups = data['days'], data['groups']
    people = [p for g in groups for p in g['members']]
    roles = ['main', 'aux', 'night', 'off1', 'off2', 'off3', 'rest']
    m = cp_model.CpModel()
    reasons = {}
    def requirement(text):
        tag = m.new_bool_var(text)
        m.add_assumption(tag)
        reasons[tag.index] = text
        return tag
    coverage = requirement('每日各部门主值、夜班和适用辅值人数要求')
    rest = requirement('夜班次日及上月末夜班后必须休息')
    main_gap = requirement('白班主值不得连续两个自然日，包含跨月衔接')
    x = {(p, d, r): m.new_bool_var(f'{i}_{d}_{r}') for i, p in enumerate(people)
         for d in range(len(days)) for r in roles}
    pw = {(p, d): m.new_bool_var(f'pw_{i}_{d}') for i, p in enumerate(people) for d in range(len(days))}
    pn = {(p, d): m.new_bool_var(f'pn_{i}_{d}') for i, p in enumerate(people) for d in range(len(days))}
    for d, day in enumerate(days):
        for g in groups:
            for r in ['main', 'night', 'aux']:
                m.add(sum(x[p, d, r] for p in g['members']) == (int(day['aux']) if r == 'aux' else 1)).only_enforce_if(coverage)
            for r in ['off1', 'off2']:
                m.add(sum(x[p, d, r] for p in g['members']) <= 1)
            first = sum(x[p, d, 'off1'] for p in g['members'])
            second = sum(x[p, d, 'off2'] for p in g['members'])
            m.add(second <= first)
            m.add(sum(x[p, d, 'off3'] for p in g['members']) <= len(g['members']) * second)
        for p in people:
            m.add_exactly_one(x[p, d, r] for r in roles)
            if d:
                m.add(x[p, d, 'main'] + x[p, d-1, 'main'] <= 1).only_enforce_if(main_gap)
            elif p in data['previousMain']:
                m.add(x[p, d, 'main'] == 0).only_enforce_if(main_gap)
            if not day['workday']:
                for r in ['off1', 'off2', 'off3']:
                    m.add(x[p, d, r] == 0)
            if d:
                m.add(x[p, d, 'rest'] >= x[p, d - 1, 'night']).only_enforce_if(rest)
                if day['workday']:
                    m.add(x[p, d, 'rest'] <= x[p, d - 1, 'night'])
            elif p in data['previousNight']:
                m.add(x[p, d, 'rest'] == 1).only_enforce_if(rest)
            elif day['workday']:
                m.add(x[p, d, 'rest'] == 0)
            m.add(pw[p, d] <= x[p, d, 'main'])
            m.add(pn[p, d] <= x[p, d, 'night'])
        m.add(sum(pw[p, d] for p in people) == 1)
        m.add(sum(pn[p, d] for p in people) == 1)
    target = sum(day['workday'] for day in days)
    totals = []
    fairness = []
    def spread(counts, bound):
        lo, hi = m.new_int_var(0, bound, 'lo'), m.new_int_var(0, bound, 'hi')
        m.add_min_equality(lo, counts)
        m.add_max_equality(hi, counts)
        fairness.append(hi - lo)
    for p in people:
        total = sum(2*x[p, d, 'night'] + sum(x[p, d, r] for r in ['main', 'aux', 'off1', 'off2', 'off3']) for d in range(len(days)))
        workload = requirement(f'{p}月度工时至少{target}')
        m.add(total >= target).only_enforce_if(workload)
        totals.append(total)
    for g in groups:
        for rs in [['main'], ['aux'], ['night'], ['off1', 'off2', 'off3'], ['off1'], ['off2'], ['off3']]:
            spread([sum(x[p, d, r] for d in range(len(days)) for r in rs) for p in g['members']], len(days))
    for power in [pw, pn]:
        spread([sum(power[p, d] for d in range(len(days))) for p in people], len(days))
    role_fairness = sum(fairness)
    spread(totals, 2 * len(days))
    m.minimize(fairness[-1] * ((len(fairness)-1)*len(days)+1) + role_fairness)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 45
    solver.parameters.num_search_workers = 4
    solver.parameters.random_seed = 202612
    status = solver.solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        conflict = [reasons.get(i, '岗位资格或兼任限制') for i in solver.sufficient_assumptions_for_infeasibility()] if status == cp_model.INFEASIBLE else []
        return {'status': solver.status_name(status), 'reason': '以下约束组合冲突（并非唯一原因）：' + '；'.join(conflict) if status == cp_model.INFEASIBLE else '45秒内未找到可核验解，不能据此认定无解', 'target': target}
    return {'status': solver.status_name(status), 'target': target,
            'optimal': status == cp_model.OPTIMAL,
            'days': [{**day, 'roles': {p: next(r for r in roles if solver.value(x[p, d, r])) for p in people},
                      'powerWhite': next(p for p in people if solver.value(pw[p, d])),
                      'powerNight': next(p for p in people if solver.value(pn[p, d]))} for d, day in enumerate(days)]}


if __name__ == '__main__':
    print(json.dumps(solve(json.loads(sys.stdin.read())), ensure_ascii=False))
