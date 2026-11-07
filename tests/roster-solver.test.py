"""Synthetic solver checks; no real roster, credentials or network."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('roster_solver', Path(__file__).resolve().parents[1] / 'scripts' / 'solve-roster.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RosterSolverTests(unittest.TestCase):
    def test_adjacent_main_and_month_boundary_and_workday_coverage(self):
        data = {'days': [{'date': f'2026-12-0{i}', 'workday': True, 'aux': True} for i in [1, 2]],
                'groups': [{'members': ['A', 'B', 'C', 'D']}], 'previousNight': [], 'previousMain': ['A']}
        result = module.solve(data)
        self.assertIn(result['status'], ['OPTIMAL', 'FEASIBLE'])
        days = result['days']
        self.assertNotEqual(days[0]['roles']['A'], 'main')
        for person in data['groups'][0]['members']:
            self.assertNotEqual(days[0]['roles'][person], 'rest')
            if days[0]['roles'][person] == 'main':
                self.assertNotEqual(days[1]['roles'][person], 'main')
            if days[0]['roles'][person] == 'night':
                self.assertEqual(days[1]['roles'][person], 'rest')
            elif days[1]['roles'][person] == 'rest':
                self.fail('Unexplained working-day rest')

    def test_conflict_reports_constraints_instead_of_relaxing_them(self):
        result = module.solve({'days': [{'date': '2026-12-01', 'workday': True, 'aux': True}],
                               'groups': [{'members': ['A', 'B', 'C']}],
                               'previousNight': ['A', 'B', 'C'], 'previousMain': []})
        self.assertEqual(result['status'], 'INFEASIBLE')
        self.assertIn('休息', result['reason'])


if __name__ == '__main__':
    unittest.main()
