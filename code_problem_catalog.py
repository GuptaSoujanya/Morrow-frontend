"""Reviewed local judging fixtures for every problem in the bundled DSA course.

These are educational output checks, not a security boundary or a complexity
proof. The full fixture bank lives on the learner's own computer. Keep submit
fixtures out of the public problem response so samples remain useful practice.
"""
from __future__ import annotations

from copy import deepcopy
import json
import math


_BANK = {}
_CHAPTERS = (
    '01-arrays-strings-hashing', '02-two-pointers-sliding-window',
    '03-stack-queue-linkedlist', '04-binary-search', '05-trees-bst',
    '06-heaps-priority-queues', '07-graphs', '08-backtracking',
    '09-dynamic-programming', '10-greedy-intervals', '11-tries-bit-manipulation',
)
_BASE_LIMIT = 'Integers and results stay within JavaScript’s exact integer range (±9,007,199,254,740,991).'
_TREE = ('Trees use compact breadth-first arrays: null marks a missing child; only '
         'non-null nodes consume the next two child positions. [] is an empty tree. '
         'Example: [1,null,2,3] means root 1 has right child 2, whose left child is 3. '
         'Output trees omit trailing nulls.')
_OPS = ('operations and args have the same length. Start with a new instance; do not '
        'include a constructor operation. Return one result per operation, using null '
        'for operations without a return value. There are at most 500 operations.')


def _add(chapter, number, title, input_spec, output_spec, fixtures,
         comparison='exact', constraints='Arrays and strings contain at most 1,000 elements.', note=''):
    identifier = f'{_CHAPTERS[chapter - 1]}/problem-{number}'
    _BANK[identifier] = {
        'id': identifier, 'title': title, 'input_spec': input_spec,
        'output_spec': output_spec, 'constraints': [constraints, _BASE_LIMIT],
        'comparison': comparison,
        'judge_note': ('Tests check returned values; they do not prove time complexity or '
                       'which algorithm you used. Submit includes additional local test cases. '
                       'These cases are stored on your computer, not kept secret by a server.'
                       + (' ' + note if note else '')),
        'cases': [{'id': f'case-{index + 1}', 'name': name, 'input': data,
                   'expected': expected, 'comparison': comparison, 'sample': index == 0}
                  for index, (name, data, expected) in enumerate(fixtures)],
    }


# Arrays, strings, and hashing.
_add(1, 1, 'Contains Duplicate', '{nums: integer[]}', 'Boolean: whether a value occurs more than once.', [
    ('Repeated value', {'nums': [1, 2, 3, 1]}, True),
    ('All distinct', {'nums': [1, 2, 3, 4]}, False),
    ('Empty array', {'nums': []}, False),
    ('Negative duplicate', {'nums': [-5, 0, 2, -5]}, True),
])
_add(1, 2, 'Valid Anagram', '{s: string, t: string}', 'Boolean: same characters with the same counts.', [
    ('Reordered letters', {'s': 'anagram', 't': 'nagaram'}, True),
    ('Different characters', {'s': 'rat', 't': 'car'}, False),
    ('Empty strings', {'s': '', 't': ''}, True),
    ('Repeated counts differ', {'s': 'aacc', 't': 'ccac'}, False),
], constraints='Strings use lowercase English letters; length is at most 1,000.')
_add(1, 3, 'Two Sum', '{nums: integer[], target: integer}', 'Two distinct zero-based indices, in either order.', [
    ('Pair at start', {'nums': [2, 7, 11, 15], 'target': 9}, [0, 1]),
    ('Pair inside', {'nums': [3, 2, 4], 'target': 6}, [1, 2]),
    ('Equal values, distinct indices', {'nums': [3, 3], 'target': 6}, [0, 1]),
    ('Negative target', {'nums': [-3, 4, 3, 90], 'target': 0}, [0, 2]),
], 'unordered', '2–1,000 numbers; exactly one valid pair exists.')
_add(1, 4, 'Group Anagrams', '{strs: string[]}', 'All anagram groups. Group order and order inside each group do not matter.', [
    ('Three groups', {'strs': ['eat', 'tea', 'tan', 'ate', 'nat', 'bat']}, [['eat', 'tea', 'ate'], ['tan', 'nat'], ['bat']]),
    ('No strings', {'strs': []}, []),
    ('Empty and repeated strings', {'strs': ['', '', 'a']}, [['', ''], ['a']]),
    ('Same letters, different counts', {'strs': ['ab', 'ba', 'abb', 'bba', 'abc']}, [['ab', 'ba'], ['abb', 'bba'], ['abc']]),
], 'nested_unordered', 'At most 100 lowercase English strings, each at most 100 characters.')
_add(1, 5, 'Top K Frequent Elements', '{nums: integer[], k: integer}', 'The k most frequent values, in any order.', [
    ('Two frequent values', {'nums': [1, 1, 1, 2, 2, 3], 'k': 2}, [1, 2]),
    ('One value', {'nums': [1], 'k': 1}, [1]),
    ('Negative most frequent', {'nums': [-1, -1, -1, 0, 0, 4], 'k': 1}, [-1]),
    ('All distinct values requested', {'nums': [3, 3, 2, 2, 1], 'k': 3}, [3, 2, 1]),
], 'unordered', '1–1,000 numbers; 1 ≤ k ≤ distinct values. No frequency tie crosses the kth boundary.')
_add(1, 6, 'Product of Array Except Self', '{nums: integer[]}', 'Array of products excluding the value at each index.', [
    ('Positive values', {'nums': [1, 2, 3, 4]}, [24, 12, 8, 6]),
    ('Single zero', {'nums': [-1, 1, 0, -3, 3]}, [0, 0, 9, 0, 0]),
    ('Two zeros', {'nums': [0, 2, 0]}, [0, 0, 0]),
    ('Signs', {'nums': [-2, -3, 4]}, [-12, -8, 6]),
], constraints='2–100 numbers; all prefix, suffix, and result products are exact safe integers. Avoid division; target O(n) time.')
_add(1, 7, 'Longest Consecutive Sequence', '{nums: integer[]}', 'Length of the longest run of consecutive distinct integers.', [
    ('Unordered run', {'nums': [100, 4, 200, 1, 3, 2]}, 4),
    ('Empty array', {'nums': []}, 0),
    ('Duplicate values', {'nums': [1, 2, 0, 1]}, 3),
    ('Run across zero', {'nums': [-3, -2, -1, 0, 2]}, 4),
])

# Two pointers and sliding windows.
_add(2, 1, 'Valid Palindrome', '{s: string}', 'Boolean after ignoring non-alphanumeric characters and case.', [
    ('Punctuation and case', {'s': 'A man, a plan, a canal: Panama'}, True),
    ('Not a palindrome', {'s': 'race a car'}, False),
    ('No letters or digits', {'s': ' ,.! '}, True),
    ('Digits count', {'s': '0P'}, False),
], constraints='ASCII strings with at most 1,000 characters.')
_add(2, 2, 'Two Sum II (Sorted Array)', '{numbers: integer[], target: integer}', 'Two distinct one-based positions, in either order.', [
    ('Sorted pair', {'numbers': [2, 7, 11, 15], 'target': 9}, [1, 2]),
    ('Outside pair', {'numbers': [2, 3, 4], 'target': 6}, [1, 3]),
    ('Duplicate values', {'numbers': [0, 0, 3, 4], 'target': 0}, [1, 2]),
    ('Negative values', {'numbers': [-3, -1, 0, 2, 5], 'target': 1}, [2, 4]),
], 'unordered', '2–1,000 sorted numbers; exactly one valid pair exists.')
_add(2, 3, '3Sum', '{nums: integer[]}', 'All unique triples summing to zero; triple and value order do not matter.', [
    ('Two triplets', {'nums': [-1, 0, 1, 2, -1, -4]}, [[-1, -1, 2], [-1, 0, 1]]),
    ('Repeated zeros', {'nums': [0, 0, 0, 0]}, [[0, 0, 0]]),
    ('No triplets', {'nums': [1, 2, 3]}, []),
    ('Empty array', {'nums': []}, []),
], 'nested_unordered', 'At most 200 numbers; do not return duplicate triplets.')
_add(2, 4, 'Best Time to Buy and Sell Stock', '{prices: integer[]}', 'Maximum nonnegative profit from one buy followed by one sell.', [
    ('Profit later', {'prices': [7, 1, 5, 3, 6, 4]}, 5),
    ('Falling prices', {'prices': [7, 6, 4, 3, 1]}, 0),
    ('No prices', {'prices': []}, 0),
    ('Cannot sell before buying', {'prices': [5, 1, 2]}, 1),
], constraints='At most 1,000 nonnegative prices.')
_add(2, 5, 'Longest Substring Without Repeating Characters', '{s: string}', 'Length of the longest contiguous substring with no repeated character.', [
    ('Repeating pattern', {'s': 'abcabcbb'}, 3),
    ('One repeated character', {'s': 'bbbbb'}, 1),
    ('Empty string', {'s': ''}, 0),
    ('Move past previous occurrence', {'s': 'abba'}, 2),
], constraints='ASCII strings with at most 1,000 characters.')
_add(2, 6, 'Minimum Window Substring', '{s: string, t: string}', 'Shortest substring of s containing every character of t with multiplicity; empty string if impossible.', [
    ('Smallest covering window', {'s': 'ADOBECODEBANC', 't': 'ABC'}, 'BANC'),
    ('Insufficient occurrences', {'s': 'a', 't': 'aa'}, ''),
    ('Repeated requirement', {'s': 'aaab', 't': 'aab'}, 'aab'),
    ('Empty requirement', {'s': 'abc', 't': ''}, ''),
], constraints='ASCII strings with at most 1,000 characters. Tests have a unique shortest window, or t is empty.')

# Stacks, queues, and linked lists.
_add(3, 1, 'Valid Parentheses', '{s: string}', 'Boolean: every bracket closes in the correct order.', [
    ('Separate pairs', {'s': '()[]{}'}, True),
    ('Crossed nesting', {'s': '([)]'}, False),
    ('Unclosed opening', {'s': '(('}, False),
    ('Empty sequence', {'s': ''}, True),
], constraints='At most 1,000 characters; only ()[]{} occur.')
_add(3, 2, 'Implement Queue Using Stacks', '{operations: string[], args: array[]} with push(value), pop(), peek(), empty(). ' + _OPS,
     'Results in operation order: null for push, integer for pop/peek, boolean for empty.', [
    ('FIFO sequence', {'operations': ['push', 'push', 'peek', 'pop', 'empty'], 'args': [[1], [2], [], [], []]}, [None, None, 1, 1, False]),
    ('Empty queue', {'operations': ['empty'], 'args': [[]]}, [True]),
    ('Refill after drain', {'operations': ['push', 'pop', 'empty', 'push', 'peek'], 'args': [[-3], [], [], [8], []]}, [None, -3, True, None, 8]),
    ('Interleaved transfers', {'operations': ['push', 'push', 'pop', 'push', 'pop', 'pop', 'empty'], 'args': [[1], [2], [], [3], [], [], []]}, [None, None, 1, None, 2, 3, True]),
], constraints='pop and peek are only called on nonempty queues. Use two stacks.')
_add(3, 3, 'Reverse Linked List', '{values: integer[]} represents nodes in linked-list order.', 'Values of the reversed linked list as an array.', [
    ('Several nodes', {'values': [1, 2, 3, 4, 5]}, [5, 4, 3, 2, 1]),
    ('Empty list', {'values': []}, []),
    ('One node', {'values': [7]}, [7]),
    ('Duplicates and negatives', {'values': [-1, 0, -1, 3]}, [3, -1, 0, -1]),
])
_add(3, 4, 'Merge Two Sorted Lists', '{list1: integer[], list2: integer[]} represents two ascending linked lists.', 'Merged ascending linked-list values as an array, preserving duplicates.', [
    ('Interleaved values', {'list1': [1, 2, 4], 'list2': [1, 3, 4]}, [1, 1, 2, 3, 4, 4]),
    ('Both empty', {'list1': [], 'list2': []}, []),
    ('One empty', {'list1': [], 'list2': [0]}, [0]),
    ('Negative values', {'list1': [-3, 2], 'list2': [-2, -1, 4]}, [-3, -2, -1, 2, 4]),
], constraints='Each list is sorted ascending and contains at most 500 nodes.')
_add(3, 5, 'Linked List Cycle Detection', '{values: integer[], pos: integer}. The tail points to zero-based node pos; -1 means no cycle.', 'Boolean: whether the resulting linked list contains a cycle.', [
    ('Tail links back', {'values': [3, 2, 0, -4], 'pos': 1}, True),
    ('No cycle with equal values', {'values': [1, 1], 'pos': -1}, False),
    ('Self-loop', {'values': [1], 'pos': 0}, True),
    ('Empty list', {'values': [], 'pos': -1}, False),
], constraints='At most 1,000 nodes. pos is -1 or a valid node index.', note='The JSON adapter describes the cycle using pos; output tests cannot verify pointer identity or use of Floyd’s algorithm.')
_add(3, 6, 'Daily Temperatures (Monotonic Stack)', '{temperatures: integer[]}', 'Wait in days for a strictly warmer temperature, or zero if none follows.', [
    ('Mixed temperatures', {'temperatures': [73, 74, 75, 71, 69, 72, 76, 73]}, [1, 1, 4, 2, 1, 1, 0, 0]),
    ('Always warmer', {'temperatures': [30, 40, 50, 60]}, [1, 1, 1, 0]),
    ('Equal temperatures', {'temperatures': [50, 50, 50]}, [0, 0, 0]),
    ('Empty record', {'temperatures': []}, []),
])
_add(3, 7, 'LRU Cache', '{capacity: integer, operations: string[], args: array[]} with get(key), put(key,value). ' + _OPS,
     'null for put; stored value or -1 for get. get and updates make the key most recently used.', [
    ('Eviction order', {'capacity': 2, 'operations': ['put', 'put', 'get', 'put', 'get'], 'args': [[1, 1], [2, 2], [1], [3, 3], [2]]}, [None, None, 1, None, -1]),
    ('Capacity one', {'capacity': 1, 'operations': ['put', 'put', 'get', 'get'], 'args': [[1, 8], [2, 9], [1], [2]]}, [None, None, -1, 9]),
    ('Update refreshes recency', {'capacity': 2, 'operations': ['put', 'put', 'put', 'put', 'get', 'get'], 'args': [[1, 1], [2, 2], [1, 5], [3, 3], [1], [2]]}, [None, None, None, None, 5, -1]),
    ('Miss and zero value', {'capacity': 1, 'operations': ['get', 'put', 'get'], 'args': [[9], [9, 0], [9]]}, [-1, None, 0]),
], constraints='1 ≤ capacity ≤ 100; integer keys and values. Target O(1) average get/put.')

# Binary search.
_add(4, 1, 'Binary Search (Classic)', '{nums: integer[], target: integer}', 'Zero-based index of target, or -1.', [
    ('Found inside', {'nums': [-1, 0, 3, 5, 9, 12], 'target': 9}, 4),
    ('Absent', {'nums': [-1, 0, 3, 5, 9, 12], 'target': 2}, -1),
    ('Empty array', {'nums': [], 'target': 0}, -1),
    ('Single element', {'nums': [4], 'target': 4}, 0),
], constraints='At most 1,000 strictly increasing numbers; target O(log n).')
_add(4, 2, 'Search Insert Position', '{nums: integer[], target: integer}', 'Zero-based index of target, or insertion position maintaining ascending order.', [
    ('Existing element', {'nums': [1, 3, 5, 6], 'target': 5}, 2),
    ('Insert inside', {'nums': [1, 3, 5, 6], 'target': 2}, 1),
    ('Insert at end', {'nums': [1, 3, 5, 6], 'target': 7}, 4),
    ('Empty array', {'nums': [], 'target': 0}, 0),
], constraints='At most 1,000 strictly increasing numbers; target O(log n).')
_add(4, 3, 'Find First and Last Position of Element in Sorted Array', '{nums: integer[], target: integer}', '[firstIndex,lastIndex], or [-1,-1] when absent.', [
    ('Repeated target', {'nums': [5, 7, 7, 8, 8, 10], 'target': 8}, [3, 4]),
    ('Absent target', {'nums': [5, 7, 7, 8, 8, 10], 'target': 6}, [-1, -1]),
    ('Empty array', {'nums': [], 'target': 0}, [-1, -1]),
    ('All equal', {'nums': [2, 2, 2, 2], 'target': 2}, [0, 3]),
], constraints='At most 1,000 ascending numbers, duplicates allowed; target O(log n).')
_add(4, 4, 'Search in Rotated Sorted Array', '{nums: integer[], target: integer}', 'Zero-based index of target in the supplied rotated array, or -1.', [
    ('After rotation point', {'nums': [4, 5, 6, 7, 0, 1, 2], 'target': 0}, 4),
    ('Absent target', {'nums': [4, 5, 6, 7, 0, 1, 2], 'target': 3}, -1),
    ('Single element', {'nums': [1], 'target': 1}, 0),
    ('Two elements rotated', {'nums': [3, 1], 'target': 3}, 0),
], constraints='1–1,000 distinct values from an ascending array rotated zero or more positions; target O(log n).')
_add(4, 5, 'Find Minimum in Rotated Sorted Array', '{nums: integer[]}', 'The minimum value.', [
    ('Rotated array', {'nums': [4, 5, 6, 7, 0, 1, 2]}, 0),
    ('No rotation', {'nums': [1, 2, 3, 4, 5]}, 1),
    ('One element', {'nums': [-7]}, -7),
    ('Minimum at end', {'nums': [2, 3, 4, 1]}, 1),
], constraints='1–1,000 distinct values from a rotated ascending array; target O(log n).')
_add(4, 6, 'Koko Eating Bananas (Binary Search on the Answer)', '{piles: integer[], h: integer}', 'Minimum positive integer eating speed to finish within h hours.', [
    ('Partial piles per hour', {'piles': [3, 6, 7, 11], 'h': 8}, 4),
    ('One hour per pile', {'piles': [30, 11, 23, 4, 20], 'h': 5}, 30),
    ('One extra hour', {'piles': [30, 11, 23, 4, 20], 'h': 6}, 23),
    ('One pile, ample time', {'piles': [8], 'h': 9}, 1),
], constraints='1–1,000 positive piles, each ≤ 1,000,000; len(piles) ≤ h ≤ 1,000,000,000.')

# Binary trees; JSON arrays deliberately have one consistent, documented format.
_add(5, 1, 'Maximum Depth of Binary Tree', '{root: (integer|null)[]} ' + _TREE, 'Maximum number of nodes on a root-to-leaf path.', [
    ('Three levels', {'root': [3, 9, 20, None, None, 15, 7]}, 3),
    ('Empty tree', {'root': []}, 0),
    ('One node', {'root': [0]}, 1),
    ('Right-side chain', {'root': [1, None, 2, None, 3, None, 4]}, 4),
], constraints='At most 200 nodes.')
_add(5, 2, 'Invert Binary Tree', '{root: (integer|null)[]} ' + _TREE, 'Inverted tree in the same compact breadth-first format.', [
    ('Full tree', {'root': [4, 2, 7, 1, 3, 6, 9]}, [4, 7, 2, 9, 6, 3, 1]),
    ('Empty tree', {'root': []}, []),
    ('One node', {'root': [5]}, [5]),
    ('Sparse tree', {'root': [1, 2, None, None, 3]}, [1, None, 2, 3]),
], constraints='At most 200 nodes.')
_add(5, 3, 'Same Tree', '{p: (integer|null)[], q: (integer|null)[]} ' + _TREE, 'Boolean: equal structure and node values.', [
    ('Identical trees', {'p': [1, 2, 3], 'q': [1, 2, 3]}, True),
    ('Same values, different structure', {'p': [1, 2], 'q': [1, None, 2]}, False),
    ('Both empty', {'p': [], 'q': []}, True),
    ('Different value', {'p': [1, 2, 1], 'q': [1, 1, 2]}, False),
], constraints='At most 200 nodes per tree.')
_add(5, 4, 'Binary Tree Level Order Traversal', '{root: (integer|null)[]} ' + _TREE, 'One array per depth, ordered from root downward and left to right.', [
    ('Three levels', {'root': [3, 9, 20, None, None, 15, 7]}, [[3], [9, 20], [15, 7]]),
    ('Empty tree', {'root': []}, []),
    ('One node', {'root': [1]}, [[1]]),
    ('Sparse tree', {'root': [1, None, 2, 3]}, [[1], [2], [3]]),
], constraints='At most 200 nodes; null placeholders are not returned as values.')
_add(5, 5, 'Validate Binary Search Tree', '{root: (integer|null)[]} ' + _TREE, 'Boolean: every left descendant is smaller and every right descendant larger.', [
    ('Ancestor-bound violation', {'root': [5, 1, 4, None, None, 3, 6]}, False),
    ('Valid tree', {'root': [5, 3, 8]}, True),
    ('Empty tree', {'root': []}, True),
    ('Duplicate value', {'root': [2, 2, 3]}, False),
], constraints='At most 200 nodes; equal values violate the strict BST rule.')
_add(5, 6, 'Kth Smallest Element in a BST', '{root: (integer|null)[], k: integer} ' + _TREE, 'The kth smallest value (k is one-based).', [
    ('First value', {'root': [3, 1, 4, None, 2], 'k': 1}, 1),
    ('Middle value', {'root': [3, 1, 4, None, 2], 'k': 3}, 3),
    ('Only node', {'root': [-7], 'k': 1}, -7),
    ('Largest value', {'root': [5, 3, 6, 2, 4, None, None, 1], 'k': 6}, 6),
], constraints='Valid BST with 1–200 distinct values; 1 ≤ k ≤ node count.')
_add(5, 7, 'Lowest Common Ancestor of a Binary Search Tree', '{root: (integer|null)[], p: integer, q: integer}. p and q identify node values. ' + _TREE,
     'Value of the lowest common ancestor.', [
    ('Across root branches', {'root': [6, 2, 8, 0, 4, 7, 9, None, None, 3, 5], 'p': 2, 'q': 8}, 6),
    ('A node is its own ancestor', {'root': [6, 2, 8, 0, 4, 7, 9, None, None, 3, 5], 'p': 2, 'q': 4}, 2),
    ('Lower subtree', {'root': [6, 2, 8, 0, 4, 7, 9, None, None, 3, 5], 'p': 3, 'q': 5}, 4),
    ('Two nodes', {'root': [2, 1], 'p': 1, 'q': 2}, 2),
], constraints='Valid BST with 2–200 unique values; p and q are distinct values present in the tree.')

# Heaps and priority queues.
_add(6, 1, 'Kth Largest Element in an Array', '{nums: integer[], k: integer}', 'The kth largest value, counting duplicates.', [
    ('Second largest', {'nums': [3, 2, 1, 5, 6, 4], 'k': 2}, 5),
    ('Duplicate values count', {'nums': [3, 2, 3, 1, 2, 4, 5, 5, 6], 'k': 4}, 4),
    ('Single value', {'nums': [-1], 'k': 1}, -1),
    ('Smallest requested', {'nums': [-3, 7, 0, 7], 'k': 4}, -3),
], constraints='1–1,000 numbers; 1 ≤ k ≤ len(nums).')
_add(6, 2, 'Last Stone Weight', '{stones: integer[]}', 'Last remaining weight, or zero when all stones are destroyed.', [
    ('Repeated smashes', {'stones': [2, 7, 4, 1, 8, 1]}, 1),
    ('One stone', {'stones': [1]}, 1),
    ('Equal stones', {'stones': [2, 2]}, 0),
    ('No stones', {'stones': []}, 0),
], constraints='At most 1,000 positive stone weights.')
_add(6, 3, 'K Closest Points to Origin', '{points: integer[2][], k: integer}', 'The k closest [x,y] points, in any order; keep coordinate order within each point.', [
    ('Closest of two', {'points': [[1, 3], [-2, 2]], 'k': 1}, [[-2, 2]]),
    ('Two closest', {'points': [[3, 3], [5, -1], [-2, 4]], 'k': 2}, [[3, 3], [-2, 4]]),
    ('Origin', {'points': [[0, 0], [2, 1], [-1, 1]], 'k': 1}, [[0, 0]]),
    ('Every point', {'points': [[1, -2], [-3, 4]], 'k': 2}, [[1, -2], [-3, 4]]),
], 'unordered', '1–1,000 points with coordinates of magnitude ≤ 1,000,000. 1 ≤ k ≤ point count; no distance tie crosses kth boundary.')
_add(6, 4, 'Task Scheduler', '{tasks: string[], n: integer}', 'Minimum time slots, including idle slots, to execute all tasks.', [
    ('Cooldown needs idle slots', {'tasks': ['A', 'A', 'A', 'B', 'B', 'B'], 'n': 2}, 8),
    ('No cooldown', {'tasks': ['A', 'A', 'A', 'B', 'B', 'B'], 'n': 0}, 6),
    ('Other tasks fill gaps', {'tasks': ['A', 'A', 'B', 'B', 'C', 'C'], 'n': 2}, 6),
    ('No tasks', {'tasks': [], 'n': 3}, 0),
], constraints='At most 1,000 tasks labeled A–Z; 0 ≤ n ≤ 100.')
_add(6, 5, 'Find Median from Data Stream', '{operations: string[], args: array[]} with add_num(value), find_median(). ' + _OPS,
     'null for add_num; numeric median for find_median, averaging two middle values for even counts.', [
    ('Odd and even counts', {'operations': ['add_num', 'add_num', 'find_median', 'add_num', 'find_median'], 'args': [[1], [2], [], [3], []]}, [None, None, 1.5, None, 2]),
    ('Negative values', {'operations': ['add_num', 'add_num', 'find_median'], 'args': [[-5], [-2], []]}, [None, None, -3.5]),
    ('Duplicates', {'operations': ['add_num', 'add_num', 'add_num', 'find_median'], 'args': [[4], [4], [4], []]}, [None, None, None, 4]),
    ('Unordered stream', {'operations': ['add_num', 'find_median', 'add_num', 'add_num', 'find_median'], 'args': [[10], [], [0], [3], []]}, [None, 10, None, None, 3]),
], 'approximate', 'find_median is only called after at least one add_num. Numeric tolerance is 1e-7.')
_add(6, 6, 'Merge K Sorted Lists', '{lists: integer[][]} represents ascending linked lists.', 'Merged ascending values as one array.', [
    ('Three sorted lists', {'lists': [[1, 4, 5], [1, 3, 4], [2, 6]]}, [1, 1, 2, 3, 4, 4, 5, 6]),
    ('No lists', {'lists': []}, []),
    ('Empty lists', {'lists': [[], []]}, []),
    ('Mixed empty and negative values', {'lists': [[-5, 0], [], [-3, 2, 2]]}, [-5, -3, 0, 2, 2]),
], constraints='At most 100 lists and 1,000 nodes in total; each list is sorted ascending.')

# Graphs and grids.
_add(7, 1, 'Number of Islands', '{grid: string[][]} where each cell is "0" (water) or "1" (land).', 'Number of four-directionally connected land components.', [
    ('Separate islands', {'grid': [['1', '1', '0', '0'], ['1', '1', '0', '0'], ['0', '0', '1', '0'], ['0', '0', '0', '1']]}, 3),
    ('Empty grid', {'grid': []}, 0),
    ('Water only', {'grid': [['0', '0']]}, 0),
    ('Diagonal is not connected', {'grid': [['1', '0'], ['0', '1']]}, 2),
], constraints='Rectangular grid up to 20×20; cells are JSON strings, not numbers.')
_add(7, 2, 'Clone Graph', '{adjList: integer[][]}. Row i lists neighbors of node i+1; [] means no nodes.',
     'The cloned adjacency list with rows in node-label order. Neighbor order does not matter.', [
    ('Four-node cycle', {'adjList': [[2, 4], [1, 3], [2, 4], [1, 3]]}, [[2, 4], [1, 3], [2, 4], [1, 3]]),
    ('Empty graph', {'adjList': []}, []),
    ('Isolated node', {'adjList': [[]]}, [[]]),
    ('Connected chain', {'adjList': [[2], [1, 3], [2]]}, [[2], [1, 3], [2]]),
], 'rows_unordered', 'Connected undirected graph with at most 100 nodes labeled 1…n; no repeated edges or self-loops.',
     'This JSON exercise checks cloned structure only. Object identity and deep-copy independence cannot be verified from serialized output; review those properties yourself.')
_add(7, 3, 'Course Schedule (Topological Sort / Cycle Detection)', '{numCourses: integer, prerequisites: integer[2][]}. [a,b] requires b before a.', 'Boolean: whether every course can be completed.', [
    ('Simple dependency', {'numCourses': 2, 'prerequisites': [[1, 0]]}, True),
    ('Cycle', {'numCourses': 2, 'prerequisites': [[1, 0], [0, 1]]}, False),
    ('Independent courses', {'numCourses': 3, 'prerequisites': []}, True),
    ('Cycle in disconnected component', {'numCourses': 4, 'prerequisites': [[1, 0], [2, 3], [3, 2]]}, False),
], constraints='1–200 courses labeled 0…numCourses−1; at most 1,000 prerequisite pairs.')
_add(7, 4, 'Number of Connected Components (Union-Find)', '{n: integer, edges: integer[2][]}. Edges are undirected.', 'Number of connected components, including isolated nodes.', [
    ('Two components', {'n': 5, 'edges': [[0, 1], [1, 2], [3, 4]]}, 2),
    ('All isolated', {'n': 4, 'edges': []}, 4),
    ('Redundant cycle edge', {'n': 3, 'edges': [[0, 1], [1, 2], [0, 2]]}, 1),
    ('No nodes', {'n': 0, 'edges': []}, 0),
], constraints='0–200 nodes labeled 0…n−1; at most 1,000 edges.')
_add(7, 5, 'Pacific Atlantic Water Flow (Multi-source BFS/DFS)', '{heights: integer[][]}. Water moves up/down/left/right to equal or lower heights.',
     'All [row,column] cells that reach both top/left and bottom/right boundaries, in any order.', [
    ('Two-ocean paths', {'heights': [[1, 2, 2, 3, 5], [3, 2, 3, 4, 4], [2, 4, 5, 3, 1], [6, 7, 1, 4, 5], [5, 1, 1, 2, 4]]}, [[0, 4], [1, 3], [1, 4], [2, 2], [3, 0], [3, 1], [4, 0]]),
    ('Single cell', {'heights': [[7]]}, [[0, 0]]),
    ('Flat plateau', {'heights': [[1, 1], [1, 1]]}, [[0, 0], [0, 1], [1, 0], [1, 1]]),
    ('Empty grid', {'heights': []}, []),
], 'unordered', 'Rectangular grid up to 20×20; coordinates are zero-based and ordered [row,column].')
_add(7, 6, "Network Delay Time (Dijkstra's Algorithm)", '{times: integer[3][], n: integer, k: integer}. [u,v,w] is directed with travel time w.',
     'Time for every node to receive the signal from k, or -1 when any node is unreachable.', [
    ('Branch and chain', {'times': [[2, 1, 1], [2, 3, 1], [3, 4, 1]], 'n': 4, 'k': 2}, 2),
    ('Wrong direction', {'times': [[1, 2, 1]], 'n': 2, 'k': 2}, -1),
    ('Single node', {'times': [], 'n': 1, 'k': 1}, 0),
    ('Cheaper indirect path', {'times': [[1, 2, 10], [1, 3, 1], [3, 2, 1]], 'n': 3, 'k': 1}, 2),
], constraints='1–200 nodes labeled 1…n; k is valid; nonnegative weights ≤ 1,000,000; at most 1,000 edges.')
_add(7, 7, "Minimum Spanning Tree — Connecting Cities with Minimum Cost (Kruskal's Algorithm)",
     '{n: integer, connections: integer[3][]}. [a,b,cost] connects two cities in either direction.',
     'Minimum total connection cost, or -1 if the cities cannot all be connected.', [
    ('Choose cheapest spanning edges', {'n': 3, 'connections': [[1, 2, 5], [1, 3, 6], [2, 3, 1]]}, 6),
    ('Disconnected cities', {'n': 4, 'connections': [[1, 2, 3], [3, 4, 4]]}, -1),
    ('One city', {'n': 1, 'connections': []}, 0),
    ('Avoid expensive cycle', {'n': 4, 'connections': [[1, 2, 1], [2, 3, 2], [1, 3, 5], [3, 4, 1], [2, 4, 4]]}, 4),
], constraints='1–200 cities labeled 1…n; nonnegative costs ≤ 1,000,000; at most 1,000 connections.')

# Backtracking.
_add(8, 1, 'Subsets', '{nums: integer[]}', 'All subsets, including the empty set. Subset and element order do not matter.', [
    ('Three elements', {'nums': [1, 2, 3]}, [[], [1], [2], [1, 2], [3], [1, 3], [2, 3], [1, 2, 3]]),
    ('Empty input', {'nums': []}, [[]]),
    ('One element', {'nums': [0]}, [[], [0]]),
    ('Negative element', {'nums': [-1, 2]}, [[], [-1], [2], [-1, 2]]),
], 'nested_unordered', 'At most 10 distinct integers; return every subset once.')
_add(8, 2, 'Permutations', '{nums: integer[]}', 'Every ordering exactly once. Outer order does not matter; order within each permutation does.', [
    ('Three elements', {'nums': [1, 2, 3]}, [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]]),
    ('Empty input', {'nums': []}, [[]]),
    ('One element', {'nums': [7]}, [[7]]),
    ('Two elements', {'nums': [-1, 0]}, [[-1, 0], [0, -1]]),
], 'unordered', 'At most 6 distinct integers.')
_add(8, 3, 'Combination Sum', '{candidates: integer[], target: integer}', 'All unique combinations summing to target, allowing repeated use. Combination and value order do not matter.', [
    ('Reuse or single candidate', {'candidates': [2, 3, 6, 7], 'target': 7}, [[2, 2, 3], [7]]),
    ('No combination', {'candidates': [2], 'target': 1}, []),
    ('Multiple repeated candidates', {'candidates': [2, 3, 5], 'target': 8}, [[2, 2, 2, 2], [2, 3, 3], [3, 5]]),
    ('Zero target', {'candidates': [2, 3], 'target': 0}, [[]]),
], 'nested_unordered', '1–10 distinct positive candidates; 0 ≤ target ≤ 30.')
_add(8, 4, 'Word Search', '{board: string[][], word: string}. Each board cell is one character.', 'Boolean: the word can follow four-directionally adjacent cells without reusing a cell.', [
    ('Turning path', {'board': [['A', 'B', 'C', 'E'], ['S', 'F', 'C', 'S'], ['A', 'D', 'E', 'E']], 'word': 'ABCCED'}, True),
    ('Would reuse a cell', {'board': [['A', 'B', 'C', 'E'], ['S', 'F', 'C', 'S'], ['A', 'D', 'E', 'E']], 'word': 'ABCB'}, False),
    ('One matching cell', {'board': [['A']], 'word': 'A'}, True),
    ('Diagonal is not adjacent', {'board': [['A', 'X'], ['X', 'B']], 'word': 'AB'}, False),
], constraints='Nonempty rectangular board up to 6×6 with English letters; word length 1–12.')
_add(8, 5, 'Palindrome Partitioning', '{s: string}', 'All partitions into palindromes. Partition order does not matter; substring order within a partition does.', [
    ('Two possible partitions', {'s': 'aab'}, [['a', 'a', 'b'], ['aa', 'b']]),
    ('Empty string', {'s': ''}, [[]]),
    ('One character', {'s': 'a'}, [['a']]),
    ('Longer palindrome', {'s': 'aba'}, [['a', 'b', 'a'], ['aba']]),
], 'unordered', 'Lowercase English strings with at most 10 characters.')
_add(8, 6, 'N-Queens', '{n: integer}', 'Number of distinct placements with no queens sharing a row, column, or diagonal.', [
    ('Four queens', {'n': 4}, 2),
    ('One queen', {'n': 1}, 1),
    ('Impossible size', {'n': 3}, 0),
    ('Eight queens', {'n': 8}, 92),
], constraints='1 ≤ n ≤ 8.')

# Dynamic programming.
_add(9, 1, 'Climbing Stairs (1D DP)', '{n: integer}', 'Number of ways to climb n steps using moves of one or two.', [
    ('Three steps', {'n': 3}, 3),
    ('One step', {'n': 1}, 1),
    ('Two steps', {'n': 2}, 2),
    ('Longer staircase', {'n': 10}, 89),
], constraints='1 ≤ n ≤ 40.')
_add(9, 2, 'House Robber (1D DP)', '{nums: integer[]}', 'Maximum sum choosing no two adjacent houses.', [
    ('Nonadjacent optimum', {'nums': [2, 7, 9, 3, 1]}, 12),
    ('No houses', {'nums': []}, 0),
    ('Single house', {'nums': [5]}, 5),
    ('Skip two middle houses', {'nums': [2, 1, 1, 2]}, 4),
], constraints='At most 1,000 nonnegative house values.')
_add(9, 3, 'Coin Change (Unbounded Knapsack)', '{coins: integer[], amount: integer}', 'Fewest coins reaching amount, or -1 if impossible.', [
    ('Mixed coins', {'coins': [1, 2, 5], 'amount': 11}, 3),
    ('Impossible amount', {'coins': [2], 'amount': 3}, -1),
    ('Zero amount', {'coins': [1], 'amount': 0}, 0),
    ('Greedy choice would fail', {'coins': [1, 3, 4], 'amount': 6}, 2),
], constraints='1–20 distinct positive coin values; 0 ≤ amount ≤ 10,000.')
_add(9, 4, 'Longest Increasing Subsequence (LIS)', '{nums: integer[]}', 'Length of the longest strictly increasing subsequence.', [
    ('Noncontiguous sequence', {'nums': [10, 9, 2, 5, 3, 7, 101, 18]}, 4),
    ('All equal', {'nums': [7, 7, 7, 7]}, 1),
    ('Empty input', {'nums': []}, 0),
    ('Repeated and increasing', {'nums': [0, 1, 0, 3, 2, 3]}, 4),
])
_add(9, 5, 'Longest Common Subsequence (LCS) — 2D DP', '{text1: string, text2: string}', 'Length of the longest subsequence common to both strings.', [
    ('Skip characters', {'text1': 'abcde', 'text2': 'ace'}, 3),
    ('No shared characters', {'text1': 'abc', 'text2': 'def'}, 0),
    ('Empty string', {'text1': '', 'text2': 'abc'}, 0),
    ('Repeated characters', {'text1': 'aab', 'text2': 'azab'}, 3),
], constraints='Lowercase English strings with at most 200 characters each.')
_add(9, 6, '0/1 Knapsack', '{weights: integer[], values: integer[], capacity: integer}', 'Maximum total value without exceeding capacity; use each item at most once.', [
    ('Best pair', {'weights': [1, 3, 4, 5], 'values': [1, 4, 5, 7], 'capacity': 7}, 9),
    ('Zero capacity', {'weights': [2, 3], 'values': [5, 8], 'capacity': 0}, 0),
    ('No items', {'weights': [], 'values': [], 'capacity': 5}, 0),
    ('Cannot reuse an item', {'weights': [2, 3], 'values': [3, 4], 'capacity': 4}, 4),
], constraints='Matching arrays with at most 100 items; weights positive, values nonnegative; 0 ≤ capacity ≤ 1,000.')
_add(9, 7, 'Edit Distance (2D DP)', '{word1: string, word2: string}', 'Minimum number of single-character insertions, deletions, and replacements.', [
    ('Mixed edits', {'word1': 'horse', 'word2': 'ros'}, 3),
    ('Longer transformation', {'word1': 'intention', 'word2': 'execution'}, 5),
    ('Insert all characters', {'word1': '', 'word2': 'abc'}, 3),
    ('Identical strings', {'word1': 'same', 'word2': 'same'}, 0),
], constraints='Lowercase English strings with at most 200 characters each.')
_add(9, 8, 'Best Time to Buy and Sell Stock with Cooldown (State Machine DP)', '{prices: integer[]}', 'Maximum profit with repeated transactions and one cooldown day after selling.', [
    ('Cooldown changes optimum', {'prices': [1, 2, 3, 0, 2]}, 3),
    ('One day', {'prices': [1]}, 0),
    ('Empty prices', {'prices': []}, 0),
    ('Hold through increasing prices', {'prices': [1, 2, 4]}, 3),
], constraints='At most 1,000 nonnegative prices; hold at most one share at a time.')

# Greedy algorithms and intervals.
_add(10, 1, 'Assign Cookies', '{g: integer[], s: integer[]} where g is greed and s is cookie size.', 'Maximum number of satisfied children, using each cookie at most once.', [
    ('Not enough large cookies', {'g': [1, 2, 3], 's': [1, 1]}, 1),
    ('Extra cookies', {'g': [1, 2], 's': [1, 2, 3]}, 2),
    ('No children', {'g': [], 's': [1, 2]}, 0),
    ('Unsorted inputs', {'g': [3, 1, 2], 's': [2, 3]}, 2),
], constraints='At most 1,000 positive values in each array.')
_add(10, 2, 'Merge Intervals', '{intervals: integer[2][]}', 'Merged intervals, ordered by start. Touching endpoints overlap.', [
    ('Separate and overlapping ranges', {'intervals': [[1, 3], [2, 6], [8, 10], [15, 18]]}, [[1, 6], [8, 10], [15, 18]]),
    ('Touching ranges', {'intervals': [[1, 4], [4, 5]]}, [[1, 5]]),
    ('No intervals', {'intervals': []}, []),
    ('Contained and unsorted', {'intervals': [[3, 4], [1, 10], [2, 6]]}, [[1, 10]]),
], constraints='At most 1,000 closed intervals [start,end] with start ≤ end.')
_add(10, 3, 'Non-overlapping Intervals (Minimum Removals)', '{intervals: integer[2][]}', 'Minimum intervals to remove; intervals that only touch at an endpoint do not overlap.', [
    ('One removal', {'intervals': [[1, 2], [2, 3], [3, 4], [1, 3]]}, 1),
    ('Identical intervals', {'intervals': [[1, 2], [1, 2], [1, 2]]}, 2),
    ('Touching intervals', {'intervals': [[1, 2], [2, 3]]}, 0),
    ('No intervals', {'intervals': []}, 0),
], constraints='At most 1,000 intervals [start,end] with start < end.')
_add(10, 4, 'Meeting Rooms II (Minimum Rooms Needed)', '{intervals: integer[2][]}', 'Minimum simultaneous rooms; a room is reusable when its previous meeting ends.', [
    ('Overlapping meetings', {'intervals': [[0, 30], [5, 10], [15, 20]]}, 2),
    ('Separate meetings', {'intervals': [[7, 10], [2, 4]]}, 1),
    ('No meetings', {'intervals': []}, 0),
    ('End equals next start', {'intervals': [[1, 3], [3, 5], [5, 8]]}, 1),
], constraints='At most 1,000 intervals [start,end] with start < end.')
_add(10, 5, 'Jump Game', '{nums: integer[]}', 'Boolean: the final index is reachable from index zero.', [
    ('Reachable', {'nums': [2, 3, 1, 1, 4]}, True),
    ('Blocked by zero', {'nums': [3, 2, 1, 0, 4]}, False),
    ('Already at the end', {'nums': [0]}, True),
    ('Cannot make first jump', {'nums': [0, 1]}, False),
], constraints='1–1,000 nonnegative jump lengths.')
_add(10, 6, 'Gas Station', '{gas: integer[], cost: integer[]}', 'Zero-based starting station completing a full circuit, or -1.', [
    ('Successful circuit', {'gas': [1, 2, 3, 4, 5], 'cost': [3, 4, 5, 1, 2]}, 3),
    ('Insufficient total gas', {'gas': [2, 3, 4], 'cost': [3, 4, 3]}, -1),
    ('One station', {'gas': [2], 'cost': [2]}, 0),
    ('Start after deficit', {'gas': [2, 4, 1], 'cost': [3, 1, 3]}, 1),
], constraints='Matching nonempty arrays of at most 1,000 nonnegative integers; at most one valid start exists.')

# Bit operations and tries.
_add(11, 1, 'Single Number', '{nums: integer[]}', 'The one value that occurs once.', [
    ('Unpaired value', {'nums': [4, 1, 2, 1, 2]}, 4),
    ('One element', {'nums': [1]}, 1),
    ('Negative singleton', {'nums': [-3, 2, 2]}, -3),
    ('Zero singleton', {'nums': [7, 0, 7]}, 0),
], constraints='1–1,000 signed 32-bit integers; exactly one occurs once and every other value occurs twice.')
_add(11, 2, 'Number of 1 Bits (Hamming Weight)', '{n: integer}', 'Number of set bits in the unsigned 32-bit representation.', [
    ('Several set bits', {'n': 11}, 3),
    ('Power of two', {'n': 128}, 1),
    ('Zero', {'n': 0}, 0),
    ('Every bit set', {'n': 4294967295}, 32),
], constraints='0 ≤ n ≤ 4,294,967,295; use unsigned interpretation.')
_add(11, 3, 'Counting Bits', '{n: integer}', 'Array of bit counts for every integer from zero through n, inclusive.', [
    ('Through five', {'n': 5}, [0, 1, 1, 2, 1, 2]),
    ('Zero only', {'n': 0}, [0]),
    ('Power of two boundary', {'n': 2}, [0, 1, 1]),
    ('Through eight', {'n': 8}, [0, 1, 1, 2, 1, 2, 2, 3, 1]),
], constraints='0 ≤ n ≤ 10,000.')
_add(11, 4, 'Implement Trie (Prefix Tree)', '{operations: string[], args: array[]} with insert(word), search(word), starts_with(prefix). ' + _OPS,
     'null for insert; boolean for exact search and prefix search.', [
    ('Exact word versus prefix', {'operations': ['insert', 'search', 'search', 'starts_with', 'insert', 'search'], 'args': [['apple'], ['apple'], ['app'], ['app'], ['app'], ['app']]}, [None, True, False, True, None, True]),
    ('Empty trie', {'operations': ['search', 'starts_with'], 'args': [['a'], ['a']]}, [False, False]),
    ('Duplicate insertion', {'operations': ['insert', 'insert', 'search', 'search'], 'args': [['a'], ['a'], ['a'], ['aa']]}, [None, None, True, False]),
    ('Different branches', {'operations': ['insert', 'insert', 'starts_with', 'search', 'starts_with'], 'args': [['car'], ['cat'], ['ca'], ['ca'], ['cb']]}, [None, None, True, False, False]),
], constraints='Words and prefixes are nonempty lowercase English strings with at most 100 characters.')
_add(11, 5, 'Design Add and Search Words Data Structure (Trie + Wildcard)', '{operations: string[], args: array[]} with add_word(word), search(pattern). Dot matches exactly one character. ' + _OPS,
     'null for add_word; boolean for search.', [
    ('Literal and wildcard search', {'operations': ['add_word', 'add_word', 'add_word', 'search', 'search', 'search', 'search'], 'args': [['bad'], ['dad'], ['mad'], ['pad'], ['bad'], ['.ad'], ['b..']]}, [None, None, None, False, True, True, True]),
    ('Empty dictionary', {'operations': ['search'], 'args': [['.']]}, [False]),
    ('Length must match', {'operations': ['add_word', 'search', 'search'], 'args': [['a'], ['..'], ['.']]}, [None, False, True]),
    ('Wildcard backtracking', {'operations': ['add_word', 'add_word', 'search', 'search'], 'args': [['car'], ['dog'], ['..g'], ['c.g']]}, [None, None, True, False]),
], constraints='Words use lowercase English letters; patterns additionally allow dots. Length 1–100.')
_add(11, 6, 'Sum of Two Integers (Bitwise Addition)', '{a: integer, b: integer}', 'Their signed integer sum; implement without + or - operators.', [
    ('Positive integers', {'a': 2, 'b': 3}, 5),
    ('Mixed signs', {'a': -2, 'b': 3}, 1),
    ('Zero', {'a': 0, 'b': 0}, 0),
    ('Two negatives', {'a': -7, 'b': -5}, -12),
], constraints='Inputs and mathematical sum fit signed 32-bit range; no overflow is tested.')


def ids():
    """Return the stable course IDs in sheet order."""
    return list(_BANK)


def _entry(identifier):
    if not isinstance(identifier, str) or identifier not in _BANK:
        raise ValueError('Choose a supported problem from the DSA practice sheet.')
    return _BANK[identifier]


def _starter(entry):
    example = json.dumps(entry['cases'][0]['input'], ensure_ascii=True, separators=(',', ':'))
    return {
        'python': ('def solve(input):\n'
                   f'    # {entry["title"]}\n'
                   f'    # Input example: {example}\n'
                   '    # Read fields from input and return the requested JSON-compatible value.\n'
                   '    # Your code runs once for each test case. Do not read stdin.\n'
                   '    raise NotImplementedError("Write your solution here")\n'),
        'javascript': ('function solve(input) {\n'
                       f'  // {entry["title"]}\n'
                       f'  // Input example: {example}\n'
                       '  // Read input fields and return the requested JSON-compatible value.\n'
                       '  // Your code runs once for each test case. Do not read stdin.\n'
                       '  throw new Error("Write your solution here");\n'
                       '}\n'),
        'cpp': ('#include <iostream>\n#include <vector>\n#include <string>\n#include <nlohmann/json.hpp>\n\n'
                'using json = nlohmann::json;\n\n'
                f'// {entry["title"]}\n'
                f'// Input example: {example}\n'
                '// Input is already parsed. Read fields with input.at("field").get<T>().\n'
                '// Example: auto nums = input.at("nums").get<std::vector<int>>();\n'
                '// Return a number, string, boolean, vector, or json value.\n'
                'json solve(const json& input) {\n'
                '    throw std::runtime_error("Write your solution here");\n}\n\n'
                'int main() {\n'
                '    try {\n'
                '        json input;\n'
                '        std::cin >> input;\n'
                '        std::cout << solve(input).dump() << std::endl;\n'
                '    } catch (const std::exception& error) {\n'
                '        std::cerr << error.what() << std::endl;\n'
                '        return 1;\n'
                '    }\n'
                '}\n'),
    }


def problem(identifier):
    """Public problem contract. Non-sample inputs/answers never appear here."""
    entry = _entry(identifier)
    result = {key: deepcopy(value) for key, value in entry.items() if key != 'cases'}
    result['starter'] = _starter(entry)
    result['samples'] = cases(identifier, samples_only=True)
    result['test_count'] = len(entry['cases'])
    result['sample_count'] = len(result['samples'])
    return result


def cases(identifier, samples_only=False):
    """Return fresh fixtures for the local runner; user code cannot mutate the bank."""
    return deepcopy([case for case in _entry(identifier)['cases'] if not samples_only or case['sample']])


def _equal(actual, expected, approximate=False):
    if isinstance(actual, bool) or isinstance(expected, bool):
        return type(actual) is bool and type(expected) is bool and actual is expected
    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
        if not math.isfinite(actual) or not math.isfinite(expected):
            return False
        return math.isclose(actual, expected, rel_tol=0, abs_tol=1e-7) if approximate else actual == expected
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(_equal(a, b, approximate) for a, b in zip(actual, expected))
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(_equal(actual[key], expected[key], approximate) for key in expected)
    return actual == expected


def _canonical(value, inner_unordered=False):
    if inner_unordered and isinstance(value, list):
        return sorted((_canonical(item) for item in value))
    # Normalise integer-valued floats: JSON has one number type, and 1.0 is a valid
    # representation of integer 1. Booleans remain distinct from numeric values.
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        value = int(value)
    if isinstance(value, list):
        return json.dumps([_canonical(item) for item in value], separators=(',', ':'))
    if isinstance(value, dict):
        return json.dumps({key: _canonical(item) for key, item in sorted(value.items())}, separators=(',', ':'))
    return json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(',', ':'))


def matches(actual, expected, comparison='exact'):
    """Type-aware output comparison; unordered modes retain duplicate counts."""
    if comparison == 'exact':
        try:
            return _equal(actual, expected)
        except (OverflowError, RecursionError):
            return False
    if comparison == 'approximate':
        try:
            return _equal(actual, expected, True)
        except (OverflowError, RecursionError):
            return False
    if comparison not in ('unordered', 'nested_unordered', 'rows_unordered'):
        raise ValueError('Unknown test comparison mode.')
    if not isinstance(actual, list) or not isinstance(expected, list) or len(actual) != len(expected):
        return False
    try:
        if comparison == 'rows_unordered':
            return all(isinstance(a, list) and isinstance(b, list)
                       and sorted(_canonical(item) for item in a) == sorted(_canonical(item) for item in b)
                       for a, b in zip(actual, expected))
        inner = comparison == 'nested_unordered'
        if inner and (any(not isinstance(row, list) for row in actual)
                      or any(not isinstance(row, list) for row in expected)):
            return False
        return sorted(_canonical(item, inner) for item in actual) == sorted(_canonical(item, inner) for item in expected)
    except (TypeError, ValueError, OverflowError, RecursionError):
        return False
