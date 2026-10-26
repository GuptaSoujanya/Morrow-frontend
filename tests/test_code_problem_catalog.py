"""Every judging fixture is checked against the bundled, worked Python solution."""
from collections import deque
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path
import re
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
import code_problem_catalog as catalog

COURSE = Path(__file__).parents[2] / 'course' / '02-dsa'
FUNCTIONS = {
    1: ('contains_duplicate', 'is_anagram', 'two_sum', 'group_anagrams', 'top_k_frequent', 'product_except_self', 'longest_consecutive'),
    2: ('is_palindrome', 'two_sum_sorted', 'three_sum', 'max_profit', 'length_of_longest_substring', 'min_window'),
    3: ('is_valid', 'MyQueue', 'reverse_list', 'merge_two_lists', 'has_cycle', 'daily_temperatures', 'LRUCache'),
    4: ('search', 'search_insert', 'search_range', 'search_rotated', 'find_min', 'min_eating_speed'),
    5: ('max_depth', 'invert_tree', 'is_same_tree', 'level_order', 'is_valid_bst', 'kth_smallest', 'lowest_common_ancestor'),
    6: ('find_kth_largest', 'last_stone_weight', 'k_closest', 'least_interval', 'MedianFinder', 'merge_k_lists'),
    7: ('num_islands', 'clone_graph', 'can_finish', 'count_components', 'pacific_atlantic', 'network_delay_time', 'min_cost_connect_points'),
    8: ('subsets', 'permute', 'combination_sum', 'exist', 'partition', 'total_n_queens'),
    9: ('climb_stairs', 'rob', 'coin_change', 'length_of_lis', 'longest_common_subsequence', 'knapsack', 'min_distance', 'max_profit_cooldown'),
    10: ('find_content_children', 'merge', 'erase_overlap_intervals', 'min_meeting_rooms', 'can_jump', 'can_complete_circuit'),
    11: ('single_number', 'hamming_weight', 'count_bits', 'Trie', 'WordDictionary', 'get_sum'),
}


@lru_cache(maxsize=72)
def reference(identifier):
    chapter, problem = identifier.split('/')
    number = int(problem.removeprefix('problem-'))
    text = (COURSE / (chapter + '.md')).read_text()
    body = re.search(rf'^### Problem {number}: ([^\n]+)\n(.*?)(?=^### Problem |^## 5\.|\Z)', text, re.M | re.S)
    assert body, identifier
    blocks = re.findall(r'```python\n(.*?)```', body[2], re.S)
    assert blocks, identifier
    # These files are the checked-in course, not learner submissions. The module
    # name keeps demo blocks from running, and each problem has its own globals.
    scope = {'__name__': 'course_reference'}
    exec('from __future__ import annotations\n' + '\n'.join(blocks), scope)
    return scope, FUNCTIONS[int(chapter[:2])][number - 1], body[1].strip()


def tree(scope, values):
    if not values:
        return None
    root = scope['TreeNode'](values[0])
    queue = deque([root])
    index = 1
    while queue and index < len(values):
        node = queue.popleft()
        for side in ('left', 'right'):
            if index >= len(values):
                break
            value = values[index]
            index += 1
            if value is not None:
                child = scope['TreeNode'](value)
                setattr(node, side, child)
                queue.append(child)
    assert index == len(values), 'Invalid compact breadth-first fixture'
    return root


def linked(scope, values):
    nodes = [scope['ListNode'](value) for value in values]
    for left, right in zip(nodes, nodes[1:]):
        left.next = right
    return nodes


def run_reference(identifier, data):
    scope, name, _ = reference(identifier)
    data = deepcopy(data)
    fn = scope[name]
    if 'operations' in data:
        obj = fn(data['capacity']) if name == 'LRUCache' else fn()
        return [getattr(obj, op)(*args) for op, args in zip(data['operations'], data['args'])]
    if name in ('reverse_list', 'has_cycle'):
        nodes = linked(scope, data['values'])
        if name == 'has_cycle' and data['pos'] >= 0:
            nodes[-1].next = nodes[data['pos']]
        result = fn(nodes[0] if nodes else None)
        return scope['list_to_array'](result) if name == 'reverse_list' else result
    if name == 'merge_two_lists':
        left, right = linked(scope, data['list1']), linked(scope, data['list2'])
        return scope['list_to_array'](fn(left[0] if left else None, right[0] if right else None))
    if name == 'merge_k_lists':
        lists = [linked(scope, values) for values in data['lists']]
        return scope['list_to_array'](fn([nodes[0] if nodes else None for nodes in lists]))
    if identifier.startswith('05-'):
        for field in ('root', 'p', 'q'):
            if isinstance(data.get(field), list):
                data[field] = tree(scope, data[field])
        if name == 'lowest_common_ancestor':
            data['p'], data['q'] = scope['TreeNode'](data['p']), scope['TreeNode'](data['q'])
            return fn(**data).val
        result = fn(**data)
        return scope['to_level_list'](result) if name == 'invert_tree' else result
    if name == 'clone_graph':
        nodes = [scope['Node'](i + 1) for i in range(len(data['adjList']))]
        for node, neighbors in zip(nodes, data['adjList']):
            node.neighbors = [nodes[label - 1] for label in neighbors]
        clone = fn(nodes[0] if nodes else None)
        if clone is None:
            return []
        seen, queue = {}, deque([clone])
        while queue:
            node = queue.popleft()
            if node.val in seen:
                continue
            # Reference fixture verification also checks the intended deep-copy
            # property; the public JSON judge accurately discloses its limitation.
            assert node not in nodes
            seen[node.val] = [neighbor.val for neighbor in node.neighbors]
            queue.extend(node.neighbors)
        return [seen[label] for label in sorted(seen)]
    if name == 'can_finish':
        data['num_courses'] = data.pop('numCourses')
    return fn(**data)


FIXTURES = [(identifier, case) for identifier in catalog.ids() for case in catalog.cases(identifier)]


@pytest.mark.parametrize('identifier,case', FIXTURES,
                         ids=[identifier + '/' + case['id'] for identifier, case in FIXTURES])
def test_reviewed_expected_result_agrees_with_worked_course_solution(identifier, case):
    actual = run_reference(identifier, case['input'])
    assert catalog.matches(actual, case['expected'], case['comparison']), (actual, case['expected'])


def test_catalog_covers_every_real_sheet_problem_and_matching_title():
    expected = {}
    for path in sorted(COURSE.glob('*.md')):
        if not path.name[:2].isdigit() or not 1 <= int(path.name[:2]) <= 11:
            continue
        for number, title in re.findall(r'^### Problem (\d+): ([^\n]+)', path.read_text(), re.M):
            expected[f'{path.stem}/problem-{number}'] = title
    assert len(expected) == len(catalog.ids()) == 72
    assert set(expected) == set(catalog.ids())
    for identifier, title in expected.items():
        public = catalog.problem(identifier)
        assert public['title'] == title
        assert public['input_spec'] and public['output_spec'] and public['constraints']
        assert public['test_count'] == 4
        assert public['sample_count'] == len(public['samples']) == 1
        assert 'cases' not in public
        assert all(case['sample'] for case in public['samples'])
        assert len(catalog.cases(identifier)) == 4
        assert len({json.dumps(case['input'], sort_keys=True) for case in catalog.cases(identifier)}) == 4
        assert set(public['starter']) == {'python', 'javascript', 'cpp'}
        assert 'def solve(input):' in public['starter']['python']
        assert 'function solve(input)' in public['starter']['javascript']
        assert 'int main()' in public['starter']['cpp']
        json.dumps(public, allow_nan=False)
        json.dumps(catalog.cases(identifier), allow_nan=False)


@pytest.mark.parametrize('identifier', [None, [], {}, '', '../01-arrays-strings-hashing/problem-1',
                                       '01-arrays-strings-hashing/problem-0',
                                       '01-arrays-strings-hashing/problem-999',
                                       '01-arrays-strings-hashing/problem-01'])
def test_invalid_problem_ids_fail_without_file_access(identifier):
    with pytest.raises(ValueError, match='Choose a supported problem'):
        catalog.problem(identifier)
    with pytest.raises(ValueError):
        catalog.cases(identifier)


def test_returned_data_is_detached_from_catalog():
    identifier = catalog.ids()[0]
    public = catalog.problem(identifier)
    public['samples'][0]['input']['nums'].clear()
    public['constraints'].clear()
    full = catalog.cases(identifier)
    full[0]['input']['nums'].clear()
    assert catalog.problem(identifier)['constraints']
    assert catalog.cases(identifier)[0]['input']['nums'] == [1, 2, 3, 1]
    assert catalog.cases(identifier, samples_only=True)[0]['input']['nums'] == [1, 2, 3, 1]


@pytest.mark.parametrize('actual,expected,mode,result', [
    (True, 1, 'exact', False),
    ([True], [1], 'unordered', False),
    (1.0, 1, 'exact', True),
    ([1.0, 2], [2, 1], 'unordered', True),
    ([1, 1], [1, 2], 'unordered', False),
    ([[2, 1], [3]], [[3], [1, 2]], 'nested_unordered', True),
    ([[1, 1]], [[1]], 'nested_unordered', False),
    ([[2, 1]], [[1, 2]], 'unordered', False),
    ([[2, 1]], [[1, 2]], 'rows_unordered', True),
    ([[2], [1]], [[1], [2]], 'rows_unordered', False),
    ([['true']], [[True]], 'nested_unordered', False),
    (['1'], [1], 'unordered', False),
    ([None, 1.50000001], [None, 1.5], 'approximate', True),
    ([None, 1.51], [None, 1.5], 'approximate', False),
    ([True], [1], 'approximate', False),
    (float('nan'), 0, 'exact', False),
    (10 ** 1_000, 0, 'exact', False),
    (10 ** 1_000, 0, 'approximate', False),
    ([float('inf')], [1], 'unordered', False),
    ([1, 2, 3], [1, 2], 'exact', False),
    ({'a': 1}, {'b': 1}, 'exact', False),
    ('null', None, 'exact', False),
    ([1], [[1]], 'nested_unordered', False),
    ([1], [[1]], 'rows_unordered', False),
])
def test_comparison_preserves_types_duplicates_and_only_permitted_order(actual, expected, mode, result):
    assert catalog.matches(actual, expected, mode) is result


def test_unknown_comparator_rejected():
    with pytest.raises(ValueError, match='Unknown test comparison'):
        catalog.matches([], [], 'anything-goes')
