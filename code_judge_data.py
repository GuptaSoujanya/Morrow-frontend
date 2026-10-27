"""Deterministic scale tests and reference complexity targets for the DSA course.

Expected values use closed forms or independent standard-library constructions.
The catalog tests cross-check every case against the worked course solutions.
Complexity targets describe an algorithm, never an inference about submitted code.
"""
from itertools import combinations, permutations


# Time, auxiliary space; output storage is excluded unless stated otherwise.
_TARGETS = {
    1: [('O(n)', 'O(n)'), ('O(n)', 'O(1)'), ('O(n)', 'O(n)'),
        ('O(w · k log k)', 'O(w · k), including output'), ('O(n)', 'O(n)'),
        ('O(n)', 'O(1)'), ('O(n)', 'O(n)')],
    2: [('O(n)', 'O(1)'), ('O(n)', 'O(1)'), ('O(n²)', 'O(n)'),
        ('O(n)', 'O(1)'), ('O(n)', 'O(1), bounded alphabet'), ('O(n + m)', 'O(1), bounded alphabet')],
    3: [('O(n)', 'O(n)'), ('O(1) amortized per operation', 'O(n)'),
        ('O(n)', 'O(1)'), ('O(n + m)', 'O(1)'), ('O(n)', 'O(1)'),
        ('O(n)', 'O(n)'), ('O(1) average per operation', 'O(capacity)')],
    4: [('O(log n)', 'O(1)')] * 5 + [('O(n log M)', 'O(1)')],
    5: [('O(n)', 'O(h)'), ('O(n)', 'O(h)'), ('O(n)', 'O(h)'),
        ('O(n)', 'O(n)'), ('O(n)', 'O(h)'), ('O(h + k)', 'O(h)'), ('O(h)', 'O(1)')],
    6: [('O(n log k)', 'O(k)'), ('O(n log n)', 'O(n)'), ('O(n log k)', 'O(k)'),
        ('O(n)', 'O(1), bounded alphabet'), ('O(log n) add; O(1) median', 'O(n)'), ('O(n log k)', 'O(k)')],
    7: [('O(rows · cols)', 'O(rows · cols)'), ('O(V + E)', 'O(V + E), including clone'),
        ('O(V + E)', 'O(V + E)'), ('O((V + E) · α(V))', 'O(V)'),
        ('O(rows · cols)', 'O(rows · cols)'), ('O((V + E) log V)', 'O(V + E)'),
        ('O(E log E)', 'O(V + E)')],
    8: [('O(n · 2ⁿ)', 'O(n)'), ('O(n · n!)', 'O(n)'),
        ('O(k^(target / min_candidate + 1)) upper bound', 'O(target / min_candidate)'),
        ('O(rows · cols · 4ᴸ)', 'O(L)'), ('O(n² · 2ⁿ) upper bound', 'O(n)'), ('O(n!)', 'O(n)')],
    9: [('O(n)', 'O(1)'), ('O(n)', 'O(1)'), ('O(amount · k)', 'O(amount)'),
        ('O(n²) DP; O(n log n) with binary search', 'O(n)'), ('O(n · m)', 'O(n · m)'),
        ('O(n · capacity)', 'O(capacity)'), ('O(n · m)', 'O(n · m)'), ('O(n)', 'O(1)')],
    10: [('O(n log n + m log m)', 'O(n + m), sorting workspace'),
         ('O(n log n)', 'O(n)'), ('O(n log n)', 'O(n), sorting workspace'),
         ('O(n log n)', 'O(n)'), ('O(n)', 'O(1)'), ('O(n)', 'O(1)')],
    11: [('O(n)', 'O(1)'), ('O(1), fixed 32-bit input', 'O(1)'),
         ('O(n)', 'O(n), including output'), ('O(L) per operation', 'O(total inserted characters)'),
         ('O(L) add; O(26ᵈ · L) search upper bound', 'O(total inserted characters)'),
         ('O(1), fixed 32-bit input', 'O(1)')],
}


def complexity(chapter, number):
    time, space = _TARGETS[chapter][number - 1]
    return {'time': time, 'space': space,
            'note': 'Reference target, not an analysis of your code. See the lesson for variable '
                    'definitions. Space excludes output unless stated. Measured memory includes '
                    'JSON input and runtime overhead.'}


def _chain(n, left=False):
    result = [1]
    for value in range(2, n + 1):
        result.extend([value, None] if left else [None, value])
    while result[-1] is None:
        result.pop()
    return result


def _partitions(text):
    if not text:
        return [[]]
    return [[text[:i], *tail] for i in range(1, len(text) + 1)
            if text[:i] == text[:i][::-1] for tail in _partitions(text[i:])]


def scale_cases(chapter, number):
    """Four additional cases per problem, all inside the public constraints."""
    cases = []
    def add(size, data, expected, label='Larger input'):
        cases.append({'name': f'{label} ({size})', 'input': data, 'expected': expected,
                      'category': 'stress', 'size': size})
    key = (chapter, number)
    for index, n in enumerate((16, 64, 256, 1000)):
        if chapter == 1:
            if number == 1:
                values = list(range(n))
                if index % 2: values[-1] = 0
                add(n, {'nums': values}, bool(index % 2), 'Duplicate at the end / all distinct')
            elif number == 2:
                s = 'a' * (n - 1) + 'b'
                t = 'b' + 'a' * (n - 1) if index % 2 else 'b' * (n - 1) + 'a'
                add(n, {'s': s, 't': t}, bool(index % 2), 'Same letters, checked counts')
            elif number == 3:
                add(n, {'nums': list(range(n - 2)) + [n * 3, n * 4], 'target': n * 7}, [n - 2, n - 1])
            elif number == 4:
                k = (4, 10, 25, 50)[index]
                add(2 * k, {'strs': ['ab', 'ba'] * k}, [['ab', 'ba'] * k], 'Duplicate words must be preserved')
            elif number == 5:
                add(n, {'nums': [9] * (n // 2) + [3] * (n // 4) + list(range(100, 100 + n // 4)), 'k': 2}, [9, 3])
            elif number == 6:
                k = (8, 20, 60, 100)[index]
                add(k, {'nums': [1] * (k - 1) + [0]}, [0] * (k - 1) + [1])
            else:
                add(n, {'nums': list(range(n - 1, -1, -1))}, n)
        elif chapter == 2:
            if number == 1:
                add(n, {'s': 'A' * (n - 1) + ('b' if index % 2 else 'a')}, not bool(index % 2))
            elif number == 2:
                add(n, {'numbers': list(range(n)), 'target': 2 * n - 3}, [n - 1, n])
            elif number == 3:
                k = (8, 40, 100, 200)[index]
                add(k, {'nums': [-1] * (k // 2) + [0] + [1] * (k - k // 2 - 1)}, [[-1, 0, 1]], 'Repeated values, one unique triple')
            elif number == 4:
                add(n, {'prices': list(range(n, 0, -1))}, 0, 'Falling prices')
            elif number == 5:
                add(n, {'s': ('abcd' * n)[:n]}, 4)
            else:
                add(n, {'s': 'a' * (n - 2) + 'bc', 't': 'abc'}, 'abc', 'Window at the end')
        elif chapter == 3:
            if number == 1:
                add(n, {'s': '(' * (n // 2) + ')' * (n // 2 - 1) + (']' if index % 2 else ')')}, not bool(index % 2))
            elif number == 2:
                k = (8, 32, 100, 249)[index]
                add(2 * k + 1, {'operations': ['push'] * k + ['pop'] * k + ['empty'], 'args': [[i] for i in range(k)] + [[] for _ in range(k + 1)]}, [None] * k + list(range(k)) + [True])
            elif number == 3:
                add(n, {'values': list(range(n))}, list(range(n - 1, -1, -1)))
            elif number == 4:
                add(n, {'list1': list(range(0, n, 2)), 'list2': list(range(1, n, 2))}, list(range(n)))
            elif number == 5:
                add(n, {'values': [7] * n, 'pos': n // 2 if index % 2 else -1}, bool(index % 2))
            elif number == 6:
                add(n, {'temperatures': [50] * (n - 1) + [51]}, list(range(n - 1, 0, -1)) + [0])
            else:
                k = (8, 32, 100, 249)[index]
                add(2 * k, {'capacity': 1, 'operations': ['put'] * k + ['get'] * k, 'args': [[i, i * 2] for i in range(k)] + [[i] for i in range(k)]}, [None] * k + [-1] * (k - 1) + [(k - 1) * 2])
        elif chapter == 4:
            if number == 1:
                add(n, {'nums': list(range(n)), 'target': n - 1 if index % 2 else n}, n - 1 if index % 2 else -1)
            elif number == 2:
                add(n, {'nums': list(range(1, n + 1)), 'target': 0}, 0)
            elif number == 3:
                add(n, {'nums': [0] * (n // 2) + [1] * (n // 2), 'target': 1}, [n // 2, n - 1])
            elif number == 4:
                add(n, {'nums': list(range(n // 2, n)) + list(range(n // 2)), 'target': 0}, n // 2)
            elif number == 5:
                add(n, {'nums': list(range(1, n)) + [0]}, 0)
            else:
                add(n, {'piles': [1_000_000] * n, 'h': n * 2}, 500_000)
        elif chapter == 5:
            k = (15, 31, 63, 127)[index]
            chain = _chain(k)
            if number == 1: add(k, {'root': chain}, k, 'Skewed tree')
            elif number == 2: add(k, {'root': chain}, _chain(k, left=True), 'Skewed tree')
            elif number == 3: add(k, {'p': chain, 'q': chain[:-1] + [-1]}, False, 'Deep leaf differs')
            elif number == 4: add(k, {'root': chain}, [[i] for i in range(1, k + 1)])
            elif number == 5: add(k, {'root': chain[:-1] + [0]}, False, 'Deep ancestor violation')
            elif number == 6: add(k, {'root': chain, 'k': k}, k)
            else: add(k, {'root': chain, 'p': k - 1, 'q': k}, k - 1)
        elif chapter == 6:
            if number == 1: add(n, {'nums': list(range(n)), 'k': n // 2}, n // 2)
            elif number == 2: add(n, {'stones': [10] * n}, 0)
            elif number == 3: add(n, {'points': [[i, 0] for i in range(n - 1, -1, -1)], 'k': 3}, [[0, 0], [1, 0], [2, 0]])
            elif number == 4: add(n, {'tasks': ['A'] * n, 'n': 100}, (n - 1) * 101 + 1)
            elif number == 5:
                k = (8, 32, 100, 249)[index]
                add(2 * k, {'operations': ['add_num', 'find_median'] * k, 'args': [a for i in range(k) for a in ([i], [])]}, [a for i in range(k) for a in (None, i / 2)])
            else:
                add(n, {'lists': [list(range(i, n, 4)) for i in range(4)]}, list(range(n)))
        elif chapter == 7:
            k = (8, 25, 80, 200)[index]
            if number == 1:
                d = (4, 8, 16, 20)[index]
                add(d * d, {'grid': [[str((r + c) % 2) for c in range(d)] for r in range(d)]}, d * d // 2, 'Diagonal islands')
            elif number == 2:
                k = (8, 25, 64, 100)[index]
                graph = [[j for j in (i - 1, i + 1) if 1 <= j <= k] for i in range(1, k + 1)]
                add(k, {'adjList': graph}, graph)
            elif number == 3:
                edges = [[i + 1, i] for i in range(k - 1)]
                if index % 2: edges.append([0, k - 1])
                add(k, {'numCourses': k, 'prerequisites': edges}, not bool(index % 2))
            elif number == 4: add(k, {'n': k, 'edges': [[i, i + 1] for i in range(k - 2)]}, 2)
            elif number == 5:
                d = (4, 8, 16, 20)[index]
                add(d * d, {'heights': [[7] * d for _ in range(d)]}, [[r, c] for r in range(d) for c in range(d)], 'Flat plateau')
            elif number == 6: add(k, {'times': [[i, i + 1, 1_000_000] for i in range(1, k)], 'n': k, 'k': 1}, (k - 1) * 1_000_000)
            else: add(k, {'n': k, 'connections': [[i, i + 1, 2] for i in range(1, k)] + [[1, k, 1000]]}, (k - 1) * 2)
        elif chapter == 8:
            if number == 1:
                k = (4, 6, 8, 10)[index]
                values = list(range(k))
                add(k, {'nums': values}, [list(c) for size in range(k + 1) for c in combinations(values, size)])
            elif number == 2:
                k = (2, 4, 5, 6)[index]
                values = list(range(1, k + 1))
                add(k, {'nums': values}, [list(p) for p in permutations(values)])
            elif number == 3:
                k = (12, 18, 24, 30)[index]
                add(k, {'candidates': [2, 3], 'target': k}, [[2] * a + [3] * b for a in range(k // 2 + 1) for b in range(k // 3 + 1) if 2 * a + 3 * b == k])
            elif number == 4:
                k = (3, 6, 9, 12)[index]
                add(k, {'board': [list('ABCDEF') for _ in range(6)], 'word': 'A' * (k - 1) + 'Z'}, False, 'Missing final character')
            elif number == 5:
                k = (4, 6, 8, 10)[index]
                add(k, {'s': 'a' * k}, _partitions('a' * k))
            else:
                k, count = ((2, 0), (5, 10), (6, 4), (7, 40))[index]
                add(k, {'n': k}, count)
        elif chapter == 9:
            if number == 1:
                k = (20, 28, 35, 40)[index]
                a, b = 1, 1
                for _ in range(k): a, b = b, a + b
                add(k, {'n': k}, a)
            elif number == 2: add(n, {'nums': [1] * n}, n // 2)
            elif number == 3:
                k = (100, 1000, 5000, 10000)[index]
                add(k, {'coins': [1, 7, 10], 'amount': k}, k // 10)
            elif number == 4: add(n, {'nums': list(range(n, 0, -1))}, 1)
            elif number == 5:
                k = (16, 50, 100, 200)[index]
                add(k, {'text1': 'a' * k, 'text2': 'a' * (k // 2) + 'b' * (k // 2)}, k // 2)
            elif number == 6:
                k = (8, 20, 50, 100)[index]
                add(k, {'weights': [2] * k, 'values': [3] * k, 'capacity': k}, 3 * (k // 2))
            elif number == 7:
                k = (16, 50, 100, 200)[index]
                add(k, {'word1': 'a' * k, 'word2': 'b' * k}, k)
            else: add(n, {'prices': [1, 2, 0, 0] * (n // 4)}, 1 + 2 * (n // 4 - 1))
        elif chapter == 10:
            if number == 1: add(n, {'g': list(range(1, n + 1)), 's': [1] * n}, 1)
            elif number == 2: add(n, {'intervals': [[i, i + 1] for i in range(n - 1, -1, -1)]}, [[0, n]])
            elif number == 3: add(n, {'intervals': [[1, 2]] * n}, n - 1)
            elif number == 4: add(n, {'intervals': [[0, n + 1]] * n}, n)
            elif number == 5: add(n, {'nums': [1] * (n - 2) + [0, 1]}, False, 'Blocked near the end')
            else: add(n, {'gas': [0] * (n - 1) + [n], 'cost': [1] * n}, n - 1)
        elif chapter == 11:
            if number == 1:
                k = (7, 31, 127, 499)[index]
                add(2 * k + 1, {'nums': [i for i in range(k) for _ in range(2)] + [-99]}, -99)
            elif number == 2:
                k = (8, 16, 24, 31)[index]
                add(k, {'n': (1 << k) - 1}, k)
            elif number == 3:
                k = (16, 100, 1000, 10000)[index]
                add(k, {'n': k}, [i.bit_count() for i in range(k + 1)])
            elif number in (4, 5):
                k = (8, 32, 64, 100)[index]
                words = ['a' * i + 'b' for i in range(k)]
                op = 'insert' if number == 4 else 'add_word'
                queries = words + ['z' * (i + 1) for i in range(k)]
                add(3 * k, {'operations': [op] * k + ['search'] * (2 * k), 'args': [[word] for word in words + queries]}, [None] * k + [True] * k + [False] * k)
            else:
                a, b = ((2**31 - 1, 0), (-2**31, 0), (-2**31, 2**31 - 1), (2**30 - 1, 1))[index]
                add(32, {'a': a, 'b': b}, a + b, 'Signed 32-bit boundary')
    return cases
