"""Regression checks for authored DSA traces and their lesson integration."""
from html.parser import HTMLParser
from pathlib import Path
import re
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from common import dsa_basics, dsa_depth
from common.interview_lessons import render
import daily_dsa


COURSE = Path(__file__).parents[2] / 'database' / 'course'


class Structures(HTMLParser):
    def __init__(self):
        super().__init__()
        self.details = []
        self.tables = 0
        self.diagrams = 0

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'details':
            self.details.append(attrs)
        if tag == 'table':
            self.tables += 1
        if tag == 'code' and attrs.get('class') == 'language-mermaid':
            self.diagrams += 1


@pytest.mark.parametrize('identifier', list(daily_dsa.CATALOG))
def test_depth_is_aligned_and_keeps_beginner_material_and_problem_ids(identifier, monkeypatch):
    def forbidden_write(*args, **kwargs):
        raise AssertionError('Reading teaching content must not write progress')

    monkeypatch.setattr(daily_dsa.memory, 'transact', forbidden_write)
    content = daily_dsa.lesson(COURSE, identifier)
    raw = dsa_depth.lesson(identifier)
    simple = dsa_basics.lesson(identifier)
    _, _, _, example, practices = daily_dsa.CATALOG[identifier]
    assert content['minutes'] == 60
    assert set(raw) == {'concept', 'walkthrough', 'interview'}
    assert content['example']['id'] == str(example)
    assert [p['id'] for p in content['practice']] == [str(p) for p in practices]
    assert content['concept_html'] == render(simple['concept'])
    assert content['simple_example_html'] == render(simple['worked_example'])
    example_name = re.split(r'\s*\(|\s*—', content['example']['title'])[0].strip()
    assert example_name in raw['walkthrough']
    for practice in content['practice']:
        practice_name = re.split(r'\s*\(|\s*—', practice['title'])[0].strip()
        assert practice_name in raw['interview']
    parsed = Structures()
    parsed.feed(content['walkthrough_html'])
    assert parsed.tables == parsed.diagrams == 1
    answer = Structures()
    answer.feed(content['interview_html'])
    assert len(answer.details) == 1
    assert 'open' not in answer.details[0]
    assert '<summary>Check your answer</summary>' in content['interview_html']
    assert '##' not in content['advanced_concept_html']


def test_content_copies_are_independent_and_invalid_ids_fail():
    original = dsa_depth.lesson('hashing')
    changed = dsa_depth.lesson('hashing')
    changed['concept'] = 'altered'
    assert dsa_depth.lesson('hashing') == original
    for value in (None, 1, [], {}, 'unknown', ''):
        with pytest.raises(ValueError):
            dsa_depth.lesson(value)


def rows(identifier):
    text = dsa_depth.lesson(identifier)['walkthrough']
    return [[cell.strip() for cell in line.strip('|').split('|')]
            for line in text.splitlines() if line.startswith('|')][2:]


def test_lcs_walkthrough_table_obeys_prefix_recurrence():
    data = rows('dp-grids')
    first, second = 'abcde', 'ace'
    grid = [[int(value) for value in row[1:]] for row in data]
    assert len(grid) == len(first) + 1
    assert all(len(row) == len(second) + 1 for row in grid)
    assert grid[0] == [0] * (len(second) + 1)
    assert all(row[0] == 0 for row in grid)
    for i in range(1, len(first) + 1):
        for j in range(1, len(second) + 1):
            expected = grid[i-1][j-1] + 1 if first[i-1] == second[j-1] else max(grid[i-1][j], grid[i][j-1])
            assert grid[i][j] == expected, (i, j)
    assert grid[-1][-1] == 3


def test_xor_walkthrough_preserves_prefix_accumulator():
    accumulator = 0
    for value, before, after in rows('bits'):
        number, binary = value.split(' = ')
        result_binary, result_number = after.split(' = ')
        assert int(binary, 2) == int(number)
        assert int(before, 2) == accumulator
        accumulator ^= int(number)
        assert int(result_binary, 2) == int(result_number) == accumulator
    assert accumulator == 4


def test_stock_walkthrough_uses_only_earlier_buying_days():
    minimum, best = 7, 0
    for price, earlier, profit, recorded_best in rows('sliding-window'):
        price, earlier, profit, recorded_best = map(int, (price, earlier, profit, recorded_best))
        assert earlier == minimum
        assert profit == price - minimum
        best = max(best, profit)
        assert recorded_best == best
        minimum = min(minimum, price)
    assert best == 5
